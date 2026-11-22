//! `/ws`(通知と途中経過の WebSocket)の守りと、つないだあとの動き。実際にソケットでつなぐ(127.0.0.1 の空きポート)。
//! 偽のサーバ・偽の claude は要らない(会話の入れ物だけを状態に積む)。
//!
//! 守りの表(issue #636): 券なし・でたらめな券・期限切れ・使用済み・最初のメッセージが券でない・5 秒何も送らない・
//! Origin が違う・Origin 無し・Host が違う・券の前の購読・大きすぎるメッセージ・券をクエリに付けた場合。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::progress::ProgressMessage;
use server::state::RunningSessionSlot;
use server::{router, AppContext, ServerState};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{watch, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tower::ServiceExt;

const TOKEN: &str = "t";
const CONSOLE_PORT: u16 = 3200;

struct StubProcess;

impl app::RunningProcess for StubProcess {
    fn pid(&self) -> u32 {
        4242
    }
    fn pid_domain(&self) -> String {
        "windows:test".to_string()
    }
    fn send_user_message(
        &self,
        _text: &str,
        _images: &[domain::ImageAttachment],
    ) -> Result<(), app::AppError> {
        Ok(())
    }
    fn respond_permission(&self, _r: &domain::PermissionResponse) -> Result<(), app::AppError> {
        Ok(())
    }
    fn interrupt(&self) -> Result<(), app::AppError> {
        Ok(())
    }
    fn set_model(&self, _model: &str) -> Result<(), app::AppError> {
        Ok(())
    }
    fn set_permission_mode(&self, _m: app::RunningPermissionMode) -> Result<(), app::AppError> {
        Ok(())
    }
    fn get_usage(&self) -> Result<(), app::AppError> {
        Ok(())
    }
    fn stop(&self) {}
}

fn slot() -> RunningSessionSlot {
    let base = domain::RunningSession::new("s-1", "windows:test", 4242, 1000);
    RunningSessionSlot {
        progress_seq: 0,
        project: None,
        session: domain::RunningSessionByApp::new(base, "C:/repo".into(), "main-worktree", 1000),
        process: Arc::new(StubProcess),
        available_models: Vec::new(),
        subscribers: Vec::new(),
        turn_events: Default::default(),
    }
}

struct Fixture {
    ctx: AppContext,
    port: u16,
    // 落とすとサーバが止まる。
    _shutdown: watch::Sender<bool>,
}

async fn start() -> Fixture {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = watch::channel(false);
    let mut state = ServerState::new(domain::Settings::default(), "settings.json".into(), false);
    state.running_sessions.push(slot());
    let ctx = AppContext {
        state: Arc::new(Mutex::new(state)),
        events: EventBus::new(),
        token: Arc::new(TOKEN.to_string()),
        port,
        version: Arc::new("0".to_string()),
        data_dir: Arc::new(std::path::PathBuf::from(".")),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        file_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
        running: server::running::RunningServices {
            allowed_origins: Arc::new(server::ws::origins_for_console_port(CONSOLE_PORT)),
            ..Default::default()
        },
    };
    let app = router(ctx.clone());
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Fixture {
        ctx,
        port,
        _shutdown: tx,
    }
}

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn origin_ok() -> String {
    format!("http://127.0.0.1:{CONSOLE_PORT}")
}

/// 接続を試みる。`origin`・`host` は上書きできる(`None` の origin は付けない)。
async fn connect_with(
    f: &Fixture,
    path: &str,
    origin: Option<&str>,
    host: Option<&str>,
) -> Result<Socket, StatusCode> {
    let mut request = format!("ws://127.0.0.1:{}{path}", f.port)
        .into_client_request()
        .unwrap();
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
    }
    if let Some(host) = host {
        request.headers_mut().insert("host", host.parse().unwrap());
    }
    match tokio_tungstenite::connect_async(request).await {
        Ok((socket, _)) => Ok(socket),
        Err(tokio_tungstenite::tungstenite::Error::Http(response)) => Err(response.status()),
        Err(other) => panic!("想定外の失敗: {other}"),
    }
}

