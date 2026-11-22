//! 実行中セッションまわり(段階 3)の、claude を起動しないで確かめられるもの:
//! 途中経過の SSE(接続の ID・あふれたら閉じる・閉じたら購読を片づける)、購読の守り、本文の大きさの上限。
//! claude を実際に(偽物で)起動する確認は `server/scripts/e2e-running.mjs`。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::progress::{Delivery, ProgressMessage, PROGRESS_QUEUE_LEN};
use server::state::{RunningSessionSlot, Subscription};
use server::{router, AppContext, ServerState};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14997;
const TOKEN: &str = "t";

/// 何もしない子プロセス(購読を持たせる入れ物が要るだけ)。
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
    }
}

fn ctx_with_one_session() -> (AppContext, serde_json::Value) {
    let (_tx, rx) = watch::channel(false);
    let mut state = ServerState::new(domain::Settings::default(), "settings.json".into(), false);
    state.running_sessions.push(slot());
    let ctx = AppContext {
        state: Arc::new(Mutex::new(state)),
        events: EventBus::new(),
        token: Arc::new(TOKEN.to_string()),
        port: PORT,
        version: Arc::new("0".to_string()),
        data_dir: Arc::new(std::path::PathBuf::from(".")),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        file_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
        running: Default::default(),
    };
    let target = serde_json::json!({"pid_domain": "windows:test", "pid": 4242, "started_at": 1000});
    (ctx, target)
}

fn post(command: &str, body: String) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/rpc/{command}"))
        .header("host", format!("127.0.0.1:{PORT}"))
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap()
}

async fn call(
    ctx: &AppContext,
    command: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    call_raw(ctx, command, body.to_string()).await
}

