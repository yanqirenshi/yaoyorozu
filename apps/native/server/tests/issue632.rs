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
        let guard = ctx.state.lock().await;
        if body.get("profileId").is_none() {
            body["profileId"] = serde_json::json!(guard.settings.active_profile_id);
        }
        let target = body["profileId"].as_str().unwrap_or("").to_string();
        let profile_revision = guard
            .settings
            .profiles
            .iter()
            .find(|p| p.id == target)
            .map(|p| p.revision)
            .unwrap_or(0);
        if body.get("expectedRevision").is_none() {
            body["expectedRevision"] = serde_json::json!(profile_revision);
        }
        if body.get("expectedGlobalRevision").is_none() {
            body["expectedGlobalRevision"] = serde_json::json!(guard.settings.revision);
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

// --- 7. 細かい点 ---

#[tokio::test]
async fn a_dismissed_skip_warning_stays_dismissed_after_a_restart_and_a_touch_but_not_after_a_real_change(
) {
    let f = fixture();
    let projects = f.dir.path().join("projects");
    let proj = projects.join("proj1");
    std::fs::create_dir_all(&proj).unwrap();
    let broken = proj.join("broken.jsonl");
    std::fs::write(&broken, "壊れた内容\n{ 途中").unwrap();
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
    let list = |ctx: AppContext| async move {
        call(
            &ctx,
            "list_sessions",
            serde_json::json!({"project": "proj1"}),
        )
        .await
    };
    let warning_id = |ctx: AppContext| async move {
        let (_, body) = call(&ctx, "list_pending_warnings", serde_json::json!({})).await;
        body.as_array()
            .unwrap()
            .iter()
            .find(|w| w["message"].as_str().unwrap().contains("broken.jsonl"))
            .map(|w| w["id"].as_u64().unwrap())
    };

    list(f.ctx.clone()).await;
    let id = warning_id(f.ctx.clone()).await.expect("警告が出る");
    let (status, _) = call(
        &f.ctx,
        "dismiss_pending_warning",
        serde_json::json!({"id": id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        f.dir.path().join(server::dismissed::FILE_NAME).is_file(),
        "閉じた印がデータフォルダに保存される"
    );

    // サーバを起動し直した(新しい状態が、保存した印を読む)。更新時刻だけが変わっても、出し直さない。
    let restarted = fixture_in(f.dir.path());
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(&broken)
        .unwrap();
    file.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(120))
        .unwrap();
    drop(file);
    restarted.state.lock().await.dismissed_skips = server::dismissed::load(f.dir.path());
    let (status, _) = call(
        &restarted,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": forward(&repo), "github_project": null,
            "selected_project_folders": [], "claude_projects_dir": forward(&projects)
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    list(restarted.clone()).await;
    assert!(
        warning_id(restarted.clone()).await.is_none(),
        "更新時刻だけの変化では、出し直さない"
    );

    // 中身が実際に変わったら、また出る。
    std::fs::write(&broken, "別の壊れた内容\n{ 途中 2").unwrap();
    list(restarted.clone()).await;
    assert!(warning_id(restarted.clone()).await.is_some());
}

/// 同じデータフォルダを使う、新しいサーバの状態(再起動のつもり)。
fn fixture_in(dir: &Path) -> AppContext {
    let (_tx, rx) = watch::channel(false);
    AppContext {
        state: Arc::new(Mutex::new(ServerState::new(
            domain::Settings::default(),
            dir.join("settings.json"),
            false,
        ))),
        events: EventBus::new(),
        token: Arc::new(TOKEN.to_string()),
        port: PORT,
        version: Arc::new("0".to_string()),
        data_dir: Arc::new(dir.to_path_buf()),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        file_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
        running: Default::default(),
    }
}

#[test]
fn the_reserved_names_include_the_superscript_digits_and_the_extra_device_names() {
    for name in [
        "COM\u{B9}",
        "COM\u{B2}",
        "COM\u{B3}",
        "LPT\u{B9}",
        "LPT\u{B2}",
        "LPT\u{B3}",
        "CONERR$",
        "CLOCK$",
        "conerr$.txt",
        "Clock$",
    ] {
        assert!(domain::is_reserved_device_name(name), "{name:?}");
    }
    for name in ["COM\u{2074}", "CONSOLE", "clock", "repo"] {
        assert!(!domain::is_reserved_device_name(name), "{name:?}");
    }
}

// --- 11. 設定の版を、プロファイルごとに持つ ---

fn settings_input(repo: &str, root: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "repository_path": repo, "github_project": null,
        "selected_project_folders": [], "claude_projects_dir": root
    })
}

async fn get_revisions(ctx: &AppContext, profile: &str) -> (u64, u64) {
    let (_, body) = call(
        ctx,
        "get_settings",
        serde_json::json!({"profileId": profile}),
    )
    .await;
    (
        body["revision"].as_u64().unwrap(),
        body["global_revision"].as_u64().unwrap(),
    )
}

#[tokio::test]
async fn two_tabs_saving_different_profiles_from_the_same_version_both_succeed() {
    let f = fixture();
    let first = f.ctx.state.lock().await.settings.active_profile_id.clone();
    let (_, created) = call(&f.ctx, "create_profile", serde_json::json!({"name": "b"})).await;
    let second = created["id"].as_str().unwrap().to_string();
    let a = forward(&f.dir.path().join("repo-a"));
    let b = forward(&f.dir.path().join("repo-b"));
    std::fs::create_dir_all(f.dir.path().join("repo-a")).unwrap();
    std::fs::create_dir_all(f.dir.path().join("repo-b")).unwrap();

    // どちらのタブも、同じ時点(両プロファイルの版は 0)から保存する。
    let (rev_a, global) = get_revisions(&f.ctx, &first).await;
    let (rev_b, _) = get_revisions(&f.ctx, &second).await;
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": settings_input(&a, None), "profileId": first,
            "expectedRevision": rev_a, "expectedGlobalRevision": global}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["revision"], rev_a + 1);
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": settings_input(&b, None), "profileId": second,
            "expectedRevision": rev_b, "expectedGlobalRevision": global}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "後のタブの保存も通る: {body}");
    // 別のプロファイルの保存では、お互いの版は進まない。
    assert_eq!(get_revisions(&f.ctx, &first).await.0, rev_a + 1);
    assert_eq!(get_revisions(&f.ctx, &second).await.0, rev_b + 1);
    assert_eq!(
        get_revisions(&f.ctx, &first).await.1,
        global,
        "全体の版は進まない"
    );
}

