//! CLAUDE.md・設定ファイルの保存(楽観ロックの競合・一時ファイル)。使い捨てのホームとリポジトリだけを使う。
//!
//! `USERPROFILE` はプロセス全体の環境変数なので、このファイルのテストは 1 本にまとめる。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::EventBus;
use server::{router, AppContext, ServerState};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14995;
const TOKEN: &str = "t";

fn ctx(dir: &Path, repo: &Path) -> AppContext {
    let mut settings = domain::Settings::default();
    settings.profiles[0].repository_path = Some(repo.to_path_buf());
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

/// 保存の 4 つの口。`(名前, 読む command, 読む引数, 保存する command, 保存の引数の基本形, 実ファイル, 中身の作り方)`。
struct Door {
    name: &'static str,
    get: &'static str,
    get_args: serde_json::Value,
    save: &'static str,
    save_args: serde_json::Value,
    file: std::path::PathBuf,
    json: bool,
}

fn content_for(door: &Door, tag: &str) -> String {
    if door.json {
        format!("{{\"writer\":\"{tag}\",\"pad\":\"{}\"}}", "x".repeat(3000))
    } else {
        format!("# {tag}\n{}\n", "y".repeat(3000))
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_saves_with_the_same_expected_time_let_exactly_one_through_and_tmp_links_are_harmless(
) {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    let repo = tmp.path().join("repo");
    let data = tmp.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    write(&home.join(".claude").join("CLAUDE.md"), "# user");
    write(&home.join(".claude").join("settings.json"), "{}");
    write(&repo.join("CLAUDE.md"), "# repo");
    write(&repo.join(".claude").join("settings.json"), "{}");
    // 使い捨てのホームを指す(本物の ~/.claude には触れない)。
    std::env::set_var("USERPROFILE", &home);
    std::env::set_var("HOME", &home);
    let ctx = ctx(&data, &repo);

    let doors = vec![
        Door {
            name: "~/.claude/CLAUDE.md",
            get: "get_user_claude_md",
            get_args: serde_json::json!({}),
            save: "save_user_claude_md",
            save_args: serde_json::json!({}),
            file: home.join(".claude").join("CLAUDE.md"),
            json: false,
        },
        Door {
            name: "~/.claude/settings.json",
            get: "get_claude_settings_file",
            get_args: serde_json::json!({}),
            save: "save_claude_settings_file",
            save_args: serde_json::json!({}),
            file: home.join(".claude").join("settings.json"),
            json: true,
        },
        Door {
            name: "repo/CLAUDE.md",
            get: "get_project_claude_md",
            get_args: serde_json::json!({}),
            save: "save_project_claude_md",
            save_args: serde_json::json!({}),
            file: repo.join("CLAUDE.md"),
            json: false,
        },
        Door {
            name: "repo/.claude/settings.json",
            get: "get_project_settings_file",
            get_args: serde_json::json!({"which": "settings"}),
            save: "save_project_settings_file",
            save_args: serde_json::json!({"which": "settings"}),
            file: repo.join(".claude").join("settings.json"),
            json: true,
        },
    ];

    for door in &doors {
        // --- 同じ modified_at_ms で 10 本同時 × 10 回: 通るのは 1 本だけ、残りは 409(500 にしない) ---
        for round in 0..10 {
            let (status, current) = call(&ctx, door.get, door.get_args.clone()).await;
            assert_eq!(status, StatusCode::OK, "{} get", door.name);
            let expected = current["modified_at_ms"].clone();
            let mut tasks = Vec::new();
            for i in 0..10 {
                let ctx = ctx.clone();
                let mut args = door.save_args.clone();
                let tag = format!("{round}-{i}");
                let content = content_for(door, &tag);
                args["content"] = serde_json::json!(content);
                args["expectedModifiedAtMs"] = expected.clone();
                let save = door.save;
                tasks.push(tokio::spawn(async move {
                    let (status, body) = call(&ctx, save, args).await;
                    (status, body, content)
                }));
            }
            let mut winners = Vec::new();
            for t in tasks {
                let (status, body, content) = t.await.unwrap();
                match status {
                    StatusCode::OK => winners.push(content),
                    StatusCode::CONFLICT => {}
                    other => panic!(
                        "{} round {round}: 200 でも 409 でもない: {other} {body}",
                        door.name
                    ),
                }
            }
            assert_eq!(
                winners.len(),
                1,
                "{} round {round}: 通るのは 1 本だけ",
                door.name
            );
            // ディスクの内容は、200 だった 1 本と一致する(混ざらない)。
            assert_eq!(
                std::fs::read_to_string(&door.file).unwrap(),
                winners[0],
                "{} round {round}: ディスク = 通った 1 本",
                door.name
            );
        }
        // 一時ファイルの残骸が無い。
        let parent = door.file.parent().unwrap();
        let stem = door.file.file_name().unwrap().to_string_lossy().to_string();
        let leftovers: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(&stem) && n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{} 残骸: {leftovers:?}", door.name);
    }

    // --- 固定名の `<名前>.tmp` がハードリンクで残っていても、保存でリンク先は変わらない(4 つの口) ---
    for door in &doors {
        let victim = tmp
            .path()
            .join(format!("victim-{}.txt", door.name.replace(['/', '~'], "_")));
        std::fs::write(&victim, "precious").unwrap();
        let fixed_tmp = door.file.with_file_name(format!(
            "{}.tmp",
            door.file.file_name().unwrap().to_string_lossy()
        ));
        std::fs::hard_link(&victim, &fixed_tmp).unwrap();

        let (_, current) = call(&ctx, door.get, door.get_args.clone()).await;
        let mut args = door.save_args.clone();
        args["content"] = serde_json::json!(content_for(door, "linked"));
        args["expectedModifiedAtMs"] = current["modified_at_ms"].clone();
        let (status, body) = call(&ctx, door.save, args).await;
        assert_eq!(status, StatusCode::OK, "{}: {body}", door.name);
        assert_eq!(
            std::fs::read_to_string(&victim).unwrap(),
            "precious",
            "{}: ハードリンクのリンク先が書き換わっていない",
            door.name
        );
        assert_eq!(
            std::fs::read_to_string(&door.file).unwrap(),
            content_for(door, "linked")
        );
    }

    // --- 設定ファイル(JSON)の最上位がオブジェクトでなければ 400(配列・数値・文字列・null・真偽値) ---
    for door in doors.iter().filter(|d| d.json) {
        for bad in [
            "[1,2]",
            "[]",
            "123",
            "\"text\"",
            "null",
            "true",
            "  [ {} ]  ",
        ] {
            let before = std::fs::read_to_string(&door.file).unwrap();
            let (_, current) = call(&ctx, door.get, door.get_args.clone()).await;
            let mut args = door.save_args.clone();
            args["content"] = serde_json::json!(bad);
            args["expectedModifiedAtMs"] = current["modified_at_ms"].clone();
            let (status, body) = call(&ctx, door.save, args).await;
            assert_eq!(
                status,
                StatusCode::BAD_REQUEST,
                "{} {bad:?}: {body}",
                door.name
            );
            assert_eq!(body["code"], "invalid_input");
            assert_eq!(
                std::fs::read_to_string(&door.file).unwrap(),
                before,
                "{} {bad:?}: ファイルは変わらない",
                door.name
            );
        }
        // オブジェクトは通る(空のオブジェクトも)。
        let (_, current) = call(&ctx, door.get, door.get_args.clone()).await;
        let mut args = door.save_args.clone();
        args["content"] = serde_json::json!("{}");
        args["expectedModifiedAtMs"] = current["modified_at_ms"].clone();
        let (status, body) = call(&ctx, door.save, args).await;
        assert_eq!(status, StatusCode::OK, "{}: {body}", door.name);
    }
}
