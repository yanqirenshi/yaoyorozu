//! `~/.claude`・ビューア系の command。使い捨てのホーム(`USERPROFILE`)とリポジトリで確かめる。
//!
//! `USERPROFILE` はプロセス全体の環境変数なので、このファイルのテストは 1 本にまとめて順に実行する
//! (並列に走ると互いのホームを上書きするため)。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14997;
const TOKEN: &str = "t";

fn ctx_with_repo(dir: &Path, repo: Option<&Path>) -> AppContext {
    let mut settings = domain::Settings::default();
    if let Some(repo) = repo {
        settings.profiles[0].repository_path = Some(repo.to_path_buf());
    }
    let (_tx, rx) = watch::channel(false);
    AppContext {
        state: Arc::new(Mutex::new(ServerState::new(
            settings,
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

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

#[tokio::test]
async fn claude_home_and_viewer_commands_with_disposable_directories() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    let repo = tmp.path().join("repo");
    let data = tmp.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    write(&home.join(".claude").join("CLAUDE.md"), "# user memory");
    write(&home.join(".claude").join("settings.json"), "{}");
    write(
        &home.join(".claude").join(".credentials.json"),
        "{\"secret\":1}",
    );
    write(&repo.join("CLAUDE.md"), "# repo memory");
    write(&repo.join(".claude").join("rules").join("a.md"), "rule a");
    write(
        &repo
            .join(".claude")
            .join("skills")
            .join("s1")
            .join("SKILL.md"),
        "skill s1",
    );
    write(
        &home
            .join(".claude")
            .join("projects")
            .join("proj1")
            .join("sess1.jsonl"),
        concat!(
            r#"{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"sess1","cwd":"/work","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"hello"}}"#,
            "\n",
            r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"sess1","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
            "\n"
        ),
    );
    // 使い捨てのホームを指す(本物の ~/.claude には触れない)。
    std::env::set_var("USERPROFILE", &home);
    std::env::set_var("HOME", &home);

    let ctx = ctx_with_repo(&data, Some(&repo));

    // --- ~/.claude の CLAUDE.md の読み・保存(楽観ロック) ---
    let (status, md) = call(&ctx, "get_user_claude_md", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(md["content"], "# user memory");
    let modified = md["modified_at_ms"].as_u64().unwrap();
    let (status, _) = call(
        &ctx,
        "save_user_claude_md",
        serde_json::json!({"content": "# changed", "expectedModifiedAtMs": modified}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read_to_string(home.join(".claude").join("CLAUDE.md")).unwrap(),
        "# changed"
    );
    // 古い更新時刻での保存は競合(409)になり、中身は変わらない。
    let (status, body) = call(
        &ctx,
        "save_user_claude_md",
        serde_json::json!({"content": "# stale", "expectedModifiedAtMs": 1}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "claude_md_conflict");
    assert_eq!(
        std::fs::read_to_string(home.join(".claude").join("CLAUDE.md")).unwrap(),
        "# changed"
    );

    // --- settings.json の読み書き ---
    let (status, st) = call(&ctx, "get_claude_settings_file", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(st["content"], "{}");

    // --- Explorer: ~/.claude の中だけ。.. ・絶対パス・資格情報は拒否 ---
    let (status, page) = call(
        &ctx,
        "list_claude_dir",
        serde_json::json!({"path": "", "offset": 0, "limit": 50}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    for bad in [
        "..",
        "../x",
        "projects/../..",
        "C:/Windows",
        "/etc",
        "a\\..\\..\\b",
    ] {
        let (status, body) = call(
            &ctx,
            "list_claude_dir",
            serde_json::json!({"path": bad, "offset": 0, "limit": 50}),
        )
        .await;
        assert!(
            status.is_client_error(),
            "{bad:?} は拒否されるべき: {status} {body}"
        );
    }

    // --- ビューア: セッション一覧・会話(使い捨てのホームの projects) ---
    let (status, projects) = call(&ctx, "list_projects", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(projects[0]["name"], "proj1");
    let (status, sessions) = call(
        &ctx,
        "list_sessions",
        serde_json::json!({"project": "proj1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sessions}");
    assert_eq!(sessions.as_array().unwrap().len(), 1);
    // project・sessionId に ..・区切りを入れた形は拒否される。
    for (project, session) in [
        ("..", "sess1"),
        ("proj1", "../sess1"),
        ("proj1/..", "sess1"),
    ] {
        let (status, body) = call(
            &ctx,
            "get_session",
            serde_json::json!({"project": project, "sessionId": session, "offset": 0, "limit": 10}),
        )
        .await;
        assert!(
            status.is_client_error(),
            "{project:?}/{session:?} は拒否されるべき: {status} {body}"
        );
        let (status, _) = call(
            &ctx,
            "get_session_line_raw",
            serde_json::json!({"project": project, "sessionId": session, "uuid": "u"}),
        )
        .await;
        assert!(status.is_client_error(), "{project:?}/{session:?}");
    }

    // ファイルに触る前(入口)で 400 になる(`..` のプロジェクトで、ルートの外のファイルを探さない)。
    for project in ["..", "proj1/..", "a\\b", "C:"] {
        let (status, body) = call(
            &ctx,
            "list_sessions",
            serde_json::json!({"project": project}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{project:?} {body}");
        let (status, body) = call(
            &ctx,
            "get_session",
            serde_json::json!({"project": project, "sessionId": "sess1", "offset": 0, "limit": 5}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{project:?} {body}");
    }

    // --- リポジトリ系(profileId から repository_path を引く) ---
    let (status, md) = call(&ctx, "get_project_claude_md", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(md["content"], "# repo memory");
    let (status, _) = call(
        &ctx,
        "save_project_claude_md",
        serde_json::json!({"content": "# repo changed", "expectedModifiedAtMs": md["modified_at_ms"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read_to_string(repo.join("CLAUDE.md")).unwrap(),
        "# repo changed"
    );
    let (_, rules) = call(&ctx, "list_rules", serde_json::json!({})).await;
    assert_eq!(rules[0]["file_name"], "a.md");
    // ルール名にパスを入れた形は拒否(リポジトリの外を読めない)。
    for bad in [
        "../../CLAUDE.md",
        "..\\x",
        "a/b.md",
        "C:/Windows/win.ini",
        "C:x.md",
    ] {
        let (status, body) = call(&ctx, "get_rule", serde_json::json!({"fileName": bad})).await;
        assert!(
            status.is_client_error(),
            "{bad:?} は拒否されるべき: {status} {body}"
        );
    }
    let (_, skills) = call(&ctx, "list_skills", serde_json::json!({})).await;
    assert_eq!(skills[0]["name"], "s1");
    for bad in ["../s1", "s1/../..", "..", "C:/x", "C:x"] {
        let (status, body) = call(&ctx, "get_skill", serde_json::json!({"name": bad})).await;
        assert!(
            status.is_client_error(),
            "{bad:?} は拒否されるべき: {status} {body}"
        );
    }
    // プロファイルの設定ファイル(which は列挙値だけ)。
    let (status, _) = call(
        &ctx,
        "get_project_settings_file",
        serde_json::json!({"which": "settings"}),
    )
    .await;
    assert!(status == StatusCode::OK || status.is_client_error());
    let (status, _) = call(
        &ctx,
        "get_project_settings_file",
        serde_json::json!({"which": "../../etc/passwd"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // --- 未登録のプロファイル・repository_path 未設定は拒否 ---
    let (status, body) = call(
        &ctx,
        "get_project_claude_md",
        serde_json::json!({"profileId": "nope"}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let ctx_without_repo = ctx_with_repo(&data, None);
    let (status, body) = call(
        &ctx_without_repo,
        "get_project_claude_md",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "invalid_input");

    // 資格情報ファイルは、どの経路でも読めない。
    let _ = PathBuf::from(".");
}
