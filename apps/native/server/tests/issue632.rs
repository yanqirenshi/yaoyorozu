//! #632(段階 3 の残り)のサーバ側の確認。使い捨てのフォルダだけを使う。claude は起動しない。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14992;
const TOKEN: &str = "t";

struct Fixture {
    dir: tempfile::TempDir,
    ctx: AppContext,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let (_tx, rx) = watch::channel(false);
    let ctx = AppContext {
        state: Arc::new(Mutex::new(ServerState::new(
            domain::Settings::default(),
            dir.path().join("settings.json"),
            false,
        ))),
        events: EventBus::new(),
        token: Arc::new(TOKEN.to_string()),
        port: PORT,
        version: Arc::new("0".to_string()),
        data_dir: Arc::new(dir.path().to_path_buf()),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        file_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
        // 万一、起動まで進んでも本物の claude を起こさない(存在しないコマンドへ差し替える)。
        running: server::running::RunningServices {
            claude_override: Some(server::running::ClaudeOverride {
                program: "yyz-no-such-claude-command".to_string(),
                leading_args: Vec::new(),
            }),
            ..Default::default()
        },
    };
    Fixture { dir, ctx }
}

async fn call(
    ctx: &AppContext,
    command: &str,
    mut body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    if command == "update_settings" {
        if body.get("expectedRevision").is_none() {
            body["expectedRevision"] = serde_json::json!(ctx.state.lock().await.settings.revision);
        }
        if body.get("profileId").is_none() {
            body["profileId"] =
                serde_json::json!(ctx.state.lock().await.settings.active_profile_id);
        }
    }
    let req = Request::builder()
        .method("POST")
        .uri(format!("/rpc/{command}"))
        .header("host", format!("127.0.0.1:{PORT}"))
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = router(ctx.clone()).oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

fn forward(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn pending_warnings(ctx: &AppContext) -> Vec<String> {
    let (_, body) = call(ctx, "list_pending_warnings", serde_json::json!({})).await;
    body.as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|w| w["message"].as_str().map(str::to_string))
        .collect()
}

// --- 4. 壊れた控え・台帳を、黙って退避しない ---

fn corrupt_files(dir: &Path, base: &str) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with(&format!("{base}.corrupt.")))
        .collect()
}

#[tokio::test]
async fn a_corrupt_restore_ledger_is_reported_with_a_warning_without_the_full_path() {
    let f = fixture();
    std::fs::write(
        f.dir.path().join("running-sessions.json"),
        "{ これは JSON ではない",
    )
    .unwrap();
    server::running::with_restorable_store(&f.ctx, "テスト", |store| {
        app::forget_running_session(store, "some-session")
    })
    .await;
    assert_eq!(
        corrupt_files(f.dir.path(), "running-sessions.json").len(),
        1,
        "退避された"
    );
    let warnings = pending_warnings(&f.ctx).await;
    let hit: Vec<_> = warnings
        .iter()
        .filter(|m| m.contains("running-sessions.json"))
        .collect();
    assert_eq!(hit.len(), 1, "{warnings:?}");
    assert!(
        hit[0].contains(".corrupt."),
        "退避先の名前が出る: {}",
        hit[0]
    );
    let dir_text = f.dir.path().to_string_lossy().to_string();
    assert!(
        !hit[0].contains(&dir_text) && !hit[0].contains("Temp"),
        "フルパスを入れない: {}",
        hit[0]
    );
    // 2 回目(もう壊れていない)では、同じ知らせを出し直さない。
    server::running::with_restorable_store(&f.ctx, "テスト", |store| {
        app::forget_running_session(store, "another")
    })
    .await;
    let again = pending_warnings(&f.ctx).await;
    assert_eq!(
        again
            .iter()
            .filter(|m| m.contains("running-sessions.json"))
            .count(),
        1
    );
}

#[tokio::test]
async fn a_corrupt_archive_ledger_is_reported_when_listing_sessions() {
    let f = fixture();
    let projects = f.dir.path().join("projects");
    std::fs::create_dir_all(projects.join("proj1")).unwrap();
    let repo = f.dir.path().join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": forward(&repo), "github_project": null,
            "selected_project_folders": [], "claude_projects_dir": forward(&projects)
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    std::fs::write(f.dir.path().join("archived-sessions.json"), "[壊れた").unwrap();
    let (status, _) = call(
        &f.ctx,
        "list_sessions",
        serde_json::json!({"project": "proj1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let warnings = pending_warnings(&f.ctx).await;
    assert!(
        warnings
            .iter()
            .any(|m| m.contains("archived-sessions.json")),
        "{warnings:?}"
    );
}

#[test]
fn the_watch_sees_only_files_evacuated_after_it_started() {
    let dir = tempfile::tempdir().unwrap();
    // 前から残っている退避ファイルは、知らせない。
    std::fs::write(dir.path().join("git-ledger.json.corrupt.1"), "old").unwrap();
    let watch = server::corruption::Watch::start(dir.path(), "git-ledger.json");
    assert!(watch.evacuated().is_empty());
    std::fs::write(dir.path().join("git-ledger.json"), "壊れた").unwrap();
    let _ = app::load_git_ledger(&infra::FileGitLedgerStore::new(
        dir.path().join("git-ledger.json"),
    ));
    let names = watch.evacuated();
    assert_eq!(names.len(), 1, "{names:?}");
    assert_ne!(names[0], "git-ledger.json.corrupt.1");
    assert!(watch.message(&names[0]).contains("git-ledger.json"));
}

// --- 8. 会話 ID は小文字にそろえる(入口・控え・アーカイブの印) ---

const UPPER_ID: &str = "0A1B2C3D-1111-4222-8333-444455556666";

#[tokio::test]
async fn archive_marks_are_written_and_compared_in_lowercase() {
    let f = fixture();
    // 大文字の ID で archive しても、印は小文字で 1 つだけ。
    let (status, _) = call(
        &f.ctx,
        "archive_session",
        serde_json::json!({"project": "proj1", "sessionId": UPPER_ID}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let marks: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.dir.path().join("archived-sessions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        marks["session_ids"],
        serde_json::json!([UPPER_ID.to_ascii_lowercase()])
    );
    // 小文字・大文字のどちらで外しても、外れる。
    let (status, _) = call(
        &f.ctx,
        "unarchive_session",
        serde_json::json!({"project": "proj1", "sessionId": UPPER_ID}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let marks: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.dir.path().join("archived-sessions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(marks["session_ids"], serde_json::json!([]));
}

#[tokio::test]
async fn an_existing_uppercase_row_is_normalized_and_merged_when_the_ledger_is_read() {
    let f = fixture();
    std::fs::write(
        f.dir.path().join("archived-sessions.json"),
        format!(
            r#"{{"version":1,"session_ids":["{UPPER_ID}","{}"]}}"#,
            UPPER_ID.to_ascii_lowercase()
        ),
    )
    .unwrap();
    // 小文字の ID で印を付け直しても、1 行のまま(大文字の行が残って、小文字の行が足されない)。
    let (status, _) = call(
        &f.ctx,
        "archive_session",
        serde_json::json!({"project": "proj1", "sessionId": UPPER_ID.to_ascii_lowercase()}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let marks: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.dir.path().join("archived-sessions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        marks["session_ids"],
        serde_json::json!([UPPER_ID.to_ascii_lowercase()])
    );
}
