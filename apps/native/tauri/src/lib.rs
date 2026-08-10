mod dto;

use dto::{AppErrorDto, MessageDto, ProjectDto};
use infra::FileSystemRepository;

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectDto>, AppErrorDto> {
    let repo = FileSystemRepository::from_home_dir()?;
    let projects = app::list_projects(&repo)?;
    Ok(projects.into_iter().map(ProjectDto::from).collect())
}

#[tauri::command]
fn get_latest_session(project: String) -> Result<Vec<MessageDto>, AppErrorDto> {
    let repo = FileSystemRepository::from_home_dir()?;
    let messages = app::get_latest_session(&repo, &project)?;
    Ok(messages.into_iter().map(MessageDto::from).collect())
}

#[tauri::command]
async fn send_message(project: String, text: String) -> Result<(), AppErrorDto> {
    // claude CLI の起動は数秒〜数十秒かかるため、async ランタイムを塞がないよう
    // ブロッキングスレッドで実行する。
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), AppErrorDto> {
        let repo = FileSystemRepository::from_home_dir()?;
        app::send_message(&repo, &project, &text)?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            get_latest_session,
            send_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
