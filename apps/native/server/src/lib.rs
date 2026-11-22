//! YAOYOROZU のローカルサーバ。Tauri に依存しない(段階 1: `list_projects`・`get_settings`、通知は WebSocket)。

pub mod auth;
pub mod config;
pub mod corruption;
pub mod data_files;
pub mod dismissed;
pub mod drain;
pub mod dto;
pub mod error;
pub mod events;
pub mod folders;
pub mod jobbed_process;
pub mod lock;
pub mod progress;
pub mod redact;
pub mod rpc;
pub mod running;
pub mod scan;
pub mod session_ids;
pub mod signals;
pub mod state;
pub mod watcher;
pub mod ws;

use axum::extract::State;
use axum::routing::get;
use axum::{middleware, Json, Router};
use events::EventBus;
use serde::Serialize;
pub use state::ServerState;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};

#[derive(Clone)]
pub struct AppContext {
    pub state: Arc<Mutex<ServerState>>,
    pub events: EventBus,
    pub token: Arc<String>,
    pub port: u16,
    pub version: Arc<String>,
    /// データフォルダ(解決済みの実体のパス)。
    pub data_dir: Arc<std::path::PathBuf>,
    /// 会話ファイルの監視。差し替えると前の監視は止まる。
    pub watcher: Arc<std::sync::Mutex<Option<infra::SessionWatcher>>>,
    /// 設定ファイルの保存のレーン。保存はここを 1 つずつ通る(ロックの順は「レーン → 状態」の一方向。
    /// 状態のロックを持ったままレーンを待たない)。
    pub save_lane: Arc<tokio::sync::Mutex<()>>,
    /// ファイル(CLAUDE.md・設定ファイル)の保存のレーン。楽観ロックつきの保存は「今の更新時刻を確かめる →
    /// 書く」をこの中でひとまとまりに行い、同じファイルへの保存どうしが間に割り込めないようにする
    /// (同じ `expectedModifiedAtMs` で同時に来た保存は、通るのが 1 本だけで残りは競合になる)。
    /// 低頻度の操作なので、ファイルごとではなく全体で 1 本にした(単純さを優先)。
    pub file_lane: Arc<tokio::sync::Mutex<()>>,
    /// 終了の合図。WebSocket を閉じて、Ctrl+C で止まれるようにする。
    pub shutdown: watch::Receiver<bool>,
    /// 実行中セッションまわり(WebSocket の接続の表・券・保存のレーン・claude の差し替え)。
    pub running: running::RunningServices,
}

#[derive(Serialize)]
struct HealthDto {
    ok: bool,
    version: String,
}

async fn health(State(ctx): State<AppContext>) -> Json<HealthDto> {
    Json(HealthDto {
        ok: true,
        version: (*ctx.version).clone(),
    })
}

pub fn router(ctx: AppContext) -> Router {
    // 操作(`/rpc`)と `/health`: Host とトークンを確かめる(中継がトークンを付ける)。
    let guarded = Router::new()
        .route("/health", get(health))
        .merge(rpc::routes())
        .layer(middleware::from_fn_with_state(ctx.clone(), auth::guard))
        // 本文を読まずに応答した入口でも、読み残しを読み捨ててから接続を閉じる(送り側が、応答を読む前に切られない)。
        .layer(middleware::from_fn(drain::drain_unread_body));
    // `/ws`(通知と途中経過)は、ブラウザが直接つなぐ(トークンを持たない)ので、別の守り(券・Origin・Host。`ws.rs`)。
    Router::new()
        .merge(guarded)
        .route("/ws", get(ws::ws_handler))
        .with_state(ctx)
}
