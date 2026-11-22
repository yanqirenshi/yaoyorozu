//! 実行中セッションまわり(段階 3)の、claude を起動しないで確かめられるもの:
//! 途中経過の接続(あふれたら閉じる・閉じたら購読を片づける)、購読の守り、本文の大きさの上限。
//! WebSocket の入口そのもの(券・Origin・Host など)は `ws.rs`。
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
        turn_events: Default::default(),
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

/// 接続を 1 本開く(WebSocket の券の確かめのあとと同じ。接続の ID は、サーバの中だけで使う)。
fn open_connection(ctx: &AppContext) -> (server::progress::OpenedConnection, String) {
    let opened = ctx.running.connections.open();
    let id = opened.id.clone();
    (opened, id)
}

/// 購読する(WebSocket の `subscribe` メッセージと同じ処理)。
async fn subscribe(
    ctx: &AppContext,
    conn_id: &str,
    target: &serde_json::Value,
) -> Result<u64, server::error::ApiError> {
    let target: server::dto::RunningSessionRefDto = serde_json::from_value(target.clone()).unwrap();
    server::rpc::running::subscribe_progress(ctx, conn_id, target.into()).await
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
async fn each_connection_gets_its_own_random_id() {
    let (ctx, _) = ctx_with_one_session();
    let (_a, id_a) = open_connection(&ctx);
    let (_b, id_b) = open_connection(&ctx);
    assert_ne!(id_a, id_b);
    assert_eq!(id_a.len(), 36, "UUID の形: {id_a}");
    assert!(ctx.running.connections.is_open(&id_a) && ctx.running.connections.is_open(&id_b));
}

#[tokio::test]
async fn a_connection_that_overflows_is_closed_and_its_subscriptions_are_dropped() {
    let (ctx, target) = ctx_with_one_session();
    let (mut slow, slow_id) = open_connection(&ctx);
    let (_fine, fine_id) = open_connection(&ctx);
    for conn in [&slow_id, &fine_id] {
        subscribe(&ctx, conn, &target).await.unwrap();
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
    assert!(*slow.kicked.borrow(), "閉じる合図が出る");

    // 配る側がまとめて外す(イベントループが行う処理と同じ)。
    ctx.state
        .lock()
        .await
        .drop_connection_subscriptions(std::slice::from_ref(&slow_id));
    let left = subscribers(&ctx).await;
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].conn_id, fine_id);

    // あふれた接続の受け取り口は、たまっていた分を捨てて終わる(画面は、つなぎ直して購読し直す)。
    let ended = tokio::time::timeout(Duration::from_secs(5), slow.receiver.recv()).await;
    assert!(
        matches!(ended, Ok(None)),
        "あふれた接続の受け取り口が終わらない"
    );
}

#[tokio::test]
async fn subscribing_needs_an_open_connection_and_unsubscribing_is_per_connection() {
    let (ctx, target) = ctx_with_one_session();
    let err = subscribe(&ctx, "00000000-0000-4000-8000-000000000000", &target)
        .await
        .expect_err("無い接続への購読は断る");
    assert_eq!(err.0.code, "not_found");

    let (_a, id_a) = open_connection(&ctx);
    let (_b, id_b) = open_connection(&ctx);
    let sub_a = subscribe(&ctx, &id_a, &target).await.unwrap();
    // 別の接続(b)からは、a の購読を外せない。
    server::rpc::running::unsubscribe_progress(&ctx, &id_b, sub_a).await;
    assert_eq!(subscribers(&ctx).await.len(), 1);
    server::rpc::running::unsubscribe_progress(&ctx, &id_a, sub_a).await;
    assert!(subscribers(&ctx).await.is_empty());

    // 無い会話への購読は、接続があっても not_found(購読を残さない)。
    let err = subscribe(
        &ctx,
        &id_a,
        &serde_json::json!({"pid_domain": "x", "pid": 1, "started_at": 1}),
    )
    .await
    .expect_err("無い会話への購読は断る");
    assert_eq!(err.0.code, "not_found");
    assert!(subscribers(&ctx).await.is_empty());
}

