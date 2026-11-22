//! 再開(`start_running_session` の `resume`)の入口の確認: 会話 ID の大文字小文字、再開する会話の作業フォルダ。
//! 使い捨てのフォルダだけを使う。claude は起動しない(断られる経路だけを確かめる)。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::state::RunningSessionSlot;
use server::{router, AppContext, ServerState};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14993;
const TOKEN: &str = "t";
const SESSION: &str = "0a1b2c3d-1111-4222-8333-444455556666";

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

/// `profileId` が必須の command(省略・null は 400。タブごとに別のプロファイルを開くので、「アクティブ」に頼らない)。
/// これらの呼び出しの便宜のため、指定の無い呼び出しには、いまのアクティブを補う(省略が 400 になることは `tests/hub.rs` で確かめる)。
const PROFILE_REQUIRED: &[&str] = &[
    "start_running_session",
    "get_project_claude_md",
    "save_project_claude_md",
    "list_rules",
    "get_rule",
    "list_skills",
    "get_skill",
    "get_project_settings_file",
    "save_project_settings_file",
    "get_yyz_scaffold_status",
    "create_yyz_scaffold",
];

async fn call(
    ctx: &AppContext,
    command: &str,
    mut body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    if PROFILE_REQUIRED.contains(&command) && body.get("profileId").is_none() {
        body["profileId"] = serde_json::json!(ctx.state.lock().await.settings.active_profile_id);
    }
    // 保存先のプロファイルが無い呼び出しには、いまのアクティブを補う(省略のテストは `"profileId": null` で明示する)。
    if command == "update_settings" && body.get("profileId").is_none() {
        body["profileId"] = serde_json::json!(ctx.state.lock().await.settings.active_profile_id);
    }
    // 版の指定が無い呼び出しには、保存先のプロファイルの版と、全体の欄の版を補う(版そのもののテストは明示する)。
    if command == "update_settings" {
        let guard = ctx.state.lock().await;
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

/// リポジトリ・会話のルートを登録し、会話 1 つ(記録された cwd = `cwd`)を作る。
async fn set_up(f: &Fixture, cwd: &str) {
    let repo = f.dir.path().join("repo");
    let projects = f.dir.path().join("projects");
    std::fs::create_dir_all(repo.join("sub")).unwrap();
    std::fs::create_dir_all(projects.join("proj1")).unwrap();
    let line = serde_json::json!({
        "type": "user", "sessionId": SESSION, "cwd": cwd,
        "message": {"role": "user", "content": "hello"}
    });
    std::fs::write(
        projects.join("proj1").join(format!("{SESSION}.jsonl")),
        format!("{line}\n"),
    )
    .unwrap();
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": forward(&repo), "github_project": null,
            "selected_project_folders": [], "claude_projects_dir": forward(&projects)
        }}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

fn resume(session_id: &str) -> serde_json::Value {
    serde_json::json!({"request": {
        "kind": "resume", "project": "proj1", "session_id": session_id,
        "mode": "default", "name": null, "sync_origin_main": false
    }})
}

#[tokio::test]
async fn the_same_conversation_is_not_started_twice_whatever_the_case_of_its_id() {
    let f = fixture();
    let repo = forward(&f.dir.path().join("repo"));
    set_up(&f, &repo).await;
    // 小文字の ID で動いているセッション。
    let base = domain::RunningSession::new(SESSION, "windows:test", 4242, 1000);
    f.ctx
        .state
        .lock()
        .await
        .running_sessions
        .push(RunningSessionSlot {
            progress_seq: 0,
            project: None,
            session: domain::RunningSessionByApp::new(
                base,
                repo.clone().into(),
                "main-worktree",
                1000,
            ),
            process: Arc::new(StubProcess),
            available_models: Vec::new(),
            subscribers: Vec::new(),
            turn_events: Default::default(),
        });

    for id in [SESSION.to_string(), SESSION.to_uppercase(), {
        let mut mixed = SESSION.to_string();
        mixed.replace_range(0..2, "0A");
        mixed
    }] {
        let (status, body) = call(&f.ctx, "start_running_session", resume(&id)).await;
        assert_eq!(status, StatusCode::CONFLICT, "{id}: {body}");
        assert_eq!(body["code"], "session_busy", "{id}");
    }
}

#[tokio::test]
async fn a_conversation_whose_working_folder_is_outside_the_repository_is_refused() {
    let f = fixture();
    let outside = f.dir.path().join("elsewhere");
    std::fs::create_dir_all(&outside).unwrap();
    for cwd in [
        forward(&outside),
        "C:/Windows".to_string(),
        r"\\host\share\repo".to_string(),
        r"\\?\C:\Windows".to_string(),
    ] {
        set_up(&f, &cwd).await;
        let (status, body) = call(&f.ctx, "start_running_session", resume(SESSION)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{cwd}: {body}");
        assert_eq!(body["code"], "cwd_missing", "{cwd}");
        let message = body["message"].as_str().unwrap();
        assert!(
            !message.contains("elsewhere")
                && !message.contains("Windows")
                && !message.contains("host"),
            "文面にパスを入れない: {message}"
        );
        assert!(
            f.ctx.state.lock().await.starting_session_ids.is_empty(),
            "失敗したら起動中の印を残さない"
        );
    }
}

#[tokio::test]
async fn a_folder_that_leaves_the_repository_through_a_link_is_outside() {
    // リポジトリの下に作ったリンク(ジャンクション)が、外のフォルダを指している。
    let f = fixture();
    let outside = f.dir.path().join("elsewhere");
    std::fs::create_dir_all(&outside).unwrap();
    let repo = f.dir.path().join("repo");
    let link = repo.join("sub").join("link");
    std::fs::create_dir_all(repo.join("sub")).unwrap();
    let made = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&outside)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !made {
        eprintln!("ジャンクションを作れないため飛ばす");
        return;
    }
    set_up(&f, &forward(&link)).await;
    let (status, body) = call(&f.ctx, "start_running_session", resume(SESSION)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
}