#[tokio::test]
async fn unrelated_profile_operations_do_not_make_a_save_conflict() {
    let f = fixture();
    let first = f.ctx.state.lock().await.settings.active_profile_id.clone();
    let repo = forward(&f.dir.path().join("repo-a"));
    std::fs::create_dir_all(f.dir.path().join("repo-a")).unwrap();
    let (rev, global) = get_revisions(&f.ctx, &first).await;
    // 関係のない操作(作成・切替・改名・別のプロファイルの削除)。
    let (_, created) = call(&f.ctx, "create_profile", serde_json::json!({"name": "x"})).await;
    let other = created["id"].as_str().unwrap().to_string();
    call(
        &f.ctx,
        "switch_profile",
        serde_json::json!({"profileId": other}),
    )
    .await;
    call(
        &f.ctx,
        "rename_profile",
        serde_json::json!({"profileId": other, "name": "y"}),
    )
    .await;
    call(
        &f.ctx,
        "switch_profile",
        serde_json::json!({"profileId": first}),
    )
    .await;
    call(
        &f.ctx,
        "delete_profile",
        serde_json::json!({"profileId": other}),
    )
    .await;
    assert_eq!(
        get_revisions(&f.ctx, &first).await,
        (rev, global),
        "どの版も進まない"
    );
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": settings_input(&repo, None), "profileId": first,
            "expectedRevision": rev, "expectedGlobalRevision": global}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn a_stale_profile_version_or_a_stale_global_version_is_a_conflict() {
    let f = fixture();
    let first = f.ctx.state.lock().await.settings.active_profile_id.clone();
    let (_, created) = call(&f.ctx, "create_profile", serde_json::json!({"name": "b"})).await;
    let second = created["id"].as_str().unwrap().to_string();
    for d in ["repo-a", "repo-b", "root"] {
        std::fs::create_dir_all(f.dir.path().join(d)).unwrap();
    }
    let a = forward(&f.dir.path().join("repo-a"));
    let b = forward(&f.dir.path().join("repo-b"));
    let root = forward(&f.dir.path().join("root"));
    let (rev_a, global) = get_revisions(&f.ctx, &first).await;
    let (rev_b, _) = get_revisions(&f.ctx, &second).await;

    // 同じプロファイルを、同じ版から 2 回: 後のほうは 409。
    let save = |profile: &str, repo: &str, root: Option<&str>, rev: u64, global: u64| {
        serde_json::json!({"input": settings_input(repo, root), "profileId": profile,
            "expectedRevision": rev, "expectedGlobalRevision": global})
    };
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        save(&first, &a, None, rev_a, global),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        save(&first, &b, None, rev_a, global),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(
        body["code"], "settings_conflict",
        "プロファイルの版の食い違いは、code で分かる"
    );

    // 全体の欄(claude_projects_dir)を別のタブが変えたら、古い全体の版からの保存は、別のプロファイルでも 409
    // (全体の欄を、古い値で黙って戻さない)。
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        save(&second, &b, Some(&root), rev_b, global),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["global_revision"], global + 1);
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        save(&first, &a, None, rev_a + 1, global),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(
        body["code"], "settings_global_conflict",
        "全体の版の食い違いは、code で分かる"
    );
    // 取り直した全体の版からなら通る。
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        save(&first, &a, Some(&root), rev_a + 1, global + 1),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn expected_global_revision_is_required() {
    let f = fixture();
    let first = f.ctx.state.lock().await.settings.active_profile_id.clone();
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": settings_input("", None), "profileId": first, "expectedRevision": 0,
            "expectedGlobalRevision": null}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn saving_the_same_values_does_not_advance_either_version() {
    let f = fixture();
    let first = f.ctx.state.lock().await.settings.active_profile_id.clone();
    std::fs::create_dir_all(f.dir.path().join("repo-a")).unwrap();
    let repo = forward(&f.dir.path().join("repo-a"));
    let (rev, global) = get_revisions(&f.ctx, &first).await;
    let save = |rev: u64, global: u64| {
        serde_json::json!({"input": settings_input(&repo, None), "profileId": first,
            "expectedRevision": rev, "expectedGlobalRevision": global})
    };
    let (_, body) = call(&f.ctx, "update_settings", save(rev, global)).await;
    assert_eq!(body["revision"], rev + 1, "値が変わったので進む");
    assert_eq!(body["global_revision"], global, "全体の欄は変わっていない");
    // 同じ値をもう一度保存しても、どちらの版も進まない。
    let (status, body) = call(&f.ctx, "update_settings", save(rev + 1, global)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["revision"], rev + 1);
    assert_eq!(body["global_revision"], global);
}

