mod dto;
mod state;

use app::{SessionSource, SettingsStore, TokenStore};
use dto::{
    AgentKindDto, AgentModeDto, AppErrorDto, AppWarningDto, ClaudeMdDto, DeviceCodeDto,
    GithubAuthFailedEventDto, GithubAuthStatusDto, GithubAuthenticatedEventDto, GithubProjectDto,
    GithubProjectSummaryDto, ProjectDto, ProjectItemsPageDto, SessionChangedEventDto, SessionDto,
    SessionSummaryDto, SettingsCorruptedEventDto, SettingsDto, SettingsInputDto,
};
use infra::{
    ClaudeCliAgent, FileClaudeMdStore, FileSettingsStore, FileSystemRepository, GithubApiClient,
    KeyringTokenStore,
};
use state::AppState;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

/// GitHub OAuth App の client_id。デバイスフローは `client_secret` を使わない
/// ため秘密情報ではなく、定数として埋め込んでよい(issue #24)。
const GITHUB_CLIENT_ID: &str = "Ov23liqOl7JIbaGeJev4";

/// 現在保持しているファイル監視。`Option` を差し替えることで張り替えを表現する
/// (`Debouncer` は drop されると監視を止めるため、新しい値で上書きするだけで
/// 旧い監視は自動的に止まる)。`tauri::State` は同じ型を複数回 `manage()`
/// できないため、`AppState`(設定のSSoT)とは別にこの型で1つだけ管理する。
type WatcherSlot = std::sync::Mutex<Option<infra::SessionWatcher>>;

/// 設定の `claude_projects_dir` と既定値(`~/.claude/projects/`)から、
/// 実際に使うルートディレクトリを求める。
fn resolve_effective_projects_dir(settings: &domain::Settings) -> Result<PathBuf, app::AppError> {
    let default = FileSystemRepository::default_projects_dir()?;
    Ok(domain::effective_projects_dir(
        settings.claude_projects_dir.as_deref(),
        &default,
    ))
}

/// `AppState` をロックして現在の設定から有効なルートディレクトリを求める。
/// 各コマンドで重複しないよう共通化する。
async fn effective_projects_dir_from_state(
    state: &tauri::State<'_, Mutex<AppState>>,
) -> Result<PathBuf, app::AppError> {
    let settings = {
        let guard = state.lock().await;
        guard.settings.clone()
    };
    resolve_effective_projects_dir(&settings)
}

