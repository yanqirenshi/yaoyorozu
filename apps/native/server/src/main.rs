use app::{LocalApiPortStore as _, LocalApiTokenStore as _};
use infra::{FileLocalApiPortStore, FileLocalApiTokenStore, FileSettingsStore};
use server::config::{self, DATA_DIR_ENV_VAR, PORT_ENV_VAR};
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Mutex};

/// 確認用の `ping` を配る間隔。
const PING_INTERVAL: Duration = Duration::from_secs(2);

#[tokio::main]
async fn main() {
    if let Err(message) = run().await {
        eprintln!("起動できませんでした: {message}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    // 何かを作る・書く前に、実体のパスへ解決して MSI 版のフォルダでないことを確かめる。
    let cwd = std::env::current_dir().map_err(|e| format!("作業フォルダを取得できません: {e}"))?;
    let data_dir = config::resolve_data_dir(
        std::env::var(DATA_DIR_ENV_VAR).ok().as_deref(),
        std::env::var("APPDATA").ok().as_deref(),
        &cwd,
    )?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("データフォルダを作れません({}): {e}", data_dir.display()))?;
    let port = config::resolve_port(std::env::var(PORT_ENV_VAR).ok().as_deref());

    // 設定の読み込み(壊れていれば既定値へ。FileSettingsStore の責務)。
    let store = FileSettingsStore::new(data_dir.join("settings.json"));
    let loaded = app::load_settings(&store).map_err(|e| format!("設定を読めません: {e:?}"))?;

    // 起動のたびにトークンを作り直す(前回分は無効になる)。
    let token = app::generate_local_api_token();
    FileLocalApiTokenStore::new(data_dir.join("server-token"))
        .save(&token)
        .map_err(|e| format!("トークンを保存できません: {e:?}"))?;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("ポート {port} で待ち受けできません: {e}"))?;
    // 実際のポートを、トークンと同じ場所へ書く(Next の中継が読む)。
    FileLocalApiPortStore::new(data_dir.join("server-port"))
        .save(port)
        .map_err(|e| format!("ポートを保存できません: {e:?}"))?;

    let events = EventBus::new();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let ctx = AppContext {
        state: Arc::new(Mutex::new(ServerState {
            settings: loaded.settings,
        })),
        events: events.clone(),
        token: Arc::new(token),
        port,
        version: Arc::new(env!("CARGO_PKG_VERSION").to_string()),
        shutdown: shutdown_rx,
    };

    // 配信の仕組みの確認用。段階 1 は定期的な ping だけ。
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(PING_INTERVAL);
        let mut n: u64 = 0;
        loop {
            tick.tick().await;
            n += 1;
            events.emit("ping", &serde_json::json!({ "n": n }));
        }
    });

    println!(
        "サーバを起動しました: http://127.0.0.1:{port}(データフォルダ: {})",
        data_dir.display()
    );
    axum::serve(listener, router(ctx))
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            println!("終了します");
            let _ = shutdown_tx.send(true);
        })
        .await
        .map_err(|e| format!("サーバが止まりました: {e}"))
}