async fn call_raw(
    ctx: &AppContext,
    command: &str,
    body: String,
) -> (StatusCode, serde_json::Value) {
    let res = router(ctx.clone())
        .oneshot(post(command, body))
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

async fn open_events(ctx: &AppContext) -> (Body, String) {
    let req = Request::builder()
        .uri("/events")
        .header("host", format!("127.0.0.1:{PORT}"))
        .header("authorization", format!("Bearer {TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let res = router(ctx.clone()).oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let mut body = res.into_body();
    let frame = body.frame().await.unwrap().unwrap();
    let text = String::from_utf8_lossy(frame.data_ref().unwrap()).to_string();
    assert!(text.contains("event: connection"), "{text}");
    let id = text
        .split("\"connection_id\":\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap()
        .to_string();
    (body, id)
}

fn message(n: u64) -> ProgressMessage {
    ProgressMessage {
        subscription_id: n,
        progress_json: format!("{{\"n\":{n}}}"),
    }
}

async fn subscribers(ctx: &AppContext) -> Vec<Subscription> {
    ctx.state.lock().await.running_sessions[0]
        .subscribers
        .clone()
}

#[tokio::test]
async fn the_first_event_is_the_connection_id_and_each_connection_is_distinct() {
    let (ctx, _) = ctx_with_one_session();
    let (_a, id_a) = open_events(&ctx).await;
    let (_b, id_b) = open_events(&ctx).await;
    assert_ne!(id_a, id_b);
    assert!(ctx.running.connections.is_open(&id_a) && ctx.running.connections.is_open(&id_b));
}

#[tokio::test]
async fn a_connection_that_overflows_is_closed_and_its_subscriptions_are_dropped() {
    let (ctx, target) = ctx_with_one_session();
    let (mut slow, slow_id) = open_events(&ctx).await;
    let (_fine, fine_id) = open_events(&ctx).await;
    for conn in [slow_id.clone(), fine_id.clone()] {
        let (status, _) = call(
            &ctx,
            "subscribe_running_session_progress",
            serde_json::json!({"target": target, "connectionId": conn}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    assert_eq!(subscribers(&ctx).await.len(), 2);

    // 読まない接続へ、待ち行列を超えて送る(待たずに外れる)。
    let mut dropped = false;
    for n in 0..(PROGRESS_QUEUE_LEN as u64 + 5) {
        if ctx.running.connections.deliver(&slow_id, message(n)) == Delivery::Dropped {
            dropped = true;
            break;
        }
    }
    assert!(dropped, "待ち行列があふれたら、待たずに外す");
    assert!(!ctx.running.connections.is_open(&slow_id));
    assert!(
        ctx.running.connections.is_open(&fine_id),
        "ほかの接続は残る"
    );

    // 配る側がまとめて外す(イベントループが行う処理と同じ)。
    ctx.state
        .lock()
        .await
        .drop_connection_subscriptions(std::slice::from_ref(&slow_id));
    let left = subscribers(&ctx).await;
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].conn_id, fine_id);

    // あふれた SSE は、たまっていた分を渡し終えたら閉じる(つなぎ直しは、ブラウザが自動で行う)。
    let ended = tokio::time::timeout(Duration::from_secs(5), async {
        while slow.frame().await.is_some() {}
    })
    .await;
    assert!(ended.is_ok(), "あふれた接続の SSE が閉じない");
}

#[tokio::test]
async fn closing_a_stream_removes_its_connection_and_subscriptions() {
    let (ctx, target) = ctx_with_one_session();
    let (body, id) = open_events(&ctx).await;
    let (status, _) = call(
        &ctx,
        "subscribe_running_session_progress",
        serde_json::json!({"target": target, "connectionId": id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(subscribers(&ctx).await.len(), 1);

    drop(body); // タブを閉じた(接続が切れた)
    let cleaned = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if !ctx.running.connections.is_open(&id) && subscribers(&ctx).await.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    assert!(cleaned.is_ok(), "閉じた接続の表と購読が片づかない");
}

#[tokio::test]
async fn subscribing_needs_an_open_connection_and_unsubscribing_is_per_connection() {
    let (ctx, target) = ctx_with_one_session();
    let (status, body) = call(
        &ctx,
        "subscribe_running_session_progress",
        serde_json::json!({"target": target, "connectionId": "00000000-0000-4000-8000-000000000000"}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let (_a, id_a) = open_events(&ctx).await;
    let (_b, id_b) = open_events(&ctx).await;
    let (_, sub_a) = call(
        &ctx,
        "subscribe_running_session_progress",
        serde_json::json!({"target": target, "connectionId": id_a}),
    )
    .await;
    // 別の接続(b)からは、a の購読を外せない。
    let (status, _) = call(
        &ctx,
        "unsubscribe_running_session_progress",
        serde_json::json!({"subscriptionId": sub_a, "connectionId": id_b}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(subscribers(&ctx).await.len(), 1);
    call(
        &ctx,
        "unsubscribe_running_session_progress",
        serde_json::json!({"subscriptionId": sub_a, "connectionId": id_a}),
    )
    .await;
    assert!(subscribers(&ctx).await.is_empty());

    // 無い会話への購読は、接続があっても 404(購読を残さない)。
    let (status, _) = call(
        &ctx,
        "subscribe_running_session_progress",
        serde_json::json!({"target": {"pid_domain": "x", "pid": 1, "started_at": 1}, "connectionId": id_a}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(subscribers(&ctx).await.is_empty());
}

#[tokio::test]
async fn one_connection_cannot_hold_an_unbounded_number_of_subscriptions() {
    let (ctx, target) = ctx_with_one_session();
    let (_a, id) = open_events(&ctx).await;
    let mut last = StatusCode::OK;
    for _ in 0..(server::progress::MAX_SUBSCRIPTIONS_PER_CONNECTION + 1) {
        let (status, _) = call(
            &ctx,
            "subscribe_running_session_progress",
            serde_json::json!({"target": target, "connectionId": id}),
        )
        .await;
        last = status;
    }
    assert_eq!(last, StatusCode::BAD_REQUEST);
    assert_eq!(
        subscribers(&ctx).await.len(),
        server::progress::MAX_SUBSCRIPTIONS_PER_CONNECTION
    );
}

#[tokio::test]
async fn only_send_to_running_session_accepts_a_body_over_2mb() {
    let (ctx, target) = ctx_with_one_session();
    let pad = "x".repeat(3 * 1024 * 1024);

    // ふつうの command は 2MB で 413。
    let (status, _) = call_raw(
        &ctx,
        "get_running_session",
        serde_json::json!({"target": target, "pad": pad}).to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    // send_to_running_session は 26MB まで読む(本文は読めて、中身の判断へ進む。ここでは状態が
    // 「起動している最中」のため 400 で断られる = 413 ではない)。
    let (status, _) = call_raw(
        &ctx,
        "send_to_running_session",
        serde_json::json!({"target": target, "text": pad, "images": []}).to_string(),
    )
    .await;
    assert_ne!(status, StatusCode::PAYLOAD_TOO_LARGE);

    // 26MB を超えると 413。
    let over = "x".repeat(server::rpc::SEND_BODY_LIMIT + 1024);
    let (status, _) = call_raw(
        &ctx,
        "send_to_running_session",
        serde_json::json!({"target": target, "text": over, "images": []}).to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn start_refuses_values_outside_the_enums_and_unregistered_things() {
    let (ctx, _) = ctx_with_one_session();
    for request in [
        serde_json::json!({"kind": "new", "mode": "bogus", "name": null}),
        serde_json::json!({"kind": "new", "mode": "default", "name": null, "model": "../x"}),
        serde_json::json!({"kind": "launch", "mode": "default"}),
    ] {
        let (status, _) = call(
            &ctx,
            "start_running_session",
            serde_json::json!({"request": request}),
        )
        .await;
        assert!(status.is_client_error(), "{request}: {status}");
    }
    // 登録済みのプロファイルのリポジトリが無ければ、起動しない(クライアントのパスは使わない)。
    let (status, body) = call(
        &ctx,
        "start_running_session",
        serde_json::json!({"request": {"kind": "new", "mode": "default", "name": null, "sync_origin_main": false, "cwd": "C:/Windows"}}),
    )
    .await;
    assert!(status.is_client_error(), "{status} {body}");
    assert!(
        ctx.state.lock().await.starting_session_ids.is_empty(),
        "失敗したら起動中の印を残さない"
    );
}

#[tokio::test]
async fn check_image_attachment_accepts_a_body_for_the_largest_image_but_not_much_more() {
    let (ctx, _) = ctx_with_one_session();
    // 画像 1 枚の上限(5,000,000 文字の base64)は、本文の上限(2MB)に掛からず、中身の検証へ進む
    // (中身は画像ではないので 400。413 ではない)。
    let max = "A".repeat(5_000_000);
    let (status, _) = call(
        &ctx,
        "check_image_attachment",
        serde_json::json!({"data": max, "existingCount": 0}),
    )
    .await;
    assert_ne!(status, StatusCode::PAYLOAD_TOO_LARGE);
    // 上限(6MB)を超える本文は 413。
    let over = "A".repeat(server::rpc::IMAGE_CHECK_BODY_LIMIT + 1024);
    let (status, _) = call(
        &ctx,
        "check_image_attachment",
        serde_json::json!({"data": over, "existingCount": 0}),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    // ほかの command は 2MB のまま。
    let pad = "x".repeat(3 * 1024 * 1024);
    let (status, _) = call(&ctx, "get_running_session", serde_json::json!({"pad": pad})).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn connection_ids_are_random_so_an_old_id_never_hits_another_servers_connection() {
    // サーバを起動し直すと、接続の ID は振り直される。乱数(UUID)なので、古いサーバの ID は、新しいサーバの
    // どの接続とも一致しない(古い ID での購読は 404、購読解除は何も起きない)。
    let (old_server, target) = ctx_with_one_session();
    let (_old_conn, old_id) = open_events(&old_server).await;
    assert_eq!(old_id.len(), 36, "UUID の形: {old_id}");

    let (new_server, target) = {
        let (ctx, t) = ctx_with_one_session();
        let _ = &target;
        (ctx, t)
    };
    let (_b, new_id) = open_events(&new_server).await;
    assert_ne!(old_id, new_id);
    // 新しいサーバで、B の購読。
    let (_, sub_b) = call(
        &new_server,
        "subscribe_running_session_progress",
        serde_json::json!({"target": target, "connectionId": new_id}),
    )
    .await;
    assert_eq!(subscribers(&new_server).await.len(), 1);
    // 古い ID での購読は 404。購読 ID が同じでも、古い ID での購読解除は B の購読を外さない。
    let (status, _) = call(
        &new_server,
        "subscribe_running_session_progress",
        serde_json::json!({"target": target, "connectionId": old_id}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &new_server,
        "unsubscribe_running_session_progress",
        serde_json::json!({"subscriptionId": sub_b, "connectionId": old_id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(subscribers(&new_server).await.len(), 1, "B の購読は残る");
}

#[tokio::test]
async fn running_session_snapshot_carries_the_last_progress_sequence_number() {
    let (ctx, target) = ctx_with_one_session();
    let (status, body) = call(
        &ctx,
        "get_running_session",
        serde_json::json!({"target": target}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["progress_seq"], 0, "{body}");
}

#[tokio::test]
async fn subscribing_to_an_exited_session_is_not_found() {
    let (ctx, target) = ctx_with_one_session();
    let (_a, id) = open_events(&ctx).await;
    ctx.state.lock().await.running_sessions[0]
        .session
        .process_state = domain::ProcessState::Exited;
    let (status, body) = call(
        &ctx,
        "subscribe_running_session_progress",
        serde_json::json!({"target": target, "connectionId": id}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert!(subscribers(&ctx).await.is_empty(), "購読を残さない");
}
