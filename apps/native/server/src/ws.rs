//! ブラウザから直接つなぐ WebSocket(`/ws`)。**通知**(今のイベント名のまま)と**途中経過**(会話ごとの連番つき)を運ぶ。
//!
//! 守りの考え方(通知と途中経過は、操作(`/rpc`。Next が中継し、サーバのトークンを付ける)とは別の入口になる):
//!
//! - **トークンはブラウザへ渡さない**。代わりに、タブは中継を通して**使い捨ての券**をもらい(`issue_ws_ticket`。
//!   ほかの rpc と同じ守り = トークン・Origin・Host)、`/ws` へつないだあとの**最初のメッセージ**で券を送る。
//!   券は URL(クエリ)に入れない(ログ・履歴に残るため)。クエリのある要求は、それだけで断る。
//! - 券は、乱数から作る(UUID v4 を 3 つ = 360 ビット以上)。有効は 30 秒・**1 回だけ**・メモリにだけ持つ・未使用の数に上限。
//!   券の確かめの前は、何も送らず、ほかのメッセージも受け付けない。5 秒以内に正しい券が来なければ閉じる。
//! - アップグレードの要求で **Host**(127.0.0.1:<ポート> / localhost:<ポート>)と **Origin** を確かめる。Origin は、
//!   Next の画面のもの(`http://127.0.0.1:<画面のポート>` と `http://localhost:<同>`)だけ。Origin が無い要求も断る。
//!   許す Origin は、起動するときの環境変数 `YAOYOROZU_CONSOLE_PORT`(画面のポート)から作る(未設定なら、`/ws` は誰も通さない)。
//! - タブからサーバへ送れるのは、券・購読・購読解除・pong だけ。それ以外・壊れたメッセージ・大きすぎるメッセージは、閉じる。
//! - 購読・購読解除は**その接続の上**で行う(接続の ID は外へ出ない。ほかの接続の購読は、指せない・外せない)。
//! - 遅い・止まった接続は、これまでどおり接続ごとの待ち行列(件数 512・16MB)があふれたら外して閉じる。ping に pong が
//!   返らない接続(凍結されたタブなど)も、閉じる。
//! - 券をログに出さない。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;

use crate::dto::RunningSessionRefDto;
use crate::rpc::running::{subscribe_progress, unsubscribe_progress};
use crate::AppContext;

/// 画面のポートを渡す環境変数(許す Origin を作る)。
pub const CONSOLE_PORT_ENV_VAR: &str = "YAOYOROZU_CONSOLE_PORT";

/// 券の有効期間。
pub const TICKET_TTL: Duration = Duration::from_secs(30);
/// 未使用の券の数の上限。
pub const MAX_PENDING_TICKETS: usize = 64;
/// つないだあと、最初のメッセージ(券)が来るまでの待ち。
pub const FIRST_MESSAGE_TIMEOUT: Duration = Duration::from_secs(5);
/// タブから受け取るメッセージの大きさの上限(バイト)。
pub const MAX_CLIENT_MESSAGE_BYTES: usize = 16 * 1024;
/// ping の間隔と、pong(または何かのメッセージ)が来ない限度。
pub const PING_INTERVAL: Duration = Duration::from_secs(10);
pub const PONG_TIMEOUT: Duration = Duration::from_secs(30);
/// 1 通を送り切る限度(読まない相手に、いつまでも待たされない)。
pub const SEND_TIMEOUT: Duration = Duration::from_secs(10);

/// 使い捨ての券の表(サーバのメモリにだけ持つ)。
#[derive(Clone, Default)]
pub struct Tickets {
    inner: Arc<Mutex<HashMap<String, Instant>>>,
}

/// 券を出せなかった理由。
#[derive(Debug, PartialEq, Eq)]
pub enum IssueError {
    /// 未使用の券が上限に達している。
    TooMany,
}

impl Tickets {
    fn table(&self) -> std::sync::MutexGuard<'_, HashMap<String, Instant>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 乱数から作った券を 1 枚出す(有効期間 [`TICKET_TTL`])。
    pub fn issue(&self) -> Result<String, IssueError> {
        self.issue_for(TICKET_TTL)
    }

    pub fn issue_for(&self, ttl: Duration) -> Result<String, IssueError> {
        let mut table = self.table();
        let now = Instant::now();
        table.retain(|_, expires| *expires > now);
        if table.len() >= MAX_PENDING_TICKETS {
            return Err(IssueError::TooMany);
        }
        // 360 ビット(UUID v4 の乱数 120 ビット × 3)。OS の乱数から作られる。
        let ticket = format!(
            "{}{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        table.insert(ticket.clone(), now + ttl);
        Ok(ticket)
    }

    /// 券を 1 回だけ使う。有効なら `true`(券は、その場で無くなる)。期限切れ・使用済み・でたらめは `false`。
    pub fn consume(&self, ticket: &str) -> bool {
        let mut table = self.table();
        match table.remove(ticket) {
            Some(expires) => expires > Instant::now(),
            None => false,
        }
    }

    pub fn pending(&self) -> usize {
        let mut table = self.table();
        let now = Instant::now();
        table.retain(|_, expires| *expires > now);
        table.len()
    }
}

/// 画面のポートから、許す Origin を作る。
pub fn origins_for_console_port(port: u16) -> Vec<String> {
    vec![
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
    ]
}

/// 環境変数の値(画面のポート)から、許す Origin を作る。未設定・不正なら空(`/ws` は誰も通さない)。
pub fn origins_from_env_value(value: Option<&str>) -> Vec<String> {
    value
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|p| *p != 0)
        .map(origins_for_console_port)
        .unwrap_or_default()
}

