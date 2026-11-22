use infra::FileSettingsStore;
use server::config::{self, DATA_DIR_ENV_VAR, PORT_ENV_VAR};
use server::data_files;
use server::events::EventBus;
use server::lock::DataDirLock;
use server::running::{ClaudeOverride, RunningServices, FAKE_CLAUDE_ENV_VAR};
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
    // 何よりも先に、自分自身を KILL_ON_JOB_CLOSE のジョブへ入れる(サーバが死ぬと、子孫の claude・git・npm
    // などを OS が止める)。失敗しても起動は続ける(ログに出す)。
    match infra::place_current_process_in_kill_on_close_job() {
        Ok(()) => println!(
            "ジョブオブジェクトに入りました(サーバが終わると、子孫のプロセスは OS が止めます。ジョブへの所属: {})",
            if infra::current_process_is_in_a_job() { "確認済み" } else { "確認できず" }
        ),
        Err(e) => eprintln!("ジョブオブジェクトに入れませんでした(起動は続けます): {e}"),
    }
    // 何かを作る・書く前に、実体のパスへ解決して MSI 版のフォルダでないことを確かめる。
    let cwd = std::env::current_dir().map_err(|e| format!("作業フォルダを取得できません: {e}"))?;
    let data_dir = config::resolve_data_dir(
        std::env::var(DATA_DIR_ENV_VAR).ok().as_deref(),
        std::env::var("APPDATA").ok().as_deref(),
        &cwd,
    )?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("データフォルダを作れません({}): {e}", data_dir.display()))?;
    // 同じデータフォルダを使うサーバを 1 つに絞る(終了まで持つ)。トークン・ポートの書き込み、
    // 一時ファイルの掃除より前に取る(2 つ目が何も壊さないように)。
    let _data_dir_lock = DataDirLock::acquire(&data_dir)?;
    // 保存の途中で止められて残った古い一時ファイルを、データフォルダの中だけ片付ける。
    let removed = data_files::cleanup_stale_tmp(&data_dir);
    if !removed.is_empty() {
        println!("古い一時ファイルを {} 個、片付けました", removed.len());
    }
    let port = config::resolve_port(std::env::var(PORT_ENV_VAR).ok().as_deref());

    // 設定の読み込み(壊れていれば既定値へ。FileSettingsStore の責務)。
    let save_path = data_dir.join("settings.json");
    let store = FileSettingsStore::new(save_path.clone());
    let loaded = app::load_settings(&store).map_err(|e| format!("設定を読めません: {e:?}"))?;

    // 起動のたびにトークンを作り直す(前回分は無効になる)。一時ファイルは新規作成に限る。
    let token = app::generate_local_api_token();
    data_files::write_atomic(&data_dir.join("server-token"), token.as_bytes())
        .map_err(|e| format!("トークンを保存できません: {e}"))?;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("ポート {port} で待ち受けできません: {e}"))?;
    // 実際のポートを、トークンと同じ場所へ書く(Next の中継が読む)。
    data_files::write_atomic(&data_dir.join("server-port"), port.to_string().as_bytes())
        .map_err(|e| format!("ポートを保存できません: {e}"))?;

    let events = EventBus::new();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let mut state = ServerState::new(loaded.settings, save_path, loaded.recovered_from_corruption);
    // 現在の PC・ユーザー(OS から作る。会話は走査キューが埋める)。
    match app::current_pc(&infra::WindowsExecutionEnvironmentSource::new()) {
        Ok(pc) => state.pc = pc,
        Err(e) => eprintln!("PC の情報を取得できませんでした(空で続けます): {e}"),
    }
    if loaded.recovered_from_corruption {
        // issue #538: 本当に内容が壊れていた場合と、読めなかっただけの場合を文言で区別する。
        // 起動直後は誰も WebSocket でつないでいないので、控えに積んで `list_pending_warnings` で取ってもらう。
        let message = if loaded.evacuated {
            "設定ファイルが破損していたため、初期状態に戻しました。設定を再度行ってください。"
        } else {
            "設定ファイルを読み込めなかったため、初期状態で起動しました(ファイルはそのまま残しています。一時的な問題の可能性があります)。設定が元に戻っていないか確認してください。"
        };
        state.push_warning("settings:corrupted", message.to_string());
    }
    // Git 台帳(最小。読むだけ。観測と更新は再開の前にバックグラウンドで行う)。
    let git_ledger_path = data_dir.join("git-ledger.json");
    let ledger_watch = server::corruption::Watch::start(&data_dir, "git-ledger.json");
    state.git_ledger =
        app::load_git_ledger(&infra::FileGitLedgerStore::new(git_ledger_path.clone()))
            .unwrap_or_else(|e| {
                eprintln!("Git 台帳を読めませんでした(空から始めます): {e}");
                Default::default()
            });
    state.git_ledger_path = git_ledger_path;
    // 閉じた警告の印(サーバを起動し直しても、閉じた警告を出し直さない)。
    state.dismissed_skips = server::dismissed::load(&data_dir);
    // 台帳が壊れていて退避したときは、ログと保留中の警告に出す(起動直後は誰も WebSocket でつないでいないので、控えへ積む)。
    for name in ledger_watch.evacuated() {
        let message = ledger_watch.message(&name);
        eprintln!("{message}");
        state.push_warning("app:warning", message);
    }
    let projects_root = server::state::resolve_effective_projects_dir(&state.settings);
    let claude_override =
        ClaudeOverride::from_env_value(std::env::var(FAKE_CLAUDE_ENV_VAR).ok().as_deref());
    if let Some(o) = &claude_override {
        println!(
            "偽の claude を使います(確認用): {} {}",
            o.program,
            o.leading_args.join(" ")
        );
    }
    let ctx = AppContext {
        state: Arc::new(Mutex::new(state)),
        events: events.clone(),
        token: Arc::new(token),
        port,
        version: Arc::new(env!("CARGO_PKG_VERSION").to_string()),
        data_dir: Arc::new(data_dir.clone()),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        file_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: shutdown_rx,
        running: RunningServices {
            claude_override,
            // `/ws` が通す Origin は、Next の画面のポート(YAOYOROZU_CONSOLE_PORT)から作る。未設定なら、`/ws` は誰も通さない。
            allowed_origins: Arc::new(server::ws::origins_from_env_value(
                std::env::var(server::ws::CONSOLE_PORT_ENV_VAR)
                    .ok()
                    .as_deref(),
            )),
            ..Default::default()
        },
    };
    match projects_root {
        Ok(root) => server::watcher::start_session_watcher(&ctx, root),
        Err(e) => eprintln!("セッション監視を開始できませんでした: {e}"),
    }

    // 前回動かしていた実行中セッションを、1 件ずつ再開する(データフォルダの控えだけを読む)。
    server::running::start_restoring_running_sessions(ctx.clone());
    // ハブのデータ(Git 台帳の観測 → 全件の走査)を、バックグラウンドで読み込む(起動を待たせない)。
    {
        let ctx = ctx.clone();
        tokio::spawn(async move {
            server::scan::begin_reload(&ctx).await;
        });
    }

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
    let ctx_for_stop = ctx.clone();
    axum::serve(listener, router(ctx))
        .with_graceful_shutdown(async move {
            // Ctrl+C のほか、コンソールを閉じる・ログオフ・シャットダウンでも、claude を穏やかに止める
            // (OS が打ち切るまで約 5 秒。間に合わなかった分はジョブオブジェクトが止める)。
            let signal = server::signals::wait_for_shutdown_signal().await;
            println!("終了します({signal})");
            let _ = shutdown_tx.send(true);
            server::running::stop_all_running_sessions(&ctx_for_stop).await;
        })
        .await
        .map_err(|e| format!("サーバが止まりました: {e}"))
}
