//! 設定・プロファイル系の command(使い捨てのデータフォルダ)。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14998;
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

#[tokio::test]
async fn profile_operations_persist_and_emit_settings_updated() {
    let f = fixture();
    let mut rx = f.ctx.events.subscribe();

    let (status, created) = call(
        &f.ctx,
        "create_profile",
        serde_json::json!({"name": "second"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(created["name"], "second");
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(rx.recv().await.unwrap().name, "settings:updated");

    // 保存されている(ファイルを読み直せる)。
    let saved: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&f.save_path).unwrap()).unwrap();
    assert_eq!(saved["profiles"].as_array().unwrap().len(), 2);
    assert_eq!(saved["active_profile_id"], id.as_str());

    let (status, _) = call(
        &f.ctx,
        "rename_profile",
        serde_json::json!({"profileId": id, "name": "renamed"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, settings) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert!(settings["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["name"] == "renamed"));

    let default_id = settings["profiles"][0]["id"].as_str().unwrap().to_string();
    let (status, _) = call(
        &f.ctx,
        "switch_profile",
        serde_json::json!({"profileId": default_id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, settings) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(settings["active_profile_id"], default_id.as_str());

    let (status, _) = call(
        &f.ctx,
        "delete_profile",
        serde_json::json!({"profileId": id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // 最後の 1 件は消せない。
    let (status, body) = call(
        &f.ctx,
        "delete_profile",
        serde_json::json!({"profileId": default_id}),
    )
    .await;
    assert!(status.is_client_error(), "{status} {body}");
    assert!(body["code"].is_string());
}

#[tokio::test]
async fn update_settings_saves_the_active_profile_and_rejects_unknown_ones() {
    let f = fixture();
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": "C:\\repo",
            "github_project": null,
            "selected_project_folders": ["a", "b"],
            "claude_projects_dir": null
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, settings) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(settings["repository_path"], "C:\\repo");
    assert_eq!(
        settings["selected_project_folders"],
        serde_json::json!(["a", "b"])
    );

    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"profileId": "nope", "input": {
            "repository_path": null, "github_project": null,
            "selected_project_folders": [], "claude_projects_dir": null
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "not_found");

    // 空の owner は拒否され、状態は変わらない。
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": null,
            "github_project": {"owner": "", "number": 1},
            "selected_project_folders": [], "claude_projects_dir": null
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_input");
    let (_, settings) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(settings["repository_path"], "C:\\repo");
}

#[tokio::test]
async fn pending_warnings_are_listed_and_can_be_dismissed() {
    let f = fixture();
    let id = f
        .ctx
        .state
        .lock()
        .await
        .push_warning("settings:corrupted", "壊れていました".to_string());
    let (_, list) = call(&f.ctx, "list_pending_warnings", serde_json::json!({})).await;
    assert_eq!(list[0]["id"], id);
    assert_eq!(list[0]["kind"], "settings:corrupted");
    let (status, _) = call(
        &f.ctx,
        "dismiss_pending_warning",
        serde_json::json!({"id": id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, list) = call(&f.ctx, "list_pending_warnings", serde_json::json!({})).await;
    assert_eq!(list, serde_json::json!([]));
}

#[tokio::test]
async fn check_folder_reports_existence_and_rejects_unsafe_input() {
    let f = fixture();
    let repo = f._dir.path().join("repo");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    let plain = f._dir.path().join("plain");
    std::fs::create_dir_all(&plain).unwrap();

    let (_, body) = call(
        &f.ctx,
        "check_folder",
        serde_json::json!({"path": repo.to_str().unwrap()}),
    )
    .await;
    assert_eq!(body["exists"], true);
    assert_eq!(body["is_dir"], true);
    assert_eq!(body["is_git_repository"], true);

    let (_, body) = call(
        &f.ctx,
        "check_folder",
        serde_json::json!({"path": plain.to_str().unwrap()}),
    )
    .await;
    assert_eq!(body["is_git_repository"], false);

    let missing = f._dir.path().join("missing");
    let (_, body) = call(
        &f.ctx,
        "check_folder",
        serde_json::json!({"path": missing.to_str().unwrap()}),
    )
    .await;
    assert_eq!(body["exists"], false);

    for bad in ["", "relative", "C:\\a\\..\\b"] {
        let (status, body) = call(&f.ctx, "check_folder", serde_json::json!({"path": bad})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad:?}");
        assert_eq!(body["code"], "invalid_input");
    }
}

/// 設定を変える command を同時に大量に送っても、保存が衝突せず(エラー 0)、
/// settings.json が壊れず、ディスクの内容が最後のメモリの状態と一致する。
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn many_concurrent_settings_writes_never_collide_or_corrupt_the_file() {
    let f = fixture();
    // 並行に書き換える対象のプロファイルを 2 つ用意する。
    let (_, a) = call(&f.ctx, "create_profile", serde_json::json!({"name": "a"})).await;
    let (_, b) = call(&f.ctx, "create_profile", serde_json::json!({"name": "b"})).await;
    let ids = [
        a["id"].as_str().unwrap().to_string(),
        b["id"].as_str().unwrap().to_string(),
    ];

    for round in 0..10 {
        let mut tasks = Vec::new();
        for i in 0..40usize {
            let ctx = f.ctx.clone();
            let id = ids[i % 2].clone();
            tasks.push(tokio::spawn(async move {
                match i % 4 {
                    0 => {
                        call(
                            &ctx,
                            "rename_profile",
                            serde_json::json!({"profileId": id, "name": format!("n-{round}-{i}")}),
                        )
                        .await
                    }
                    1 => {
                        call(
                            &ctx,
                            "update_settings",
                            serde_json::json!({"profileId": id, "input": {
                                "repository_path": format!("C:/repo-{round}-{i}"),
                                "github_project": null,
                                "selected_project_folders": [format!("f{i}")],
                                "claude_projects_dir": null
                            }}),
                        )
                        .await
                    }
                    2 => call(&ctx, "switch_profile", serde_json::json!({"profileId": id})).await,
                    _ => call(&ctx, "get_settings", serde_json::json!({})).await,
                }
            }));
        }
        for t in tasks {
            let (status, body) = t.await.unwrap();
            assert_eq!(status, StatusCode::OK, "round {round}: {body}");
        }

        // ディスク = メモリ(最後に書かれたのは最新の状態)で、JSON として読める。
        let on_disk: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&f.save_path).unwrap())
                .expect("settings.json は JSON として読める");
        let in_memory = f.ctx.state.lock().await.settings.clone();
        let expected = serde_json::to_value(&in_memory).unwrap();
        assert_eq!(
            on_disk, expected,
            "round {round}: ディスクとメモリが一致する"
        );
    }

    // 一時ファイルが残っていない。
    let leftovers: Vec<_> = std::fs::read_dir(f.save_path.parent().unwrap())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n != "settings.json")
        .collect();
    assert!(leftovers.is_empty(), "残骸: {leftovers:?}");
}
