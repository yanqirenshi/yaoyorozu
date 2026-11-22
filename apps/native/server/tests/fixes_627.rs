//! #627 の分: 設定の版・エラーの文面・壊れた会話ファイル・一時ファイルの掃除・規則の抜け。
//! 使い捨てのフォルダだけを使う(環境変数は触らない。セッションのルートは設定の上書きで指す)。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14994;
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
    };
    Fixture { dir, ctx }
}

async fn call(
    ctx: &AppContext,
    command: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    // update_settings に版の指定が無い呼び出しには、今の版を補う(版そのもののテストは明示する)。
    let mut body = body;
    if command == "update_settings" && body.get("expectedRevision").is_none() {
        body["expectedRevision"] = serde_json::json!(ctx.state.lock().await.settings.revision);
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

fn input(repo: Option<&str>, root: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "repository_path": repo, "github_project": null,
        "selected_project_folders": [], "claude_projects_dir": root
    })
}

async fn revision(ctx: &AppContext) -> u64 {
    call(ctx, "get_settings", serde_json::json!({})).await.1["revision"]
        .as_u64()
        .unwrap()
}

fn forward(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

// --- 1. 設定の版 ---

#[tokio::test]
async fn an_update_based_on_an_old_revision_is_refused_and_does_not_revert_other_changes() {
    let f = fixture();
    let r0 = revision(&f.ctx).await;

    // タブ A: 対象リポジトリを変えて保存する(版 r0 を元に)。
    let (status, saved) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(Some("C:/repo-a"), None), "expectedRevision": r0}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let r1 = saved["revision"].as_u64().unwrap();
    assert!(r1 > r0, "保存のたびに版が増える");
    assert_eq!(revision(&f.ctx).await, r1);

    // タブ A: ほかの欄(再開のチェック)も変える。タブ B は古い版 r0 のまま。
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": {
            "repository_path": "C:/repo-a", "github_project": null,
            "selected_project_folders": [], "claude_projects_dir": null,
            "restore_running_sessions": false
        }, "expectedRevision": r1}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let r2 = revision(&f.ctx).await;

    // タブ B(版 r0 のまま)が保存しようとする → 409。ディスクもメモリも、タブ A の変更のまま。
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(Some("C:/repo-b"), None), "expectedRevision": r0}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "settings_conflict");
    assert!(body["message"].as_str().unwrap().contains("取り直して"));
    let (_, s) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(s["repository_path"], "C:/repo-a");
    assert_eq!(
        s["restore_running_sessions"], false,
        "別の欄の変更が古い値へ戻っていない"
    );
    assert_eq!(
        s["revision"].as_u64().unwrap(),
        r2,
        "断った保存は版を進めない"
    );
    let on_disk: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(f.dir.path().join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(on_disk["restore_running_sessions"], false);
    assert_eq!(on_disk["revision"].as_u64().unwrap(), r2);

    // 取り直した版でなら保存できる。
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(Some("C:/repo-b"), None), "expectedRevision": r2}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn expected_revision_is_required_and_profile_operations_advance_the_revision() {
    let f = fixture();
    let (status, body) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(None, None), "expectedRevision": null}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "invalid_input");

    let r = revision(&f.ctx).await;
    let (_, created) = call(&f.ctx, "create_profile", serde_json::json!({"name": "x"})).await;
    let r_create = revision(&f.ctx).await;
    assert!(r_create > r);
    let id = created["id"].as_str().unwrap().to_string();
    call(
        &f.ctx,
        "rename_profile",
        serde_json::json!({"profileId": id, "name": "y"}),
    )
    .await;
    let r_rename = revision(&f.ctx).await;
    assert!(r_rename > r_create);
    call(
        &f.ctx,
        "switch_profile",
        serde_json::json!({"profileId": id}),
    )
    .await;
    assert!(revision(&f.ctx).await > r_rename);
    // プロファイルの操作は ID で対象を指すので、版の指定は要らない(古い版でも通る)。
    let (status, _) = call(
        &f.ctx,
        "delete_profile",
        serde_json::json!({"profileId": id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

// --- 2. エラーの文面にフルパスを出さない ---

#[tokio::test]
async fn error_messages_never_contain_the_servers_paths() {
    let f = fixture();
    let home = f.dir.path().join("secret-home-dir");
    let projects = home.join(".claude").join("projects");
    std::fs::create_dir_all(projects.join("proj1")).unwrap();
    let repo = home.join("repo");
    std::fs::create_dir_all(repo.join(".claude")).unwrap();
    // 読めない会話ファイルが壊れた形で 1 つ、フォルダの名前が会話ファイルの名前のもの。
    std::fs::create_dir_all(projects.join("proj1").join("dir-as-file.jsonl")).unwrap();
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(Some(&forward(&repo)), Some(&forward(&projects)))}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let needle_a = "secret-home-dir";
    let needle_b = forward(f.dir.path());
    let backslash = f.dir.path().to_string_lossy().to_string();
    let cases: Vec<(&str, serde_json::Value)> = vec![
        // 存在しない会話・存在しないプロジェクト・フォルダが会話ファイルの名前になっているもの
        (
            "get_session",
            serde_json::json!({"project": "proj1", "sessionId": "no-such", "offset": 0, "limit": 5}),
        ),
        (
            "get_session",
            serde_json::json!({"project": "no-such-project", "sessionId": "x", "offset": 0, "limit": 5}),
        ),
        (
            "get_session",
            serde_json::json!({"project": "proj1", "sessionId": "dir-as-file", "offset": 0, "limit": 5}),
        ),
        (
            "get_session_line_raw",
            serde_json::json!({"project": "proj1", "sessionId": "no-such", "uuid": "u"}),
        ),
        (
            "get_session_line_raw",
            serde_json::json!({"project": "...", "sessionId": "x", "uuid": "u"}),
        ),
        (
            "get_session_line_images",
            serde_json::json!({"project": "no-such-project", "sessionId": "x", "uuid": "u"}),
        ),
        (
            "get_session_line_images",
            serde_json::json!({"project": "proj1", "sessionId": "dir-as-file", "uuid": "u"}),
        ),
        (
            "list_sessions",
            serde_json::json!({"project": "no-such-project"}),
        ),
        // リポジトリ系(ファイルが無い・形が違う)
        ("get_rule", serde_json::json!({"fileName": "no-such.md"})),
        ("get_skill", serde_json::json!({"name": "no-such"})),
        ("list_rules", serde_json::json!({})),
        ("list_skills", serde_json::json!({})),
        (
            "get_project_settings_file",
            serde_json::json!({"which": "settings"}),
        ),
        (
            "save_project_claude_md",
            serde_json::json!({"content": "x", "expectedModifiedAtMs": 1}),
        ),
        (
            "save_project_settings_file",
            serde_json::json!({"which": "settings", "content": "{}", "expectedModifiedAtMs": 1}),
        ),
        ("get_yyz_scaffold_status", serde_json::json!({})),
    ];
    let mut seen_error = 0;
    for (command, body) in cases {
        let (status, resp) = call(&f.ctx, command, body.clone()).await;
        let text = resp.to_string();
        if !status.is_success() {
            seen_error += 1;
        }
        for needle in [needle_a, needle_b.as_str(), backslash.as_str()] {
            assert!(
                !text.contains(needle) && !text.replace("\\\\", "\\").contains(needle),
                "{command} {body}: エラーにサーバのパスが出ている: {text}"
            );
        }
        // ドライブ付きのパスも出ない。
        assert!(
            !regex_like_drive_path(&text),
            "{command}: ドライブ付きのパスが出ている: {text}"
        );
    }
    assert!(
        seen_error >= 8,
        "エラーになる呼び出しを十分に確かめた({seen_error} 件)"
    );

    // 文面は、プロジェクト名・ファイル名までは残る(原因が分かる)。
    let (_, resp) = call(
        &f.ctx,
        "get_session",
        serde_json::json!({"project": "proj1", "sessionId": "no-such", "offset": 0, "limit": 5}),
    )
    .await;
    assert!(
        resp["message"].as_str().unwrap().contains("no-such.jsonl"),
        "{resp}"
    );
}

/// `X:\` か `X:/` で始まる(直前が英数字でない)部分があるか。
fn regex_like_drive_path(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    (0..chars.len().saturating_sub(2)).any(|i| {
        chars[i].is_ascii_alphabetic()
            && chars[i + 1] == ':'
            && (chars[i + 2] == '\\' || chars[i + 2] == '/')
            && (i == 0 || !chars[i - 1].is_alphanumeric())
    })
}

// --- 3. 壊れた会話ファイルがあっても、一覧は残りを返す ---

#[tokio::test]
async fn a_broken_conversation_file_is_skipped_and_the_rest_is_listed_with_one_warning() {
    let f = fixture();
    let projects = f.dir.path().join("projects");
    let proj = projects.join("proj1");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(
        proj.join("good.jsonl"),
        r#"{"type":"user","sessionId":"good","cwd":"/w","message":{"content":"hello"}}"#,
    )
    .unwrap();
    std::fs::write(proj.join("broken.jsonl"), "壊れた内容\n{ 途中").unwrap();
    std::fs::write(proj.join("binary.jsonl"), [0xff, 0xfe, 0x00]).unwrap();
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(None, Some(&forward(&projects)))}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut events = f.ctx.events.subscribe();

    let (status, list) = call(
        &f.ctx,
        "list_sessions",
        serde_json::json!({"project": "proj1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let ids: Vec<&str> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["good"], "壊れたファイルを飛ばして、残りを返す");

    // 画面に分かる形(app:warning と、控え)。ファイル名だけで、パスは含まない。
    let ev = loop {
        let ev = events.recv().await.unwrap();
        if ev.name == "app:warning" {
            break ev;
        }
    };
    assert!(
        ev.data.contains("2 件")
            && ev.data.contains("broken.jsonl")
            && ev.data.contains("binary.jsonl"),
        "{}",
        ev.data
    );
    assert!(!ev.data.contains(&forward(f.dir.path())));
    let (_, pending) = call(&f.ctx, "list_pending_warnings", serde_json::json!({})).await;
    assert_eq!(pending.as_array().unwrap().len(), 1);
    assert_eq!(pending[0]["kind"], "app:warning");

    // 取り直しのたびに同じ警告を増やさない。
    let (status, _) = call(
        &f.ctx,
        "list_sessions",
        serde_json::json!({"project": "proj1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, pending) = call(&f.ctx, "list_pending_warnings", serde_json::json!({})).await;
    assert_eq!(pending.as_array().unwrap().len(), 1);
}

// --- 6. データフォルダの古い一時ファイルの掃除 ---

#[test]
fn startup_cleanup_removes_only_old_tmp_files_in_the_data_folder() {
    use std::time::{Duration, SystemTime};
    let dir = tempfile::tempdir().unwrap();
    let old = SystemTime::now() - Duration::from_secs(2 * 3600);
    let set_age = |p: &Path, t: SystemTime| {
        std::fs::OpenOptions::new()
            .write(true)
            .open(p)
            .unwrap()
            .set_modified(t)
            .unwrap();
    };
    let stale = dir
        .path()
        .join("settings.json.4242.1700000000000000000.7.tmp");
    let fresh = dir
        .path()
        .join("settings.json.4242.1700000000000000000.8.tmp");
    let settings = dir.path().join("settings.json");
    std::fs::write(&stale, "x").unwrap();
    std::fs::write(&fresh, "y").unwrap();
    std::fs::write(&settings, "{}").unwrap();
    set_age(&stale, old);
    set_age(&settings, old);
    // 子のフォルダの中は見ない(リポジトリや ~/.claude のような場所へ広げない)。
    let sub = dir.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    let nested = sub.join("a.json.1.2.3.tmp");
    std::fs::write(&nested, "z").unwrap();
    set_age(&nested, old);

    let removed = server::data_files::cleanup_stale_tmp(dir.path());
    assert_eq!(
        removed,
        vec!["settings.json.4242.1700000000000000000.7.tmp"]
    );
    assert!(fresh.exists() && settings.exists() && nested.exists());
}

// --- 7. パスと名前の規則の抜け ---

#[tokio::test]
async fn paths_and_names_that_slipped_through_before_are_refused_consistently() {
    let f = fixture();
    let zero_width = format!("C:\\repo{}x", '\u{200B}');
    let bidi = format!("C:\\repo{}x", '\u{202E}');
    let bad_paths: Vec<String> = vec![
        "C:\\a\\COM\u{b9}".into(),
        "C:\\a\\LPT\u{b2}.txt".into(),
        r"C:\a\CONIN$".into(),
        r"C:\a\CONOUT$".into(),
        r"C:\\?\x".into(),
        r"C:\a\?\x".into(),
        r"C:\a\.. \b".into(),
        r"C:\a\...\b".into(),
        zero_width,
        bidi,
    ];
    for bad in &bad_paths {
        let (s1, b1) = call(&f.ctx, "check_folder", serde_json::json!({"path": bad})).await;
        let (s2, b2) = call(
            &f.ctx,
            "update_settings",
            serde_json::json!({"input": input(Some(bad), None)}),
        )
        .await;
        assert_eq!(s1, StatusCode::BAD_REQUEST, "check_folder {bad:?}: {b1}");
        assert_eq!(s2, StatusCode::BAD_REQUEST, "update_settings {bad:?}: {b2}");
        assert_eq!(b1["message"], b2["message"], "判定が食い違わない: {bad:?}");
    }
    // 名前(ゼロ幅・向きを変える文字)。
    for bad in ["\u{200B}", "a\u{200D}b", "\u{202E}gpj.exe", "x\u{2066}"] {
        let (status, body) = call(&f.ctx, "create_profile", serde_json::json!({"name": bad})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad:?}: {body}");
    }
}

/// ネットワークのドライブ(`net use`)は、形が `X:\` でも断る。環境が許せば実際に割り当てて確かめる
/// (管理共有 `\\127.0.0.1\C$` を使う。割り当てられない環境では飛ばす)。
#[tokio::test]
async fn a_mapped_network_drive_is_refused_before_anything_touches_it() {
    let letter = ('D'..='Z')
        .rev()
        .find(|c| !Path::new(&format!("{c}:\\")).exists())
        .expect("未使用のドライブ文字がある");
    let drive = format!("{letter}:");
    let mapped = std::process::Command::new("net")
        .args(["use", &drive, r"\\127.0.0.1\C$"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !mapped {
        eprintln!("ネットワークのドライブを割り当てられないため飛ばす");
        return;
    }
    // 後始末(割り当てを外す)は、失敗しても続ける。
    struct Unmap(String);
    impl Drop for Unmap {
        fn drop(&mut self) {
            let _ = std::process::Command::new("net")
                .args(["use", &self.0, "/delete", "/y"])
                .output();
        }
    }
    let _guard = Unmap(drive.clone());

    let f = fixture();
    let path = format!("{drive}/Windows");
    let started = std::time::Instant::now();
    let (status, body) = call(&f.ctx, "check_folder", serde_json::json!({"path": path})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("ネットワークのドライブ"),
        "{body}"
    );
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(Some(&path), None)}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &f.ctx,
        "update_settings",
        serde_json::json!({"input": input(None, Some(&path))}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "存在の確認をしないので速い"
    );
    let _: PathBuf = PathBuf::new();
}