#[tokio::test]
async fn one_connection_cannot_hold_an_unbounded_number_of_subscriptions() {
    let (ctx, target) = ctx_with_one_session();
    let (_a, id) = open_connection(&ctx);
    let mut last = None;
    for _ in 0..(server::progress::MAX_SUBSCRIPTIONS_PER_CONNECTION + 1) {
        last = Some(subscribe(&ctx, &id, &target).await);
    }
    assert_eq!(
        last.unwrap().expect_err("上限を超えたら断る").0.code,
        "invalid_input"
    );
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
    // どの接続とも一致しない(古い ID での購読は not_found、購読解除は何も起きない)。
    let (old_server, _) = ctx_with_one_session();
    let (_old_conn, old_id) = open_connection(&old_server);

    let (new_server, target) = ctx_with_one_session();
    let (_b, new_id) = open_connection(&new_server);
    assert_ne!(old_id, new_id);
    let sub_b = subscribe(&new_server, &new_id, &target).await.unwrap();
    assert_eq!(subscribers(&new_server).await.len(), 1);
    let err = subscribe(&new_server, &old_id, &target)
        .await
        .expect_err("古い ID での購読は断る");
    assert_eq!(err.0.code, "not_found");
    server::rpc::running::unsubscribe_progress(&new_server, &old_id, sub_b).await;
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
    let (_a, id) = open_connection(&ctx);
    ctx.state.lock().await.running_sessions[0]
        .session
        .process_state = domain::ProcessState::Exited;
    let err = subscribe(&ctx, &id, &target)
        .await
        .expect_err("終了したセッションへの購読は断る");
    assert_eq!(err.0.code, "not_found");
    assert!(subscribers(&ctx).await.is_empty(), "購読を残さない");
}

#[tokio::test]
async fn the_snapshot_carries_the_turn_so_far_and_it_is_dropped_when_the_turn_finishes() {
    use server::dto::ProgressEventDto;
    let (ctx, target) = ctx_with_one_session();
    {
        let mut guard = ctx.state.lock().await;
        let slot = &mut guard.running_sessions[0];
        for seq in 1..=3 {
            slot.turn_events.record(
                seq,
                ProgressEventDto::TextDelta {
                    text: format!("[{seq}]"),
                },
                false,
            );
        }
        slot.progress_seq = 3;
    }
    let (status, body) = call(
        &ctx,
        "get_running_session",
        serde_json::json!({"target": target}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["progress_seq"], 3);
    let events = body["turn_events"].as_array().unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(events[0]["seq"], 1);
    assert_eq!(events[2]["event"]["text"], "[3]");

    // ターンが終わると捨てる(確定した内容は会話ファイルにある)。
    {
        let mut guard = ctx.state.lock().await;
        guard.running_sessions[0].turn_events.record(
            4,
            ProgressEventDto::TurnFinished { succeeded: true },
            true,
        );
    }
    let (_, body) = call(
        &ctx,
        "get_running_session",
        serde_json::json!({"target": target}),
    )
    .await;
    assert!(body["turn_events"].as_array().unwrap().is_empty());
}

#[test]
fn the_turn_buffer_drops_the_oldest_when_it_gets_too_big() {
    use server::dto::ProgressEventDto;
    use server::state::TurnBuffer;
    let mut buffer = TurnBuffer::default();
    let big = "x".repeat(100_000);
    for seq in 1..=100u64 {
        buffer.record(
            seq,
            ProgressEventDto::TextDelta { text: big.clone() },
            false,
        );
    }
    // 2MB の上限: 古いほうから捨て、新しいほうが残る(番号は連続のまま)。
    let kept = buffer.snapshot();
    assert!(kept.len() < 100 && kept.len() >= 15, "{}", kept.len());
    assert_eq!(kept.last().unwrap().seq, 100);
    assert!(kept.windows(2).all(|w| w[1].seq == w[0].seq + 1));
    // 件数の上限。
    let mut buffer = TurnBuffer::default();
    for seq in 1..=(TurnBuffer::MAX_EVENTS as u64 + 10) {
        buffer.record(seq, ProgressEventDto::TextDelta { text: "a".into() }, false);
    }
    assert_eq!(buffer.len(), TurnBuffer::MAX_EVENTS);
}
