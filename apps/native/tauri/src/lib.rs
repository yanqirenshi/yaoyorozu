mod dto;

use dto::{AgentKindDto, AppErrorDto, ProjectDto, SessionChangedEventDto, SessionDto};
use infra::{ClaudeCliAgent, FileSystemRepository};
use tauri::{Emitter, Manager};

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectDto>, AppErrorDto> {
    let source = FileSystemRepository::from_home_dir()?;
    let projects = app::list_projects(&source)?;
    Ok(projects.into_iter().map(ProjectDto::from).collect())
}

#[tauri::command]
fn get_latest_session(
    project: String,
    offset: usize,
    limit: usize,
) -> Result<SessionDto, AppErrorDto> {
    let source = FileSystemRepository::from_home_dir()?;
    let session = app::get_latest_session(&source, &project, offset, limit)?;
    Ok(session.into())
}

#[tauri::command]
async fn send_message(
    project: String,
    session_id: String,
    text: String,
) -> Result<(), AppErrorDto> {
    // claude CLI の起動は数秒〜数十秒かかるため、async ランタイムを塞がないよう
    // ブロッキングスレッドで実行する。
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), AppErrorDto> {
        let source = FileSystemRepository::from_home_dir()?;
        let agent = ClaudeCliAgent::new();
        app::send_message(&source, &agent, &project, &session_id, &text)?;
        Ok(())
    })
    .await;

    result.unwrap_or_else(|_| {
        Err(AppErrorDto {
            code: "internal".to_string(),
            message: "バックグラウンド処理に失敗しました".to_string(),
        })
    })
}

/// `~/.claude/projects/` の変更監視を開始し、`session:changed` イベントとして
/// フロントへ通知する。監視の失敗はアプリ起動を止めるほどの問題ではないため、
/// 失敗してもログを出すのみでアプリ自体は起動を続ける。
fn start_session_watcher(app: &tauri::App) {
    let repo = match FileSystemRepository::from_home_dir() {
        Ok(repo) => repo,
        Err(e) => {
            eprintln!("セッションディレクトリを解決できませんでした: {e}");
            return;
        }
    };

    let handle = app.handle().clone();
    match repo.watch_projects(move |project| {
        let _ = handle.emit(
            "session:changed",
            SessionChangedEventDto {
                project,
                agent: AgentKindDto::ClaudeCode,
            },
        );
    }) {
        Ok(debouncer) => {
            app.manage(debouncer);
        }
        Err(e) => eprintln!("セッションの監視を開始できませんでした: {e}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            get_latest_session,
            send_message
        ])
        .setup(|app| {
            start_session_watcher(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