#[tauri::command]
async fn list_projects(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Vec<ProjectDto>, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ProjectDto>, app::AppError> {
        let source = FileSystemRepository::new(root);
        let projects = app::list_projects(&source)?;
        Ok(projects.into_iter().map(ProjectDto::from).collect())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

#[tauri::command]
async fn get_session(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    session_id: String,
    offset: usize,
    limit: usize,
) -> Result<SessionDto, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<SessionDto, app::AppError> {
        let source = FileSystemRepository::new(root);
        let session = app::get_session(&source, &project, &session_id, offset, limit)?;
        Ok(session.into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

#[tauri::command]
async fn list_sessions(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
) -> Result<Vec<SessionSummaryDto>, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(
        move || -> Result<Vec<SessionSummaryDto>, app::AppError> {
            let source = FileSystemRepository::new(root);
            let sessions = app::list_sessions(&source, &project)?;
            Ok(sessions.into_iter().map(SessionSummaryDto::from).collect())
        },
    )
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

#[tauri::command]
async fn send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    session_id: String,
    text: String,
    mode: AgentModeDto,
) -> Result<(), AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    // claude CLI の起動は数秒〜数十秒かかるため、async ランタイムを塞がないよう
    // ブロッキングスレッドで実行する。
    let project_for_warning = project.clone();
    let result = tauri::async_runtime::spawn_blocking(
        move || -> Result<Option<app::SessionMismatch>, app::AppError> {
            let source = FileSystemRepository::new(root);
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

#[tauri::command]
async fn get_settings(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<SettingsDto, AppErrorDto> {
    let settings = {
        let guard = state.lock().await;
        guard.settings.clone()
    };
    let effective_projects_dir = resolve_effective_projects_dir(&settings)?;
    Ok(SettingsDto {
        repository_path: settings.repository_path.map(|p| p.display().to_string()),
        github_project: settings.github_project.map(GithubProjectDto::from),
        selected_project_folders: settings.selected_project_folders,
        claude_projects_dir: settings
            .claude_projects_dir
            .map(|p| p.display().to_string()),
        effective_projects_dir: effective_projects_dir.display().to_string(),
    })
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
    let (settings_to_persist, save_path, projects_dir_changed) = {
        let mut guard = state.lock().await;
        let projects_dir_changed =
            guard.settings.claude_projects_dir != settings.claude_projects_dir;
        guard.settings = settings.clone();
        (
            guard.settings.clone(),
            guard.save_path.clone(),
            projects_dir_changed,
        )
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

    if projects_dir_changed {
        match resolve_effective_projects_dir(&settings) {
            Ok(root) => start_session_watcher(&app, root),
            Err(e) => eprintln!("セッション監視の張り替えに失敗しました: {e}"),
        }
    }

    let _ = app.emit("settings:updated", ());
    Ok(())
}

/// `AppState` から対象リポジトリのパスを取り出す。未設定なら
/// `InvalidInput` を返す(設定画面のCLAUDE.md編集はリポジトリ設定が前提)。
async fn repository_path_from_state(
    state: &tauri::State<'_, Mutex<AppState>>,
) -> Result<PathBuf, app::AppError> {
    let guard = state.lock().await;
    guard.settings.repository_path.clone().ok_or_else(|| {
        app::AppError::InvalidInput("対象リポジトリが設定されていません".to_string())
    })
}

#[tauri::command]
async fn get_repository_claude_md(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<ClaudeMdDto, AppErrorDto> {
    let repo_dir = repository_path_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<ClaudeMdDto, app::AppError> {
        let store = FileClaudeMdStore::new();
        let file = app::read_claude_md(&store, &repo_dir)?;
        Ok(file.into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

#[tauri::command]
async fn save_repository_claude_md(
    state: tauri::State<'_, Mutex<AppState>>,
    content: String,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppErrorDto> {
    let repo_dir = repository_path_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let store = FileClaudeMdStore::new();
        app::save_claude_md(&store, &repo_dir, &content, expected_modified_at_ms)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// `project`(`~/.claude/projects/` 配下のフォルダ名)の最新セッションが
/// 記録している作業ディレクトリ(cwd)を、CLAUDE.md の対象ディレクトリとして
/// 使う(issue #27: ビューア側のCLAUDE.md編集はプロジェクトの作業ディレクトリ
/// 直下を対象とする)。
#[tauri::command]
async fn get_project_claude_md(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
) -> Result<ClaudeMdDto, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<ClaudeMdDto, app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileClaudeMdStore::new();
        let file = app::read_claude_md(&store, &repo_dir)?;
        Ok(file.into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

#[tauri::command]
async fn save_project_claude_md(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    content: String,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileClaudeMdStore::new();
        app::save_claude_md(&store, &repo_dir, &content, expected_modified_at_ms)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

#[tauri::command]
async fn get_github_auth_status(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<GithubAuthStatusDto, AppErrorDto> {
    let guard = state.lock().await;
    Ok(GithubAuthStatusDto {
        authenticated: guard.github_login.is_some(),
        login: guard.github_login.clone(),
    })
}

/// デバイスコードを取得し、`user_code`/`verification_uri` を即座に返す。
/// トークンのポーリング(最大15分程度)はバックグラウンドタスクで継続し、
/// 完了時に `github:authenticated`、失敗時に `github:auth_failed` を emit する
/// (コマンド自体を長時間ブロックしない)。
#[tauri::command]
async fn github_login_start(app: tauri::AppHandle) -> Result<DeviceCodeDto, AppErrorDto> {
    let authorization = tauri::async_runtime::spawn_blocking(|| {
        let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
        app::start_github_login(&gateway)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })?;

    let device_code_dto = DeviceCodeDto::from(authorization.clone());

    tauri::async_runtime::spawn(async move {
        let poll_outcome = tauri::async_runtime::spawn_blocking(move || {
            let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
            let store = KeyringTokenStore::new();
            app::poll_and_store_token(&gateway, &store, &authorization, |secs| {
                std::thread::sleep(std::time::Duration::from_secs(secs));
            })
        })
        .await
        .unwrap_or_else(|_| {
            Err(app::AppError::Io(
                "バックグラウンド処理に失敗しました".to_string(),
            ))
        });

        let token = match poll_outcome {
            Ok(token) => token,
            Err(e) => {
                let _ = app.emit(
                    "github:auth_failed",
                    GithubAuthFailedEventDto {
                        message: e.to_string(),
                    },
                );
                return;
            }
        };

        let viewer_outcome = tauri::async_runtime::spawn_blocking(move || {
            let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
            app::fetch_github_viewer(&gateway, &token)
        })
        .await
        .unwrap_or_else(|_| {
            Err(app::AppError::Io(
                "バックグラウンド処理に失敗しました".to_string(),
            ))
        });

        match viewer_outcome {
            Ok(viewer) => {
                let state = app.state::<Mutex<AppState>>();
                {
                    let mut guard = state.lock().await;
                    guard.github_login = Some(viewer.login.clone());
                }
                let _ = app.emit(
                    "github:authenticated",
                    GithubAuthenticatedEventDto {
                        login: viewer.login,
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "github:auth_failed",
                    GithubAuthFailedEventDto {
                        message: e.to_string(),
                    },
                );
            }
        }
    });

    Ok(device_code_dto)
}

#[tauri::command]
async fn github_logout(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), AppErrorDto> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = KeyringTokenStore::new();
        store.delete()
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })?;

    {
        let mut guard = state.lock().await;
        guard.github_login = None;
    }

    let _ = app.emit("github:logged_out", ());
    Ok(())
}

#[tauri::command]
async fn list_github_projects() -> Result<Vec<GithubProjectSummaryDto>, AppErrorDto> {
    tauri::async_runtime::spawn_blocking(
        || -> Result<Vec<GithubProjectSummaryDto>, app::AppError> {
            let store = KeyringTokenStore::new();
            let token = store.load()?.ok_or_else(|| {
                app::AppError::GithubUnauthenticated("GitHubにログインしてください".to_string())
            })?;
            let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
            let summaries = app::list_github_projects(&gateway, &token)?;
            Ok(summaries
                .into_iter()
                .map(GithubProjectSummaryDto::from)
                .collect())
        },
    )
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// 設定済みのGitHubプロジェクトのアイテムを1ページ分取得する(ビューアの
/// 「GitHub Project」タブ用。issue #34)。未認証・プロジェクト未設定時の
/// 案内表示はフロント側で(既に持っている認証状態・設定値から)行うため、
/// ここでは通常のエラーとして返すのみでよい。
#[tauri::command]
async fn list_github_project_items(
    state: tauri::State<'_, Mutex<AppState>>,
    cursor: Option<String>,
) -> Result<ProjectItemsPageDto, AppErrorDto> {
    let github_project = {
        let guard = state.lock().await;
        guard.settings.github_project.clone()
    };
    let project = github_project.ok_or_else(|| {
        AppErrorDto::from(app::AppError::InvalidInput(
            "GitHubプロジェクトが設定されていません".to_string(),
        ))
    })?;

    tauri::async_runtime::spawn_blocking(move || -> Result<ProjectItemsPageDto, app::AppError> {
        let store = KeyringTokenStore::new();
        let token = store.load()?.ok_or_else(|| {
            app::AppError::GithubUnauthenticated("GitHubにログインしてください".to_string())
        })?;
        let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
        let page = app::list_github_project_items(
            &gateway,
            &token,
            &project.owner,
            project.number,
            cursor.as_deref(),
        )?;
        Ok(page.into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// `root` の変更監視を(再)開始し、`session:changed` イベントとしてフロントへ
/// 通知する。既存の監視があれば `WatcherSlot` の中身を新しいものに差し替える
/// ことで自動的に停止する(`Debouncer` は drop されると監視を止める)。
/// 監視の失敗はアプリを止めるほどの問題ではないため、失敗してもログを
/// 出すのみでアプリ自体は動作を続ける(直前の監視があればそのまま残る)。
fn start_session_watcher(app_handle: &tauri::AppHandle, root: PathBuf) {
    let repo = FileSystemRepository::new(root);
    let handle = app_handle.clone();
    match repo.watch_projects(move |project| {
        let _ = handle.emit(
            "session:changed",
            SessionChangedEventDto {
                project,
                agent: AgentKindDto::ClaudeCode,
            },
        );
    }) {
        Ok(new_watcher) => {
            let slot = app_handle.state::<WatcherSlot>();
            match slot.lock() {
                Ok(mut guard) => *guard = Some(new_watcher),
                Err(poisoned) => *poisoned.into_inner() = Some(new_watcher),
            };
        }
        Err(e) => eprintln!("セッションの監視を開始できませんでした: {e}"),
    }
}

/// 設定ファイルを読み込み `AppState` として管理下に置く。破損から復旧した
/// 場合はフロントへ `settings:corrupted` を通知する(native.md §2)。
/// 戻り値は起動時点での有効なセッションルート(ファイル監視の初期対象)。
fn setup_app_state(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let save_path = app.path().app_data_dir()?.join("settings.json");
    let state::LoadResult {
        state,
        recovered_from_corruption,
    } = AppState::load(save_path)?;
    let root = resolve_effective_projects_dir(&state.settings)?;
    app.manage(Mutex::new(state));

    if recovered_from_corruption {
        let _ = app.emit(
            "settings:corrupted",
            SettingsCorruptedEventDto {
                message: "設定ファイルが破損していたため、初期状態に戻しました。設定を再度行ってください。".to_string(),
            },
        );
    }
    Ok(root)
}

/// 起動時、既にGitHubトークンがキーチェーンにあれば有効性を確認し、
/// `AppState.github_login` を埋めて `github:authenticated` を通知する。
/// ネットワークI/Oを伴うため `.setup()` 自体をブロックしないよう
/// バックグラウンドタスクにする(起動を待たせない)。
fn start_github_session_check(app: &tauri::App) {
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let viewer = tauri::async_runtime::spawn_blocking(|| -> Option<app::GithubViewer> {
            let store = KeyringTokenStore::new();
            let token = store.load().ok().flatten()?;
            let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
            app::fetch_github_viewer(&gateway, &token).ok()
        })
        .await
        .ok()
        .flatten();

        if let Some(viewer) = viewer {
            let state = app_handle.state::<Mutex<AppState>>();
            {
                let mut guard = state.lock().await;
                guard.github_login = Some(viewer.login.clone());
            }
            let _ = app_handle.emit(
                "github:authenticated",
                GithubAuthenticatedEventDto {
                    login: viewer.login,
                },
            );
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            get_session,
            list_sessions,
            send_message,
            get_settings,
            update_settings,
            get_repository_claude_md,
            save_repository_claude_md,
            get_project_claude_md,
            save_project_claude_md,
            get_github_auth_status,
            github_login_start,
            github_logout,
            list_github_projects,
            list_github_project_items,
        ])
        .setup(|app| {
            let root = setup_app_state(app)?;
            app.manage(WatcherSlot::new(None));
            start_session_watcher(app.handle(), root);
            start_github_session_check(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