fn origin_is_allowed(ctx: &AppContext, headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    ctx.running
        .allowed_origins
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(origin))
}

fn refuse(status: StatusCode, message: &'static str) -> Response {
    (status, message).into_response()
}

/// タブからサーバへ送れるメッセージ(これ以外は閉じる)。
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Ticket {
        ticket: String,
    },
    Subscribe {
        request_id: u64,
        target: RunningSessionRefDto,
    },
    Unsubscribe {
        subscription_id: u64,
    },
    Pong,
}

/// `GET /ws`(アップグレード)。Host・Origin・クエリを確かめてから、WebSocket にする。
pub async fn ws_handler(State(ctx): State<AppContext>, request: Request) -> Response {
    let (mut parts, _body) = request.into_parts();
    if !crate::auth::host_is_allowed(&parts.headers, ctx.port) {
        return refuse(StatusCode::FORBIDDEN, "Host が許可されていません");
    }
    if !origin_is_allowed(&ctx, &parts.headers) {
        return refuse(StatusCode::FORBIDDEN, "Origin が許可されていません");
    }
    // 券は URL に入れない(ログ・履歴に残る)。クエリのある要求は、断る。
    if parts.uri.query().is_some() {
        return refuse(StatusCode::BAD_REQUEST, "クエリは付けられません");
    }
    let ws = match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Ok(ws) => ws,
        Err(rejection) => return rejection.into_response(),
    };
    ws.max_message_size(MAX_CLIENT_MESSAGE_BYTES)
        .max_frame_size(MAX_CLIENT_MESSAGE_BYTES)
        .on_upgrade(move |socket| serve(ctx, socket))
}

/// 接続が終わったとき(閉じられたとき・外されたとき)に、その接続の表と購読を片づける。
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

const POLICY_VIOLATION: u16 = 1008;

async fn close_with(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        socket.send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        }))),
    )
    .await;
}

/// 1 通を送る。限度の時間内に送れなければ `false`(接続を閉じる)。
async fn send_text(socket: &mut WebSocket, text: String) -> bool {
    matches!(
        tokio::time::timeout(SEND_TIMEOUT, socket.send(Message::Text(text.into()))).await,
        Ok(Ok(()))
    )
}