// --- 18. 自動再開は、アーカイブ済みの会話を起動しない ---

#[tokio::test]
async fn an_automatic_restore_does_not_start_an_archived_conversation_and_keeps_the_mark() {
    let f = fixture();
    let session = "0a1b2c3d-1111-4222-8333-444455556666";
    let repo = f.dir.path().join("repo");
    let projects = f.dir.path().join("projects");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::create_dir_all(projects.join("proj1")).unwrap();
    let line = serde_json::json!({
        "type": "user", "sessionId": session, "cwd": forward(&repo),
        "message": {"role": "user", "content": "hello"}
    });
    std::fs::write(
        projects.join("proj1").join(format!("{session}.jsonl")),
        format!("{line}\n"),
    )
    .unwrap();
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
    // 自動再開の途中(起動の直前)より前に、利用者がアーカイブした。
    let (status, _) = call(
        &f.ctx,
        "archive_session",
        serde_json::json!({"project": "proj1", "sessionId": session}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let request: server::dto::StartRunningSessionDto = serde_json::from_value(serde_json::json!({
        "kind": "resume", "project": "proj1", "session_id": session,
        "mode": "default", "name": null, "sync_origin_main": false
    }))
    .unwrap();
    let profile = f.ctx.state.lock().await.settings.active_profile_id.clone();
    let result = server::running::start_restored_session(&f.ctx, Some(profile), request).await;
    assert!(
        matches!(&result, Err(app::AppError::InvalidInput(m)) if m == server::running::ARCHIVED_SKIP_REASON),
        "{result:?}"
    );
    assert!(
        f.ctx.state.lock().await.running_sessions.is_empty(),
        "起動していない"
    );
    assert!(
        f.ctx.state.lock().await.starting_session_ids.is_empty(),
        "起動中の印を残さない"
    );
    let marks: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.dir.path().join("archived-sessions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        marks["session_ids"],
        serde_json::json!([session]),
        "印は外さない"
    );
}

// --- 16. 画像の上限の数字は、サーバの 1 か所から出す ---

#[tokio::test]
async fn the_attachment_limits_come_from_the_server() {
    let f = fixture();
    let (status, body) = call(&f.ctx, "get_attachment_limits", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["max_image_bytes"], 3_750_000);
    assert_eq!(body["max_images"], 5);
}

// --- 18(再検証)アーカイブは、起動している最中の会話も、必ず「印あり・動いていない・控えに無い」に落ち着かせる ---

struct StopFlagProcess(Arc<std::sync::atomic::AtomicBool>);

impl app::RunningProcess for StopFlagProcess {
    fn pid(&self) -> u32 {
        4243
    }
    fn pid_domain(&self) -> String {
        "windows:test".to_string()
    }
    fn send_user_message(
        &self,
        _: &str,
        _: &[domain::ImageAttachment],
    ) -> Result<(), app::AppError> {
        Ok(())
    }
    fn respond_permission(&self, _: &domain::PermissionResponse) -> Result<(), app::AppError> {
        Ok(())
    }
    fn interrupt(&self) -> Result<(), app::AppError> {
        Ok(())
    }
    fn set_model(&self, _: &str) -> Result<(), app::AppError> {
        Ok(())
    }
    fn set_permission_mode(&self, _: app::RunningPermissionMode) -> Result<(), app::AppError> {
        Ok(())
    }
    fn get_usage(&self) -> Result<(), app::AppError> {
        Ok(())
    }
    fn stop(&self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[tokio::test]
async fn archiving_while_a_session_is_starting_waits_then_stops_it_and_forgets_it() {
    let f = fixture();
    let session = "0a1b2c3d-1111-4222-8333-444455556666";
    // 再開の控えに、この会話がある。
    std::fs::write(
        f.dir.path().join("running-sessions.json"),
        format!(
            r#"{{"version":1,"sessions":[{{"profile_id":"p","project":"proj1","session_id":"{session}","permission_mode":"default","model":null,"name":null,"worktree_id":"main-worktree"}}]}}"#
        ),
    )
    .unwrap();
    // 起動している最中(実行中の一覧には、まだ載っていない)。
    f.ctx
        .state
        .lock()
        .await
        .starting_session_ids
        .push(session.to_string());

    let ctx = f.ctx.clone();
    let archive =
        tokio::spawn(async move { server::running::archive_session_settled(&ctx, session).await });
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    assert!(!archive.is_finished(), "起動している最中は、終わるまで待つ");
    // 印は先に付いている(自動再開の、起動の直前の確かめが見られる)。
    let marks: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.dir.path().join("archived-sessions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(marks["session_ids"], serde_json::json!([session]));

    // 起動が終わった(実行中の一覧に載り、起動の最中の印が外れる。同じロックの中)。
    let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut guard = f.ctx.state.lock().await;
        let base = domain::RunningSession::new(session, "windows:test", 4243, 1000);
        guard
            .running_sessions
            .push(server::state::RunningSessionSlot {
                progress_seq: 0,
                project: Some("proj1".to_string()),
                session: domain::RunningSessionByApp::new(
                    base,
                    "C:/repo".into(),
                    "main-worktree",
                    1000,
                ),
                process: Arc::new(StopFlagProcess(stopped.clone())),
                available_models: Vec::new(),
                subscribers: Vec::new(),
            });
        guard.starting_session_ids.retain(|id| id != session);
    }
    tokio::time::timeout(std::time::Duration::from_secs(5), archive)
        .await
        .expect("起動が終わったら、アーカイブも終わる")
        .unwrap()
        .unwrap();

    assert!(
        stopped.load(std::sync::atomic::Ordering::SeqCst),
        "起動が終わったものを止めた"
    );
    let marks: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.dir.path().join("archived-sessions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(marks["session_ids"], serde_json::json!([session]), "印あり");
    let ledger: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(f.dir.path().join("running-sessions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        ledger["sessions"],
        serde_json::json!([]),
        "再開の控えからも外れている"
    );
}