async fn connect(f: &Fixture) -> Socket {
    connect_with(f, "/ws", Some(&origin_ok()), None)
        .await
        .expect("つながる")
}

fn text(value: serde_json::Value) -> Message {
    Message::Text(value.to_string().into())
}

/// 次のメッセージを待つ(閉じられた・切れたら `None`)。
async fn next_text(socket: &mut Socket) -> Option<serde_json::Value> {
    loop {
        let item = tokio::time::timeout(Duration::from_secs(8), socket.next())
            .await
            .expect("待ちすぎ");
        match item {
            Some(Ok(Message::Text(t))) => return Some(serde_json::from_str(&t).unwrap()),
            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return None,
            Some(Ok(_)) => continue,
        }
    }
}

/// 閉じられるまで待つ(その間にテキストが来たら、失敗)。
async fn expect_closed(socket: &mut Socket) {
    assert!(next_text(socket).await.is_none(), "閉じられるはず");
}

async fn issue_ticket(f: &Fixture) -> String {
    f.ctx.running.tickets.issue().unwrap()
}

async fn authed(f: &Fixture) -> Socket {
    let mut socket = connect(f).await;
    let ticket = issue_ticket(f).await;
    socket
        .send(text(
            serde_json::json!({"type": "ticket", "ticket": ticket}),
        ))
        .await
        .unwrap();
    let ready = next_text(&mut socket).await.expect("ready");
    assert_eq!(ready["type"], "ready");
    socket
}

#[tokio::test]
async fn a_valid_ticket_opens_the_connection_and_it_works_once() {
    let f = start().await;
    let mut socket = connect(&f).await;
    let ticket = issue_ticket(&f).await;
    socket
        .send(text(
            serde_json::json!({"type": "ticket", "ticket": ticket}),
        ))
        .await
        .unwrap();
    assert_eq!(next_text(&mut socket).await.unwrap()["type"], "ready");

    // 同じ券で、もう 1 本はつなげない(使用済み)。
    let mut second = connect(&f).await;
    second
        .send(text(
            serde_json::json!({"type": "ticket", "ticket": ticket}),
        ))
        .await
        .unwrap();
    expect_closed(&mut second).await;
}

#[tokio::test]
async fn a_garbage_ticket_is_refused_and_nothing_is_sent_before_the_ticket_is_checked() {
    let f = start().await;
    let mut socket = connect(&f).await;
    socket
        .send(text(
            serde_json::json!({"type": "ticket", "ticket": "でたらめ"}),
        ))
        .await
        .unwrap();
    // 閉じる前に、何も(ready も)来ない。
    expect_closed(&mut socket).await;
}

#[tokio::test]
async fn an_expired_ticket_is_refused() {
    let f = start().await;
    let ticket = f
        .ctx
        .running
        .tickets
        .issue_for(Duration::from_millis(0))
        .unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    let mut socket = connect(&f).await;
    socket
        .send(text(
            serde_json::json!({"type": "ticket", "ticket": ticket}),
        ))
        .await
        .unwrap();
    expect_closed(&mut socket).await;
}

#[tokio::test]
async fn a_first_message_that_is_not_a_ticket_closes_the_connection() {
    let f = start().await;
    // 券の前の購読・pong・binary・壊れた JSON は、どれも閉じる。
    let target = serde_json::json!({"pid_domain": "windows:test", "pid": 4242, "started_at": 1000});
    for first in [
        text(serde_json::json!({"type": "subscribe", "request_id": 1, "target": target})),
        text(serde_json::json!({"type": "pong"})),
        Message::Binary(vec![1, 2, 3].into()),
        Message::Text("not json".into()),
    ] {
        let mut socket = connect(&f).await;
        socket.send(first).await.unwrap();
        expect_closed(&mut socket).await;
    }
    assert!(
        f.ctx.state.lock().await.running_sessions[0]
            .subscribers
            .is_empty(),
        "券の前の購読は、登録されない"
    );
}

