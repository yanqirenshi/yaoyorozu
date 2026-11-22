//! ハブの command(段階 4 A)の確認: `profileId` の必須化・レイアウトとチューニングの版・`reconcile_git_state` の二重実行の防止・
//! `get_pc`(走査キューが埋めた常駐のツリー)・差分再走査。使い捨てのデータフォルダと会話フォルダで確かめる(claude は起動しない)。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::events::{EventBus, ServerEvent};
use server::{router, AppContext, ServerState};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch, Mutex};
use tower::ServiceExt;

const PORT: u16 = 14996;
const TOKEN: &str = "t";

struct Fixture {
    ctx: AppContext,
    dir: tempfile::TempDir,
    projects: PathBuf,
    _tx: watch::Sender<bool>,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let projects = dir.path().join("projects");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::create_dir_all(projects.join("proj1")).unwrap();
    let settings = domain::Settings {
        claude_projects_dir: Some(projects.clone()),
        ..Default::default()
    };
    let (tx, rx) = watch::channel(false);
    let mut state = ServerState::new(settings, data.join("settings.json"), false);
    state.pc = app::current_pc(&infra::WindowsExecutionEnvironmentSource::new()).unwrap();
    state.git_ledger_path = data.join("git-ledger.json");
    let ctx = AppContext {
        state: Arc::new(Mutex::new(state)),
        events: EventBus::new(),
        token: Arc::new(TOKEN.to_string()),
        port: PORT,
        version: Arc::new("0".to_string()),
        data_dir: Arc::new(data),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        save_lane: Arc::new(tokio::sync::Mutex::new(())),
        file_lane: Arc::new(tokio::sync::Mutex::new(())),
        shutdown: rx,
        running: Default::default(),
    };
    Fixture {
        ctx,
        dir,
        projects,
        _tx: tx,
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

fn session_line(session_id: &str, kind: &str, n: u32) -> String {
    let (role, content) = if kind == "user" {
        ("user", serde_json::json!("質問です"))
    } else {
        (
            "assistant",
            serde_json::json!([{"type": "text", "text": "返事です"}]),
        )
    };
    serde_json::json!({
        "type": kind, "uuid": format!("{kind}-{n}"), "sessionId": session_id, "cwd": "C:/repo",
        "timestamp": format!("2026-11-22T00:00:{n:02}.000Z"),
        "message": {"role": role, "content": content}
    })
    .to_string()
        + "\n"
}

fn write_session(projects: &Path, id: &str) -> PathBuf {
    let path = projects.join("proj1").join(format!("{id}.jsonl"));
    std::fs::write(
        &path,
        session_line(id, "user", 1) + &session_line(id, "assistant", 2),
    )
    .unwrap();
    path
}

fn id(n: u32) -> String {
    format!("3a392392-0000-4000-8000-{n:012}")
}

async fn next_event(
    rx: &mut broadcast::Receiver<ServerEvent>,
    name: &str,
    within: Duration,
) -> Option<ServerEvent> {
    tokio::time::timeout(within, async {
        loop {
            match rx.recv().await {
                Ok(ev) if ev.name == name => return Some(ev),
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return None,
            }
        }
    })
    .await
    .unwrap_or(None)
}

#[tokio::test]
async fn profile_id_is_required_on_the_eleven_commands_and_get_settings_keeps_the_default() {
    let f = fixture();
    let commands = [
        (
            "start_running_session",
            serde_json::json!({"request": {"kind": "new", "mode": "default", "name": null, "sync_origin_main": false}}),
        ),
        ("get_project_claude_md", serde_json::json!({})),
        (
            "save_project_claude_md",
            serde_json::json!({"content": "x", "expectedModifiedAtMs": null}),
        ),
        ("list_rules", serde_json::json!({})),
        ("get_rule", serde_json::json!({"fileName": "a.md"})),
        ("list_skills", serde_json::json!({})),
        ("get_skill", serde_json::json!({"name": "s"})),
        (
            "get_project_settings_file",
            serde_json::json!({"which": "settings"}),
        ),
        (
            "save_project_settings_file",
            serde_json::json!({"which": "settings", "content": "{}", "expectedModifiedAtMs": null}),
        ),
        ("get_yyz_scaffold_status", serde_json::json!({})),
        ("create_yyz_scaffold", serde_json::json!({})),
    ];
    for (command, body) in commands {
        // 省略。
        let (status, resp) = call(&f.ctx, command, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{command} 省略: {resp}");
        assert_eq!(resp["code"], "invalid_input", "{command}");
        // null。
        let mut with_null = body.clone();
        with_null["profileId"] = serde_json::Value::Null;
        let (status, resp) = call(&f.ctx, command, with_null).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{command} null: {resp}");
        // 無いプロファイル(ID を付ければ、そこへ進む。400 の「省略」ではない)。
        let mut unknown = body.clone();
        unknown["profileId"] = serde_json::json!("no-such-profile");
        let (status, resp) = call(&f.ctx, command, unknown).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{command} 無い ID: {resp}");
    }
    // `get_settings` だけは、省略を残す(プロファイルの一覧と、アクティブを返すため)。
    let (status, resp) = call(&f.ctx, "get_settings", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK, "{resp}");
    assert!(resp["active_profile_id"].is_string());
}

#[tokio::test]
async fn the_layout_save_needs_the_revision_and_a_stale_one_is_409() {
    let f = fixture();
    let mut events = f.ctx.events.subscribe();
    let (status, layout) = call(&f.ctx, "get_hub_layout", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK, "{layout}");
    let r0 = layout["revision"].as_u64().expect("版を返す");
    assert!(layout["positions"].is_object() && layout["moves"].is_object());

    let body = |expected: serde_json::Value, x: f64| {
        let mut b = serde_json::json!({
            "positions": {"node-a": {"x": x, "y": 2.0}}, "camera": {"x": 0.0, "y": 0.0, "k": 1.0}, "moves": {}
        });
        if !expected.is_null() {
            b["expectedRevision"] = expected;
        }
        b
    };
    // 版の省略は 400。
    let (status, resp) = call(
        &f.ctx,
        "save_hub_layout",
        body(serde_json::Value::Null, 1.0),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{resp}");
    // 合う版なら保存でき、新しい版が返り、通知が出る。
    let (status, saved) = call(&f.ctx, "save_hub_layout", body(serde_json::json!(r0), 1.0)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let r1 = saved["revision"].as_u64().unwrap();
    assert_ne!(r0, r1);
    let ev = next_event(&mut events, "hub-layout:updated", Duration::from_secs(2))
        .await
        .expect("保存の通知");
    assert!(ev.data.contains(&r1.to_string()));
    // 古い版は 409(ファイルは変わらない)。
    let (status, stale) = call(&f.ctx, "save_hub_layout", body(serde_json::json!(r0), 9.0)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{stale}");
    assert_eq!(stale["code"], "hub_conflict");
    let (_, now) = call(&f.ctx, "get_hub_layout", serde_json::json!({})).await;
    assert_eq!(now["revision"].as_u64().unwrap(), r1);
    assert_eq!(now["positions"]["node-a"]["x"], 1.0);
}

#[tokio::test]
async fn concurrent_layout_saves_with_the_same_revision_let_exactly_one_through_and_the_file_stays_valid(
) {
    let f = fixture();
    let (_, layout) = call(&f.ctx, "get_hub_layout", serde_json::json!({})).await;
    let r0 = layout["revision"].clone();
    let mut tasks = Vec::new();
    for i in 0..10 {
        let ctx = f.ctx.clone();
        let r0 = r0.clone();
        tasks.push(tokio::spawn(async move {
            call(
                &ctx,
                "save_hub_layout",
                serde_json::json!({
                    "positions": {format!("n{i}"): {"x": i as f64, "y": 0.0}},
                    "camera": null, "moves": {}, "expectedRevision": r0
                }),
            )
            .await
        }));
    }
    let mut ok = 0;
    let mut conflict = 0;
    for task in tasks {
        match task.await.unwrap().0 {
            StatusCode::OK => ok += 1,
            StatusCode::CONFLICT => conflict += 1,
            other => panic!("想定外: {other}"),
        }
    }
    assert_eq!((ok, conflict), (1, 9));
    // ファイルは壊れていない(読めて、保存した 1 件だけが入っている)。
    let text = std::fs::read_to_string(f.ctx.data_dir.join("hub-layout.json")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["positions"].as_object().unwrap().len(), 1);
    let leftovers: Vec<_> = std::fs::read_dir(f.ctx.data_dir.as_ref())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "一時ファイルが残っている: {leftovers:?}"
    );
}

#[tokio::test]
async fn the_tuning_save_has_the_same_revision_rules() {
    let f = fixture();
    let mut events = f.ctx.events.subscribe();
    let (status, tuning) = call(&f.ctx, "get_hub_tuning", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK, "{tuning}");
    let r0 = tuning["revision"].as_u64().unwrap();
    let body = |expected: Option<u64>| {
        let mut b = serde_json::json!({"tuning": {
            "link_distance": 120.0, "link_strength": null, "charge_strength": -300.0, "collide_radius": 20.0
        }});
        if let Some(expected) = expected {
            b["expectedRevision"] = serde_json::json!(expected);
        }
        b
    };
    let (status, _) = call(&f.ctx, "save_hub_tuning", body(None)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "版の省略");
    let (status, saved) = call(&f.ctx, "save_hub_tuning", body(Some(r0))).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert!(
        next_event(&mut events, "hub-tuning:updated", Duration::from_secs(2))
            .await
            .is_some()
    );
    let (status, stale) = call(&f.ctx, "save_hub_tuning", body(Some(r0))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{stale}");
    assert_eq!(stale["code"], "hub_conflict");
    let (_, now) = call(&f.ctx, "get_hub_tuning", serde_json::json!({})).await;
    assert_eq!(now["link_distance"], 120.0);
    assert_eq!(now["revision"], saved["revision"]);
}

#[tokio::test]
async fn reconcile_answers_at_once_does_not_run_twice_and_the_scan_fills_get_pc() {
    let f = fixture();
    for n in 1..=5 {
        write_session(&f.projects, &id(n));
    }
    let mut events = f.ctx.events.subscribe();

    // すぐ応える(走査の終わりを待たない)。
    let t0 = std::time::Instant::now();
    let (status, resp) = call(&f.ctx, "reconcile_git_state", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK, "{resp}");
    assert!(t0.elapsed() < Duration::from_secs(2));
    // 走っている最中の 2 回目は、新しく始めずに応える(`reload_running` が立っているあいだ)。
    {
        let guard = f.ctx.state.lock().await;
        if guard.reload_running {
            drop(guard);
            assert!(
                !server::scan::begin_reload(&f.ctx).await,
                "二重に走らせない"
            );
        }
    }
    assert!(
        next_event(&mut events, "pc:data_loading", Duration::from_secs(2))
            .await
            .is_some()
    );
    assert!(
        next_event(&mut events, "pc:data_loaded", Duration::from_secs(30))
            .await
            .is_some()
    );
    // 終われば、また始められる。
    for _ in 0..100 {
        if !f.ctx.state.lock().await.reload_running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        server::scan::begin_reload(&f.ctx).await,
        "終わったあとは始められる"
    );
    assert!(
        next_event(&mut events, "pc:data_loaded", Duration::from_secs(30))
            .await
            .is_some()
    );

    let (status, pc) = call(&f.ctx, "get_pc", serde_json::json!({})).await;
    assert_eq!(status, StatusCode::OK, "{pc}");
    assert_eq!(pc["data_loaded"], true);
    let sessions = pc["users"][0]["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 5, "走査した会話がツリーに入っている");
    assert!(sessions.iter().all(|s| s["archived"] == false));
}

#[tokio::test]
async fn the_file_watcher_path_rescans_only_the_changed_files_and_announces_it() {
    let f = fixture();
    write_session(&f.projects, &id(1));
    let mut events = f.ctx.events.subscribe();
    assert!(server::scan::begin_reload(&f.ctx).await);
    next_event(&mut events, "pc:data_loaded", Duration::from_secs(30))
        .await
        .expect("読み込み完了");

    let new_file = write_session(&f.projects, &id(2));
    server::scan::enqueue_changed(
        f.ctx.clone(),
        &tokio::runtime::Handle::current(),
        vec![new_file.clone()],
    );
    assert!(
        next_event(&mut events, "pc:sessions_updated", Duration::from_secs(10))
            .await
            .is_some()
    );
    let (_, pc) = call(&f.ctx, "get_pc", serde_json::json!({})).await;
    assert_eq!(pc["users"][0]["sessions"].as_array().unwrap().len(), 2);

    // 消えたファイルは、取り除かれる。
    std::fs::remove_file(&new_file).unwrap();
    server::scan::enqueue_changed(
        f.ctx.clone(),
        &tokio::runtime::Handle::current(),
        vec![new_file],
    );
    assert!(
        next_event(&mut events, "pc:sessions_updated", Duration::from_secs(10))
            .await
            .is_some()
    );
    let (_, pc) = call(&f.ctx, "get_pc", serde_json::json!({})).await;
    assert_eq!(pc["users"][0]["sessions"].as_array().unwrap().len(), 1);
    let _ = &f.dir;
}
