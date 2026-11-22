//! 保存するパス・名前の検証(`update_settings`・`check_folder`・`create_profile`・`rename_profile`)と、
//! すでに保存されている不正な値の扱い。使い捨てのデータフォルダだけを使う。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14996;
const TOKEN: &str = "t";

struct Fixture {
    _dir: tempfile::TempDir,
    save_path: PathBuf,
    ctx: AppContext,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let save_path = dir.path().join("settings.json");
    let (_tx, rx) = watch::channel(false);
    let ctx = AppContext {
        state: Arc::new(Mutex::new(ServerState::new(
            domain::Settings::default(),
            save_path.clone(),
            false,
        ))),
        events: EventBus::new(),
        token: Arc::new(TOKEN.to_string()),
        port: PORT,
        version: Arc::new("0".to_string()),
        data_dir: Arc::new(dir.path().to_path_buf()),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
    };
    Fixture {
        _dir: dir,
        save_path,
        ctx,
    }
}

async fn call(
    ctx: &AppContext,
    command: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
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

const BAD_PATHS: [&str; 14] = [
    r"relative\dir",
    "relative/dir",
    r"C:\a\..\b",
    r"C:\a\b::$INDEX_ALLOCATION",
    "C:\\a\nb",
    "C:\\a\u{0}b",
    r"\\host\share\x",
    "//host/share/x",
    r"\\?\C:\x",
    r"\\.\C:\x",
    r"\\?\GLOBALROOT\Device\HarddiskVolume1",
    r"\??\C:\x",
    "C:x",
    r"\no-drive",
];

#[tokio::test]
async fn update_settings_rejects_unsafe_paths_without_changing_anything() {
    let f = fixture();
    for bad in BAD_PATHS {
        for key in ["repository_path", "claude_projects_dir"] {
            let mut input = serde_json::json!({
                "repository_path": null, "github_project": null,
                "selected_project_folders": [], "claude_projects_dir": null
            });
            input[key] = serde_json::json!(bad);
            let (status, body) = call(
                &f.ctx,
                "update_settings",
                serde_json::json!({ "input": input }),
            )
            .await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{key}={bad:?}: {body}");
            assert_eq!(body["code"], "invalid_input");
        }
    }
    // 何も保存されず、メモリも変わらない。
    assert!(!f.save_path.exists(), "不正な値では保存しない");
    let (_, s) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(s["repository_path"], serde_json::Value::Null);

    // 空(未設定)と正しいパスは通る。
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": "  ", "github_project": null,
            "selected_project_folders": [], "claude_projects_dir": "C:/projects/root"
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, s) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(s["repository_path"], serde_json::Value::Null);
    assert_eq!(s["claude_projects_dir"], "C:/projects/root");
}

#[tokio::test]
async fn check_folder_uses_the_same_rule_and_rejects_unc_and_device_forms_by_shape() {
    let f = fixture();
    // 保存と同じ規則(同じ値が、確認でも保存でも断られる)。
    for bad in BAD_PATHS {
        let (status, body) = call(&f.ctx, "check_folder", serde_json::json!({ "path": bad })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad:?}: {body}");
    }
    // UNC・デバイスの形は、宛先へ問い合わせずに即座に断る。
    for bad in [
        r"\\unreachable.invalid\share\x",
        "//10.255.255.1/share/x",
        r"\\?\UNC\unreachable.invalid\share",
        r"\\.\PhysicalDrive0",
        r"\\?\GLOBALROOT\Device\x",
        r"C:\a\CON",
    ] {
        let started = std::time::Instant::now();
        let (status, _) = call(&f.ctx, "check_folder", serde_json::json!({ "path": bad })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad:?}");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(1),
            "形だけで即座に断る: {bad:?}"
        );
    }
}

#[tokio::test]
async fn profile_names_are_validated_on_create_and_rename() {
    let f = fixture();
    let (_, s) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    let id = s["profiles"][0]["id"].as_str().unwrap().to_string();
    let too_long = "a".repeat(101);
    for bad in [too_long.as_str(), "a\nb", "a\u{0}b", "a\tb"] {
        let (status, body) =
            call(&f.ctx, "create_profile", serde_json::json!({ "name": bad })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "create {bad:?}: {body}");
        let (status, body) = call(
            &f.ctx,
            "rename_profile",
            serde_json::json!({"profileId": id, "name": bad}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "rename {bad:?}: {body}");
    }
    let (status, _) = call(
        &f.ctx,
        "rename_profile",
        serde_json::json!({"profileId": id, "name": "   "}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // 前後の空白は落として保存する。
    let (status, _) = call(
        &f.ctx,
        "rename_profile",
        serde_json::json!({"profileId": id, "name": "  ok  "}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, created) = call(
        &f.ctx,
        "create_profile",
        serde_json::json!({"name": "  n  "}),
    )
    .await;
    assert_eq!(created["name"], "n");
    // 省略・空白だけは既定名。
    let (_, created) = call(&f.ctx, "create_profile", serde_json::json!({"name": "  "})).await;
    assert_eq!(created["name"], "新しいプロファイル");
}

#[tokio::test]
async fn already_stored_invalid_paths_do_not_stop_the_server_but_block_reads_and_writes() {
    let f = fixture();
    {
        let mut guard = f.ctx.state.lock().await;
        guard.settings.profiles[0].repository_path = Some(PathBuf::from(r"relative\repo"));
        guard.settings.claude_projects_dir = Some(PathBuf::from(r"\\host\share\projects"));
    }
    // 設定の取得は成功する(画面で直せる)。
    let (status, s) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK, "{s}");
    assert_eq!(s["repository_path"], r"relative\repo");
    // その値を起点にした読み書きは断る。
    for (command, body) in [
        ("get_project_claude_md", serde_json::json!({})),
        (
            "save_project_claude_md",
            serde_json::json!({"content": "x", "expectedModifiedAtMs": null}),
        ),
        ("list_rules", serde_json::json!({})),
        ("list_skills", serde_json::json!({})),
        ("list_projects", serde_json::json!({})),
        ("list_sessions", serde_json::json!({"project": "p"})),
    ] {
        let (status, body) = call(&f.ctx, command, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{command}: {body}");
        assert_eq!(body["code"], "invalid_input");
    }
    // 正しい値(未設定)へ直せる。
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": null, "github_project": null,
            "selected_project_folders": [], "claude_projects_dir": null
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}
