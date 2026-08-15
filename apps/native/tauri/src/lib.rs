mod dto;
mod state;

use app::SettingsStore;
use dto::{
    AgentKindDto, AgentModeDto, AppErrorDto, AppWarningDto, ProjectDto, SessionChangedEventDto,
    SessionDto, SessionSummaryDto, SettingsCorruptedEventDto, SettingsDto, SettingsInputDto,
};
use infra::{ClaudeCliAgent, FileSettingsStore, FileSystemRepository};
use state::AppState;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

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
    app: tauri::AppHandle,
    project: String,
    session_id: String,
    text: String,
    mode: AgentModeDto,
) -> Result<(), AppErrorDto> {
    // claude CLI の起動は数秒〜数十秒かかるため、async ランタイムを塞がないよう
    // ブロッキングスレッドで実行する。
    let project_for_warning = project.clone();
    let result = tauri::async_runtime::spawn_blocking(
        move || -> Result<Option<app::SessionMismatch>, app::AppError> {
            let source = FileSystemRepository::from_home_dir()?;
            let agent = ClaudeCliAgent::new();
            app::send_message(&source, &agent, &project, &session_id, &text, mode.into())
        },
    )
    .await;

    match result {
        Ok(Ok(Some(mismatch))) => {
            // 送信は成功しているためエラーにはせず、警告イベントで通知する。
            let _ = app.emit(
                "app:warning",
                AppWarningDto {
                    project: project_for_warning,
                    expected_session_id: mismatch.expected_session_id,
                    actual_session_id: mismatch.actual_session_id,
                },
            );
            Ok(())
        }
        Ok(Ok(None)) => Ok(()),
        Ok(Err(e)) => Err(e.into()),
        Err(_) => Err(AppErrorDto {
            code: "internal".to_string(),
            message: "バックグラウンド処理に失敗しました".to_string(),
        }),
    }
}

/// リポジトリの絶対パスから `~/.claude/projects/` 配下のディレクトリ名
/// (`list_sessions`/`get_latest_session` 等が使う "project" 識別子)を求める。
/// フロントはエンコード規則を知らず、この Query 経由でのみ変換する
/// (native.md 1: ビジネスロジックは Rust 側に置く)。
#[tauri::command]
fn get_project_name(path: String) -> String {
    domain::encode_project_dir_name(&path)
}

#[tauri::command]
fn list_sessions(project: String) -> Result<Vec<SessionSummaryDto>, AppErrorDto> {
    let source = FileSystemRepository::from_home_dir()?;
    let sessions = app::list_sessions(&source, &project)?;
    Ok(sessions.into_iter().map(SessionSummaryDto::from).collect())
}

#[tauri::command]
async fn get_settings(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<SettingsDto, AppErrorDto> {
    let guard = state.lock().await;
    Ok(SettingsDto::from(guard.settings.clone()))
}

#[tauri::command]
async fn update_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    input: SettingsInputDto,
) -> Result<(), AppErrorDto> {
    let settings: domain::Settings = input.into();
    app::validate_settings(&settings)?;

    // ロックは最小スコープに留める(native.md §2)。永続化(ファイルI/O)は
    // ガードを解放してから、clone した値を使って行う。
    let (settings_to_persist, save_path) = {
        let mut guard = state.lock().await;
        guard.settings = settings.clone();
        (guard.settings.clone(), guard.save_path.clone())
    };

    let save_result: Result<(), app::AppError> = tauri::async_runtime::spawn_blocking(move || {
        let store = FileSettingsStore::new(save_path);
        store.save(&settings_to_persist)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    });
    save_result?;

    let _ = app.emit("settings:updated", ());
    Ok(())
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

/// 設定ファイルを読み込み `AppState` として管理下に置く。破損から復旧した
/// 場合はフロントへ `settings:corrupted` を通知する(native.md §2)。
fn setup_app_state(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let save_path = app.path().app_data_dir()?.join("settings.json");
    let state::LoadResult {
        state,
        recovered_from_corruption,
    } = AppState::load(save_path)?;
    app.manage(Mutex::new(state));

    if recovered_from_corruption {
        let _ = app.emit(
            "settings:corrupted",
            SettingsCorruptedEventDto {
                message: "設定ファイルが破損していたため、初期状態に戻しました。設定を再度行ってください。".to_string(),
            },
        );
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            get_latest_session,
            send_message,
            get_project_name,
            list_sessions,
            get_settings,
            update_settings,
        ])
        .setup(|app| {
            start_session_watcher(app);
            setup_app_state(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