#[tokio::test]
async fn sending_nothing_for_five_seconds_closes_the_connection() {
    let f = start().await;
    let mut socket = connect(&f).await;
    let started = std::time::Instant::now();
    expect_closed(&mut socket).await;
    let waited = started.elapsed();
    assert!(
        waited >= Duration::from_millis(4500) && waited < Duration::from_secs(8),
        "{waited:?}"
    );
}

#[tokio::test]
async fn a_wrong_or_missing_origin_and_a_wrong_host_are_refused_at_the_upgrade() {
    let f = start().await;
    for origin in [
        "http://127.0.0.1:3201",
        "http://localhost:3201",
        "http://evil.example:3200",
        "https://127.0.0.1:3200",
        "null",
    ] {
        let r = connect_with(&f, "/ws", Some(origin), None).await;
        assert_eq!(r.err(), Some(StatusCode::FORBIDDEN), "Origin {origin}");
    }
    let r = connect_with(&f, "/ws", None, None).await;
    assert_eq!(r.err(), Some(StatusCode::FORBIDDEN), "Origin 無し");
    let r = connect_with(&f, "/ws", Some(&origin_ok()), Some("evil.example:80")).await;
    assert_eq!(r.err(), Some(StatusCode::FORBIDDEN), "Host が違う");
    // localhost の画面の Origin は通る。
    let ok = connect_with(
        &f,
        "/ws",
        Some(&format!("http://localhost:{CONSOLE_PORT}")),
        None,
    )
    .await;
    assert!(ok.is_ok());
}

#[tokio::test]
async fn a_ticket_in_the_query_is_not_accepted() {
    let f = start().await;
    let ticket = issue_ticket(&f).await;
    let r = connect_with(
        &f,
        &format!("/ws?ticket={ticket}"),
        Some(&origin_ok()),
        None,
    )
    .await;
    assert_eq!(r.err(), Some(StatusCode::BAD_REQUEST));
    // 券は使われていない(クエリでは、何も通らない)。
    assert_eq!(f.ctx.running.tickets.pending(), 1);
}

#[tokio::test]
async fn an_oversized_message_closes_the_connection() {
    let f = start().await;
    // 券の前に大きいメッセージ。
    let mut socket = connect(&f).await;
    let big = "x".repeat(server::ws::MAX_CLIENT_MESSAGE_BYTES + 1024);
    let _ = socket.send(Message::Text(big.into())).await;
    expect_closed(&mut socket).await;
    // つないだあとの大きいメッセージ。
    let mut socket = authed(&f).await;
    let big = "x".repeat(server::ws::MAX_CLIENT_MESSAGE_BYTES + 1024);
    let _ = socket.send(Message::Text(big.into())).await;
    expect_closed(&mut socket).await;
}

#[tokio::test]
async fn after_the_ticket_only_subscribe_unsubscribe_and_pong_are_accepted() {
    let f = start().await;
    for bad in [
        text(serde_json::json!({"type": "ticket", "ticket": "again"})),
        text(serde_json::json!({"type": "stop_everything"})),
        Message::Binary(vec![0].into()),
        Message::Text("{".into()),
    ] {
        let mut socket = authed(&f).await;
        socket.send(bad).await.unwrap();
        expect_closed(&mut socket).await;
    }
}

