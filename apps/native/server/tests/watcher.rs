//! 会話ファイルの監視(`session:changed`)。使い捨てのフォルダだけを見る。

use server::events::EventBus;
use server::watcher::start_session_watcher;
use server::{AppContext, ServerState};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Mutex};

fn ctx(dir: &std::path::Path) -> AppContext {
    let (_tx, rx) = watch::channel(false);
    AppContext {
        state: Arc::new(Mutex::new(ServerState::new(
            domain::Settings::default(),
            dir.join("settings.json"),
            false,
        ))),
        events: EventBus::new(),
        token: Arc::new("t".to_string()),
        port: 1,
        version: Arc::new("0".to_string()),
        data_dir: Arc::new(dir.to_path_buf()),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        file_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
        running: Default::default(),
    }
}

#[tokio::test]
async fn a_new_or_changed_conversation_file_emits_session_changed() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = tmp.path().join("projects");
    std::fs::create_dir_all(projects.join("proj1")).unwrap();
    let ctx = ctx(tmp.path());
    let mut rx = ctx.events.subscribe();
    start_session_watcher(&ctx, projects.clone());

    // 新しい会話ファイル。
    std::fs::write(projects.join("proj1").join("s1.jsonl"), "{}\n").unwrap();
    let event = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = rx.recv().await.unwrap();
            if ev.name == "session:changed" {
                return ev;
            }
        }
    })
    .await
    .expect("session:changed が届くこと");
    let payload: serde_json::Value = serde_json::from_str(&event.data).unwrap();
    assert_eq!(payload["project"], "proj1");
    assert_eq!(payload["agent"], "claude-code");

    // 追記(変更)でも届く。
    std::fs::write(projects.join("proj1").join("s1.jsonl"), "{}\n{}\n").unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if rx.recv().await.unwrap().name == "session:changed" {
                return;
            }
        }
    })
    .await
    .expect("変更でも session:changed が届くこと");
}

#[tokio::test]
async fn restarting_the_watcher_replaces_the_previous_one() {
    let tmp = tempfile::tempdir().unwrap();
    let (a, b) = (tmp.path().join("a"), tmp.path().join("b"));
    std::fs::create_dir_all(a.join("p")).unwrap();
    std::fs::create_dir_all(b.join("p")).unwrap();
    let ctx = ctx(tmp.path());
    let mut rx = ctx.events.subscribe();
    start_session_watcher(&ctx, a.clone());
    start_session_watcher(&ctx, b.clone());

    // 張り替え前の場所の変更は届かない。
    std::fs::write(a.join("p").join("x.jsonl"), "{}\n").unwrap();
    let early = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(early.is_err(), "古い監視は止まっているはず");

    std::fs::write(b.join("p").join("y.jsonl"), "{}\n").unwrap();
    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("新しい監視は届く")
        .unwrap();
}