async fn serve(ctx: AppContext, mut socket: WebSocket) {
    // 1. 最初のメッセージは券。券の確かめの前は、何も送らない。
    let first = tokio::time::timeout(FIRST_MESSAGE_TIMEOUT, socket.recv()).await;
    let ticket_ok = match first {
        Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<ClientMessage>(&text) {
            Ok(ClientMessage::Ticket { ticket }) => ctx.running.tickets.consume(&ticket),
            _ => false,
        },
        _ => false,
    };
    if !ticket_ok {
        close_with(&mut socket, POLICY_VIOLATION, "認証に失敗しました").await;
        return;
    }

    // 2. 接続を開く(接続の ID は、サーバの中だけで使う)。
    let mut opened = ctx.running.connections.open();
    let conn_id = opened.id.clone();
    let _guard = ConnectionGuard {
        ctx: ctx.clone(),
        conn_id: conn_id.clone(),
    };
    let mut kicked = opened.kicked.clone();
    let mut shutdown = ctx.shutdown.clone();
    // 通知の購読は、ready を送る前に始める(ready のあとの通知を取りこぼさない)。
    let mut notifications = ctx.events.subscribe();
    if !send_text(&mut socket, r#"{"type":"ready"}"#.to_string()).await {
        return;
    }

    let mut ping = tokio::time::interval(PING_INTERVAL);
    ping.tick().await;
    let mut last_heard = Instant::now();

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { return };
                match message {
                    Message::Text(text) => {
                        last_heard = Instant::now();
                        let reply = match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(ClientMessage::Pong) => None,
                            Ok(ClientMessage::Subscribe { request_id, target }) => {
                                Some(match subscribe_progress(&ctx, &conn_id, target.into()).await {
                                    Ok(subscription_id) => serde_json::json!({
                                        "type": "subscribed",
                                        "request_id": request_id,
                                        "subscription_id": subscription_id,
                                    }),
                                    Err(e) => serde_json::json!({
                                        "type": "subscribe_failed",
                                        "request_id": request_id,
                                        "code": e.0.code,
                                        "message": e.0.message,
                                    }),
                                })
                            }
                            Ok(ClientMessage::Unsubscribe { subscription_id }) => {
                                unsubscribe_progress(&ctx, &conn_id, subscription_id).await;
                                None
                            }
                            // 券は最初の 1 通だけ。それ以外・壊れたメッセージは、閉じる。
                            Ok(ClientMessage::Ticket { .. }) | Err(_) => {
                                close_with(&mut socket, POLICY_VIOLATION, "受け付けられないメッセージです").await;
                                return;
                            }
                        };
                        if let Some(reply) = reply {
                            if !send_text(&mut socket, reply.to_string()).await {
                                return;
                            }
                        }
                    }
                    // WebSocket の ping/pong(ブラウザが自動で返す)。生きている印として数える。
                    Message::Ping(_) | Message::Pong(_) => last_heard = Instant::now(),
                    Message::Binary(_) => {
                        close_with(&mut socket, POLICY_VIOLATION, "受け付けられないメッセージです").await;
                        return;
                    }
                    Message::Close(_) => return,
                }
            }
            event = notifications.recv() => {
                match event {
                    Ok(ev) => {
                        let data = serde_json::from_str::<serde_json::Value>(&ev.data)
                            .unwrap_or(serde_json::Value::String(ev.data));
                        let text = serde_json::json!({"type": "event", "name": ev.name, "data": data}).to_string();
                        if !send_text(&mut socket, text).await {
                            return;
                        }
                    }
                    // 通知は取りこぼしてよい(画面は、つなぎ直しのとき状態を取り直す)。
                    Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => return,
                }
            }
            progress = opened.receiver.recv() => {
                // 待ち行列が外された(あふれた)ら、閉じる。画面はつなぎ直して、購読し直し、状態を取り直す。
                let Some(message) = progress else { return };
                let text = format!(r#"{{"type":"progress","data":{}}}"#, message.progress_json);
                if !send_text(&mut socket, text).await {
                    return;
                }
            }
            _ = ping.tick() => {
                if last_heard.elapsed() > PONG_TIMEOUT {
                    return;
                }
                if !send_text(&mut socket, r#"{"type":"ping"}"#.to_string()).await {
                    return;
                }
            }
            _ = async { let _ = kicked.wait_for(|v| *v).await; } => return,
            _ = async {
                // 送り側が先に落ちた(テストなど)ときは、終了の合図とはみなさない。
                if shutdown.wait_for(|v| *v).await.is_err() {
                    std::future::pending::<()>().await;
                }
            } => {
                close_with(&mut socket, 1001, "サーバが終了します").await;
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ticket_works_once() {
        let tickets = Tickets::default();
        let t = tickets.issue().unwrap();
        assert!(t.len() >= 90, "十分に長い乱数");
        assert!(tickets.consume(&t));
        assert!(!tickets.consume(&t), "使用済み");
        assert!(!tickets.consume("でたらめ"));
    }

    #[test]
    fn an_expired_ticket_is_refused() {
        let tickets = Tickets::default();
        let t = tickets.issue_for(Duration::from_millis(0)).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        assert!(!tickets.consume(&t));
    }

    #[test]
    fn the_number_of_unused_tickets_is_limited_and_expired_ones_do_not_count() {
        let tickets = Tickets::default();
        for _ in 0..MAX_PENDING_TICKETS {
            tickets.issue().unwrap();
        }
        assert_eq!(tickets.issue(), Err(IssueError::TooMany));
        // 使うと空きができる。
        let expired = Tickets::default();
        for _ in 0..MAX_PENDING_TICKETS {
            expired.issue_for(Duration::from_millis(0)).unwrap();
        }
        std::thread::sleep(Duration::from_millis(5));
        assert!(expired.issue().is_ok(), "期限切れは数えない");
    }

    #[test]
    fn tickets_are_distinct() {
        let tickets = Tickets::default();
        let a = tickets.issue().unwrap();
        let b = tickets.issue().unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn origins_come_from_the_console_port() {
        assert_eq!(
            origins_from_env_value(Some("3200")),
            vec!["http://127.0.0.1:3200", "http://localhost:3200"]
        );
        assert!(origins_from_env_value(None).is_empty());
        assert!(origins_from_env_value(Some("abc")).is_empty());
        assert!(origins_from_env_value(Some("0")).is_empty());
        assert!(origins_from_env_value(Some("99999")).is_empty());
    }

    #[test]
    fn only_the_four_message_kinds_parse() {
        assert!(serde_json::from_str::<ClientMessage>(r#"{"type":"pong"}"#).is_ok());
        assert!(serde_json::from_str::<ClientMessage>(r#"{"type":"ticket","ticket":"x"}"#).is_ok());
        assert!(serde_json::from_str::<ClientMessage>(
            r#"{"type":"unsubscribe","subscription_id":1}"#
        )
        .is_ok());
        assert!(serde_json::from_str::<ClientMessage>(r#"{"type":"stop_everything"}"#).is_err());
        assert!(serde_json::from_str::<ClientMessage>("not json").is_err());
    }
}