#[tokio::test]
async fn notifications_progress_and_subscriptions_flow_on_the_connection() {
    let f = start().await;
    let mut socket = authed(&f).await;

    // 通知(今のイベント名のまま)。
    f.ctx
        .events
        .emit("settings:updated", &serde_json::json!({"n": 1}));
    let event = next_text(&mut socket).await.unwrap();
    assert_eq!(event["type"], "event");
    assert_eq!(event["name"], "settings:updated");
    assert_eq!(event["data"]["n"], 1);

    // 購読は、この接続の上のメッセージで行う。
    let target = serde_json::json!({"pid_domain": "windows:test", "pid": 4242, "started_at": 1000});
    socket
        .send(text(
            serde_json::json!({"type": "subscribe", "request_id": 7, "target": target}),
        ))
        .await
        .unwrap();
    let subscribed = next_text(&mut socket).await.unwrap();
    assert_eq!(subscribed["type"], "subscribed");
    assert_eq!(subscribed["request_id"], 7);
    let subscription_id = subscribed["subscription_id"].as_u64().unwrap();
    let conn_id = {
        let guard = f.ctx.state.lock().await;
        assert_eq!(guard.running_sessions[0].subscribers.len(), 1);
        guard.running_sessions[0].subscribers[0].conn_id.clone()
    };

    // 途中経過(会話ごとの連番つきの JSON を、そのまま包む)。
    f.ctx.running.connections.deliver(
        &conn_id,
        ProgressMessage {
            subscription_id,
            progress_json: format!(
                "{{\"subscription_id\":{subscription_id},\"seq\":1,\"progress\":{{\"x\":1}}}}"
            ),
        },
    );
    let progress = next_text(&mut socket).await.unwrap();
    assert_eq!(progress["type"], "progress");
    assert_eq!(progress["data"]["seq"], 1);

    // 無い会話への購読は、失敗が request_id つきで返る(接続は閉じない)。
    socket
        .send(text(
            serde_json::json!({"type": "subscribe", "request_id": 8,
            "target": {"pid_domain": "x", "pid": 1, "started_at": 1}}),
        ))
        .await
        .unwrap();
    let failed = next_text(&mut socket).await.unwrap();
    assert_eq!(failed["type"], "subscribe_failed");
    assert_eq!(failed["request_id"], 8);
    assert_eq!(failed["code"], "not_found");

    // 購読解除。
    socket
        .send(text(
            serde_json::json!({"type": "unsubscribe", "subscription_id": subscription_id}),
        ))
        .await
        .unwrap();
    socket
        .send(text(serde_json::json!({"type": "pong"})))
        .await
        .unwrap();
    for _ in 0..50 {
        if f.ctx.state.lock().await.running_sessions[0]
            .subscribers
            .is_empty()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(f.ctx.state.lock().await.running_sessions[0]
        .subscribers
        .is_empty());
}

#[tokio::test]
async fn closing_the_connection_removes_its_subscriptions_and_its_table_entry() {
    let f = start().await;
    let mut socket = authed(&f).await;
    let target = serde_json::json!({"pid_domain": "windows:test", "pid": 4242, "started_at": 1000});
    socket
        .send(text(
            serde_json::json!({"type": "subscribe", "request_id": 1, "target": target}),
        ))
        .await
        .unwrap();
    assert_eq!(next_text(&mut socket).await.unwrap()["type"], "subscribed");
    assert_eq!(f.ctx.running.connections.len(), 1);
    drop(socket); // タブを閉じた(接続が切れた)
    for _ in 0..100 {
        if f.ctx.running.connections.is_empty()
            && f.ctx.state.lock().await.running_sessions[0]
                .subscribers
                .is_empty()
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    panic!("閉じた接続の表と購読が片づかない");
}

#[tokio::test]
async fn a_connection_whose_queue_overflows_is_closed() {
    let f = start().await;
    let mut socket = authed(&f).await;
    let target = serde_json::json!({"pid_domain": "windows:test", "pid": 4242, "started_at": 1000});
    socket
        .send(text(
            serde_json::json!({"type": "subscribe", "request_id": 1, "target": target}),
        ))
        .await
        .unwrap();
    assert_eq!(next_text(&mut socket).await.unwrap()["type"], "subscribed");
    let conn_id = f.ctx.state.lock().await.running_sessions[0].subscribers[0]
        .conn_id
        .clone();
    // 1 件が 16MB の上限を超える大きさ → すぐ外れて、閉じられる。
    let huge = ProgressMessage {
        subscription_id: 1,
        progress_json: "x".repeat(server::progress::PROGRESS_QUEUE_BYTES + 1),
    };
    assert_eq!(
        f.ctx.running.connections.deliver(&conn_id, huge),
        server::progress::Delivery::Dropped
    );
    expect_closed(&mut socket).await;
}

// ---- 券をもらう rpc(ほかの rpc と同じ守り) ----

fn ticket_request(token: Option<&str>, host_port: u16) -> Request<Body> {
    let mut b = Request::builder()
        .method("POST")
        .uri("/rpc/issue_ws_ticket")
        .header("host", format!("127.0.0.1:{host_port}"))
        .header("content-type", "application/json");
    if let Some(token) = token {
        b = b.header("authorization", format!("Bearer {token}"));
    }
    b.body(Body::from("{}")).unwrap()
}

#[tokio::test]
async fn the_ticket_rpc_needs_the_token_and_the_right_host() {
    let f = start().await;
    let app = router(f.ctx.clone());
    let res = app
        .clone()
        .oneshot(ticket_request(None, f.port))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let res = app
        .clone()
        .oneshot(ticket_request(Some("wrong"), f.port))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let res = app
        .clone()
        .oneshot(ticket_request(Some(TOKEN), f.port + 1))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    assert_eq!(f.ctx.running.tickets.pending(), 0, "断られたら、券は出ない");

    let res = app
        .clone()
        .oneshot(ticket_request(Some(TOKEN), f.port))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["port"], f.port);
    let ticket = body["ticket"].as_str().unwrap();
    assert!(ticket.len() >= 90);
    assert!(f.ctx.running.tickets.consume(ticket));
}

#[tokio::test]
async fn the_number_of_unused_tickets_is_limited() {
    let f = start().await;
    let app = router(f.ctx.clone());
    let mut last = StatusCode::OK;
    for _ in 0..(server::ws::MAX_PENDING_TICKETS + 1) {
        last = app
            .clone()
            .oneshot(ticket_request(Some(TOKEN), f.port))
            .await
            .unwrap()
            .status();
    }
    assert_eq!(last, StatusCode::BAD_REQUEST);
    assert_eq!(
        f.ctx.running.tickets.pending(),
        server::ws::MAX_PENDING_TICKETS
    );
}

#[tokio::test]
async fn without_a_console_port_no_ticket_is_issued_and_nobody_gets_in() {
    let mut f = start().await;
    f.ctx.running.allowed_origins = Arc::new(Vec::new());
    let res = router(f.ctx.clone())
        .oneshot(ticket_request(Some(TOKEN), f.port))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn connections_that_have_not_shown_a_ticket_are_limited() {
    let f = start().await;
    // 何も送らない接続で枠を使い切る。
    let mut idle = Vec::new();
    for _ in 0..server::ws::MAX_UNAUTHENTICATED {
        idle.push(connect(&f).await);
    }
    // 65 本目は、アップグレードの時点で 503。
    let r = connect_with(&f, "/ws", Some(&origin_ok()), None).await;
    assert_eq!(r.err(), Some(StatusCode::SERVICE_UNAVAILABLE));
    // 券を出して確かめを終えた接続は、枠を返す(1 本空けると、また通る)。
    let first = idle.remove(0);
    drop(first);
    for _ in 0..100 {
        if f.ctx
            .running
            .unauthenticated
            .load(std::sync::atomic::Ordering::SeqCst)
            < server::ws::MAX_UNAUTHENTICATED
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let mut again = connect(&f).await;
    let ticket = issue_ticket(&f).await;
    again
        .send(text(
            serde_json::json!({"type": "ticket", "ticket": ticket}),
        ))
        .await
        .unwrap();
    assert_eq!(next_text(&mut again).await.unwrap()["type"], "ready");
    // 確かめを終えた分は数えない。
    assert!(
        f.ctx
            .running
            .unauthenticated
            .load(std::sync::atomic::Ordering::SeqCst)
            < server::ws::MAX_UNAUTHENTICATED
    );
}
