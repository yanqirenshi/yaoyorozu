//! HTTP 層のテスト(認証・Host・エラーの形・`get_settings`)。ネットワークは使わず、
//! ルーターへ直接リクエストを渡す。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14999;
const TOKEN: &str = "test-token";

fn app() -> axum::Router {
    let (_tx, rx) = watch::channel(false);
    router(AppContext {
        state: Arc::new(Mutex::new(ServerState::new(
            domain::Settings::default(),
            std::path::PathBuf::from("settings.json"),
            false,
        ))),
        events: EventBus::new(),
        token: Arc::new(TOKEN.to_string()),
        port: PORT,
        version: Arc::new("0.0.0".to_string()),
        data_dir: Arc::new(std::path::PathBuf::from(".")),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
    })
}

fn request(
    method: &str,
    path: &str,
    host: Option<&str>,
    token: Option<&str>,
    body: &str,
) -> Request<Body> {
    let mut b = Request::builder().method(method).uri(path);
    if let Some(host) = host {
        b = b.header("host", host);
    }
    if let Some(token) = token {
        b = b.header("authorization", format!("Bearer {token}"));
    }
    b.header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn send(req: Request<Body>) -> (StatusCode, serde_json::Value) {
    let res = app().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

const HOST: &str = "127.0.0.1:14999";

#[tokio::test]
async fn health_needs_no_token_but_needs_a_valid_host() {
    let (status, body) = send(request("GET", "/health", Some(HOST), None, "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = send(request(
        "GET",
        "/health",
        Some("evil.example:14999"),
        None,
        "",
    ))
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "forbidden_host");
}

#[tokio::test]
async fn rpc_without_or_with_a_wrong_token_is_rejected() {
    for token in [None, Some("wrong")] {
        let (status, body) = send(request(
            "POST",
            "/rpc/get_settings",
            Some(HOST),
            token,
            "{}",
        ))
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["code"], "unauthorized");
    }
}

#[tokio::test]
async fn events_also_requires_the_token() {
    let (status, _) = send(request("GET", "/events", Some(HOST), None, "")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_wrong_host_is_rejected_even_with_the_right_token() {
    for host in [
        "evil.example",
        "127.0.0.1:1",
        "127.0.0.1.evil.example:14999",
    ] {
        let (status, _) = send(request(
            "POST",
            "/rpc/get_settings",
            Some(host),
            Some(TOKEN),
            "{}",
        ))
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{host}");
    }
    // Host が無い要求も拒否する。
    let (status, _) = send(request(
        "POST",
        "/rpc/get_settings",
        None,
        Some(TOKEN),
        "{}",
    ))
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn localhost_host_is_accepted() {
    let (status, _) = send(request(
        "POST",
        "/rpc/get_settings",
        Some("localhost:14999"),
        Some(TOKEN),
        "",
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn get_settings_returns_the_dto_shape() {
    let (status, body) = send(request(
        "POST",
        "/rpc/get_settings",
        Some(HOST),
        Some(TOKEN),
        "{}",
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["profiles"].is_array());
    assert!(body["active_profile_id"].is_string());
    assert!(body["effective_projects_dir"].is_string());
}

#[tokio::test]
async fn an_unknown_profile_is_not_found_with_the_error_dto() {
    let (status, body) = send(request(
        "POST",
        "/rpc/get_settings",
        Some(HOST),
        Some(TOKEN),
        r#"{"profileId":"nope"}"#,
    ))
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "not_found");
    assert!(body["message"].is_string());
}

#[tokio::test]
async fn broken_arguments_and_unknown_commands_use_the_error_dto() {
    let (status, body) = send(request(
        "POST",
        "/rpc/get_settings",
        Some(HOST),
        Some(TOKEN),
        "[1",
    ))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_input");

    let (status, body) = send(request(
        "POST",
        "/rpc/no_such",
        Some(HOST),
        Some(TOKEN),
        "{}",
    ))
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "not_found");
}
