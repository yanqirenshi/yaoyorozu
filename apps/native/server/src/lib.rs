//! YAOYOROZU のローカルサーバ。Tauri に依存しない(段階 1: `list_projects`・`get_settings`・SSE)。

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
pub mod session_ids;
pub mod signals;
pub mod state;
pub mod watcher;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::get;
use axum::{middleware, Json, Router};
use events::EventBus;
use futures_util::{stream, Stream, StreamExt};
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
    /// 設定ファイルの保存のレーン。保存はここを 1 つずつ通る(ロックの順は「レーン → 状態」の一方向。
    /// 状態のロックを持ったままレーンを待たない)。
    pub save_lane: Arc<tokio::sync::Mutex<()>>,
    /// ファイル(CLAUDE.md・設定ファイル)の保存のレーン。楽観ロックつきの保存は「今の更新時刻を確かめる →
    /// 書く」をこの中でひとまとまりに行い、同じファイルへの保存どうしが間に割り込めないようにする
    /// (同じ `expectedModifiedAtMs` で同時に来た保存は、通るのが 1 本だけで残りは競合になる)。
    /// 低頻度の操作なので、ファイルごとではなく全体で 1 本にした(単純さを優先)。
    pub file_lane: Arc<tokio::sync::Mutex<()>>,
    /// 終了の合図。SSE を閉じて、Ctrl+C で止まれるようにする。
    pub shutdown: watch::Receiver<bool>,
    /// 実行中セッションまわり(SSE の接続の表・保存のレーン・claude の差し替え)。
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

/// SSE の接続が終わったとき(閉じられたとき・つなぎ直されたとき)に、その接続の表と購読を片づける。
struct ConnectionGuard {
    ctx: AppContext,
    conn_id: String,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.ctx.running.connections.close(&self.conn_id);
        // 購読の掃除は状態のロックが要る(`Drop` は async にできない)ので、別のタスクで行う。
        let ctx = self.ctx.clone();
        let conn_id = self.conn_id.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                ctx.state
                    .lock()
                    .await
                    .drop_connection_subscriptions(&[conn_id]);
            });
        }
    }
}

/// `GET /events`。**通知**(放送。取りこぼしてよい)と、この接続の**途中経過**(接続ごとの待ち行列。
/// 順序を保つ)を 1 本の SSE に束ねる。最初のイベントは `connection`(この接続の ID。購読の登録に使う)。
/// 途中経過の待ち行列があふれた接続は、サーバが閉じる(ブラウザがつなぎ直し、購読し直す)。
async fn events(
    State(ctx): State<AppContext>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut shutdown = ctx.shutdown.clone();
    let opened = ctx.running.connections.open();
    let conn_id = opened.id.clone();
    let mut kicked = opened.kicked;
    let guard = ConnectionGuard {
        ctx: ctx.clone(),
        conn_id: conn_id.clone(),
    };
    let first = stream::once(async move {
        Ok::<Event, Infallible>(
            Event::default()
                .event("connection")
                .data(serde_json::json!({ "connection_id": conn_id }).to_string()),
        )
    });
    let notifications =
        BroadcastStream::new(ctx.events.subscribe()).filter_map(|item| async move {
            match item {
                Ok(ev) => Some(Ok(Event::default().event(ev.name).data(ev.data))),
                Err(BroadcastStreamRecvError::Lagged(_)) => None,
            }
        });
    let progress = stream::unfold(opened.receiver, |mut receiver| async move {
        let m = receiver.recv().await?;
        Some((
            Ok::<Event, Infallible>(
                Event::default()
                    .event(running::RUNNING_SESSION_PROGRESS_EVENT)
                    .data(m.progress_json),
            ),
            receiver,
        ))
    });
    let merged = first
        .chain(stream::select(notifications, progress))
        .take_until(async move {
            tokio::select! {
                // 送り側が先に落ちた(テストなど)ときは、終了の合図とはみなさない。
                _ = async {
                    if shutdown.wait_for(|v| *v).await.is_err() {
                        std::future::pending::<()>().await;
                    }
                } => {}
                _ = kicked.wait_for(|v| *v) => {}
            }
        })
        // 接続の掃除は、ストリームが捨てられたとき(ガードが落ちたとき)に走る。
        .map(move |item| {
            let _ = &guard;
            item
        });
    Sse::new(merged).keep_alive(KeepAlive::default())
}

pub fn router(ctx: AppContext) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/events", get(events))
        .merge(rpc::routes())
        .layer(middleware::from_fn_with_state(ctx.clone(), auth::guard))
        // 本文を読まずに応答した入口でも、読み残しを読み捨ててから接続を閉じる(送り側が、応答を読む前に切られない)。
        .layer(middleware::from_fn(drain::drain_unread_body))
        .with_state(ctx)
}
