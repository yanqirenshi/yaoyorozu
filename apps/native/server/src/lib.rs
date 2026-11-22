//! YAOYOROZU のローカルサーバ。Tauri に依存しない(段階 1: `list_projects`・`get_settings`・SSE)。

pub mod auth;
pub mod config;
pub mod data_files;
pub mod dto;
pub mod error;
pub mod events;
pub mod rpc;
pub mod state;
pub mod watcher;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::get;
use axum::{middleware, Json, Router};
use events::EventBus;
use futures_util::{Stream, StreamExt};
use serde::Serialize;
pub use state::ServerState;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tokio_stream::wrappers::{errors::BroadcastStreamRecvError, BroadcastStream};

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
    /// 終了の合図。SSE を閉じて、Ctrl+C で止まれるようにする。
    pub shutdown: watch::Receiver<bool>,
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

/// `GET /events`。バスのイベントを 1 件ずつ流す。取りこぼし(遅い購読者)は読み飛ばす。
async fn events(
    State(ctx): State<AppContext>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut shutdown = ctx.shutdown.clone();
    let stream = BroadcastStream::new(ctx.events.subscribe())
        .filter_map(|item| async move {
            match item {
                Ok(ev) => Some(Ok(Event::default().event(ev.name).data(ev.data))),
                Err(BroadcastStreamRecvError::Lagged(_)) => None,
            }
        })
        .take_until(async move {
            let _ = shutdown.wait_for(|v| *v).await;
        });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

pub fn router(ctx: AppContext) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/events", get(events))
        .merge(rpc::routes())
        .layer(middleware::from_fn_with_state(ctx.clone(), auth::guard))
        .with_state(ctx)
}
