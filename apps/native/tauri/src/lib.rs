mod dto;
mod state;

use app::{SessionSource, SettingsStore, TokenStore};
use dto::{
    AgentKindDto, AgentModeDto, AppErrorDto, AppWarningDto, ClaudeMdDto, ClaudeSettingsDto,
    DeviceCodeDto, GithubAuthFailedEventDto, GithubAuthStatusDto, GithubAuthenticatedEventDto,
    GithubProjectDto, GithubProjectSummaryDto, ProfileSummaryDto, ProjectDto, ProjectItemsPageDto,
    ProjectSettingsFileDto, RuleDto, RuleSummaryDto, SessionChangedEventDto, SessionDto,
    SessionSummaryDto, SettingsCorruptedEventDto, SettingsDto, SettingsInputDto, SkillDto,
    SkillSummaryDto,
};
use infra::{
    ClaudeCliAgent, FileClaudeMdStore, FileClaudeSettingsStore, FileProjectSettingsStore,
    FileRulesStore, FileSettingsStore, FileSkillsStore, FileSystemRepository, GithubApiClient,
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

/// 設定をバックグラウンドスレッドで永続化する。`update_settings` と
/// プロファイル操作系コマンド(`switch_profile`/`create_profile`/
/// `delete_profile`/`rename_profile`)で重複する定型処理をまとめる
/// (issue #72)。
async fn persist_settings(
    settings: domain::Settings,
    save_path: PathBuf,
) -> Result<(), AppErrorDto> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let store = FileSettingsStore::new(save_path);
        store.save(&settings)
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
    profile_id: Option<String>,
) -> Result<SettingsDto, AppErrorDto> {
    let settings = {
        let guard = state.lock().await;
        guard.settings.clone()
    };
    let effective_projects_dir = resolve_effective_projects_dir(&settings)?;
    let profile = app::resolve_profile(&settings, profile_id.as_deref())?.clone();
    Ok(SettingsDto {
        active_profile_id: settings.active_profile_id,
        profiles: settings
            .profiles
            .into_iter()
            .map(|p| ProfileSummaryDto {
                id: p.id,
                name: p.name,
            })
            .collect(),
        repository_path: profile.repository_path.map(|p| p.display().to_string()),
        github_project: profile.github_project.map(GithubProjectDto::from),
        selected_project_folders: profile.selected_project_folders,
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
    profile_id: Option<String>,
) -> Result<(), AppErrorDto> {
    let repository_path = input.repository_path.map(PathBuf::from);
    let github_project = input.github_project.map(domain::GithubProject::from);
    let claude_projects_dir = input.claude_projects_dir.map(PathBuf::from);

    // ロックは最小スコープに留める(native.md §2)。ロック保持中は候補値の
    // 組み立てとバリデーションのみ(I/Oはしない)、永続化はガードを解放
    // してから clone した値を使って行う。バリデーション失敗時は
    // `guard.settings` を書き換えないまま抜ける(無効な値をメモリ上の状態に
    // 残さないため)。`profile_id` が未指定ならアクティブプロファイルを対象に
    // する(メインウィンドウの挙動不変。issue #76)。
    let (settings_to_persist, save_path, projects_dir_changed) = {
        let mut guard = state.lock().await;

        let mut candidate = guard.settings.clone();
        let target_id = profile_id.unwrap_or_else(|| candidate.active_profile_id.clone());
        let Some(profile) = candidate.profiles.iter_mut().find(|p| p.id == target_id) else {
            return Err(AppErrorDto::from(app::AppError::NotFound(
                "指定されたプロファイルが見つかりません".to_string(),
            )));
        };
        profile.repository_path = repository_path;
        profile.github_project = github_project;
        profile.selected_project_folders = input.selected_project_folders;
        candidate.claude_projects_dir = claude_projects_dir;

        app::validate_settings(&candidate)?;

        let projects_dir_changed =
            guard.settings.claude_projects_dir != candidate.claude_projects_dir;
        guard.settings = candidate.clone();
        (candidate, guard.save_path.clone(), projects_dir_changed)
    };

    persist_settings(settings_to_persist.clone(), save_path).await?;

    if projects_dir_changed {
        match resolve_effective_projects_dir(&settings_to_persist) {
            Ok(root) => start_session_watcher(&app, root),
            Err(e) => eprintln!("セッション監視の張り替えに失敗しました: {e}"),
        }
    }

    let _ = app.emit("settings:updated", ());
    Ok(())
}

/// アクティブプロファイルを切り替える(issue #72)。
#[tauri::command]
async fn switch_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: String,
) -> Result<(), AppErrorDto> {
    let (settings_to_persist, save_path) = {
        let mut guard = state.lock().await;
        let updated = app::switch_profile(&guard.settings, &profile_id)?;
        guard.settings = updated.clone();
        (updated, guard.save_path.clone())
    };
    persist_settings(settings_to_persist, save_path).await?;
    let _ = app.emit("settings:updated", ());
    Ok(())
}

/// 空のプロファイルを作成してアクティブにする(issue #72)。戻り値は
/// 作成したプロファイルの最小限の情報(native.md §3.1)。
#[tauri::command]
async fn create_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    name: Option<String>,
) -> Result<ProfileSummaryDto, AppErrorDto> {
    let (settings_to_persist, save_path, created) = {
        let mut guard = state.lock().await;
        let (updated, created) = app::create_profile(&guard.settings, name);
        guard.settings = updated.clone();
        (updated, guard.save_path.clone(), created)
    };
    persist_settings(settings_to_persist, save_path).await?;
    let _ = app.emit("settings:updated", ());
    Ok(ProfileSummaryDto {
        id: created.id,
        name: created.name,
    })
}

/// プロファイルを削除する。最後の1件は削除できない。アクティブプロファイルを
/// 削除した場合は残りの先頭がアクティブになる(issue #72)。
#[tauri::command]
async fn delete_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: String,
) -> Result<(), AppErrorDto> {
    let (settings_to_persist, save_path) = {
        let mut guard = state.lock().await;
        let updated = app::delete_profile(&guard.settings, &profile_id)?;
        guard.settings = updated.clone();
        (updated, guard.save_path.clone())
    };
    persist_settings(settings_to_persist, save_path).await?;
    let _ = app.emit("settings:updated", ());
    Ok(())
}

/// プロファイルの表示名を変更する(issue #72)。
#[tauri::command]
async fn rename_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: String,
    name: String,
) -> Result<(), AppErrorDto> {
    let (settings_to_persist, save_path) = {
        let mut guard = state.lock().await;
        let updated = app::rename_profile(&guard.settings, &profile_id, &name)?;
        guard.settings = updated.clone();
        (updated, guard.save_path.clone())
    };
    persist_settings(settings_to_persist, save_path).await?;
    let _ = app.emit("settings:updated", ());
    Ok(())
}

/// 指定プロファイルを対象に新しいウィンドウを開く(マルチウィンドウ
/// Phase 1。issue #76)。ウィンドウ生成はRust側で行う(JSからのウィンドウ
/// 生成に capability を追加せずに済ませ、権限を最小に保つため。native.md
/// §4)。同じプロファイルを複数ウィンドウで開けるよう、ラベルは毎回一意に
/// 生成する。URLのクエリ `?profile=<id>` がそのウィンドウの対象プロファイルを
/// 表す(フロントは `useWindowProfileId` で読む)。
#[tauri::command]
async fn open_profile_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: String,
) -> Result<(), AppErrorDto> {
    let profile_name = {
        let guard = state.lock().await;
        app::resolve_profile(&guard.settings, Some(profile_id.as_str()))?
            .name
            .clone()
    };

    let label = format!("profile-{}", uuid::Uuid::new_v4());
    let url = tauri::WebviewUrl::App(format!("index.html#/?profile={profile_id}").into());
    tauri::WebviewWindowBuilder::new(&app, label, url)
        .title(format!("{profile_name} - ビューア"))
        .inner_size(800.0, 600.0)
        .drag_and_drop(false)
        .build()
        .map_err(|e| AppErrorDto::from(app::AppError::Io(e.to_string())))?;

    Ok(())
}

/// `AppState` から対象リポジトリのパスを取り出す。未設定なら
/// `InvalidInput` を返す(設定画面のCLAUDE.md編集はリポジトリ設定が前提)。
/// `profile_id` が `None` ならアクティブプロファイルを対象にする(issue #76)。
async fn repository_path_from_state(
    state: &tauri::State<'_, Mutex<AppState>>,
    profile_id: Option<&str>,
) -> Result<PathBuf, app::AppError> {
    let guard = state.lock().await;
    let profile = app::resolve_profile(&guard.settings, profile_id)?;
    profile.repository_path.clone().ok_or_else(|| {
        app::AppError::InvalidInput("対象リポジトリが設定されていません".to_string())
    })
}

#[tauri::command]
async fn get_repository_claude_md(
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: Option<String>,
) -> Result<ClaudeMdDto, AppErrorDto> {
    let repo_dir = repository_path_from_state(&state, profile_id.as_deref()).await?;
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
    profile_id: Option<String>,
) -> Result<(), AppErrorDto> {
    let repo_dir = repository_path_from_state(&state, profile_id.as_deref()).await?;
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

/// `project` の作業ディレクトリ(CLAUDE.mdと同じcwd解決)配下の
/// `.claude/rules/*.md` を一覧する(Rulesタブ用。issue #61)。
#[tauri::command]
async fn list_rules(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
) -> Result<Vec<RuleSummaryDto>, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<RuleSummaryDto>, app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileRulesStore::new();
        let rules = app::list_rules(&store, &repo_dir)?;
        Ok(rules.into_iter().map(RuleSummaryDto::from).collect())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// `.claude/rules/<file_name>` の内容を読む(表示専用。issue #61)。
#[tauri::command]
async fn get_rule(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    file_name: String,
) -> Result<RuleDto, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<RuleDto, app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileRulesStore::new();
        let content = app::get_rule(&store, &repo_dir, &file_name)?;
        Ok(RuleDto { content })
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// `project` の作業ディレクトリ配下の `.claude/skills/` にある(`SKILL.md`
/// を持つ)スキルを一覧する(Skillsタブ用。issue #65)。
#[tauri::command]
async fn list_skills(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
) -> Result<Vec<SkillSummaryDto>, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<SkillSummaryDto>, app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileSkillsStore::new();
        let skills = app::list_skills(&store, &repo_dir)?;
        Ok(skills.into_iter().map(SkillSummaryDto::from).collect())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// `.claude/skills/<name>/SKILL.md` の内容を読む(表示専用。issue #65)。
#[tauri::command]
async fn get_skill(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    name: String,
) -> Result<SkillDto, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<SkillDto, app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileSkillsStore::new();
        let content = app::get_skill(&store, &repo_dir, &name)?;
        Ok(SkillDto { content })
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// プロジェクトの `.claude/settings.json` / `settings.local.json` を読む
/// (issue #70)。`~/.claude/settings.json`(ユーザーレベル)対象の
/// `get_claude_settings_file` とは別コマンド。`which` で対象ファイルを選ぶ
/// (フロントからファイル名の自由入力は受けない。native.md §4)。
#[tauri::command]
async fn get_project_settings_file(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    which: ProjectSettingsFileDto,
) -> Result<ClaudeSettingsDto, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<ClaudeSettingsDto, app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileProjectSettingsStore::new();
        let file = app::read_project_settings_file(&store, &repo_dir, which.into())?;
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
async fn save_project_settings_file(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    which: ProjectSettingsFileDto,
    content: String,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let source = FileSystemRepository::new(root);
        let repo_dir = source.latest_session_cwd(&project)?;
        let store = FileProjectSettingsStore::new();
        app::save_project_settings_file(
            &store,
            &repo_dir,
            which.into(),
            &content,
            expected_modified_at_ms,
        )
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// `~/.claude/settings.json` を読む(issue #53)。対象パスはRust側
/// (`FileClaudeSettingsStore`)で固定解決し、フロントからパスやファイル名は
/// 一切受け取らない(native.md §4)。対象はこのファイルのみで、`.claude`
/// 配下の他ファイル(特に `.credentials.json`)への経路は作らない。
#[tauri::command]
async fn get_claude_settings_file() -> Result<ClaudeSettingsDto, AppErrorDto> {
    tauri::async_runtime::spawn_blocking(|| -> Result<ClaudeSettingsDto, app::AppError> {
        let store = FileClaudeSettingsStore::new();
        let file = app::read_claude_settings(&store)?;
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
async fn save_claude_settings_file(
    content: String,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppErrorDto> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let store = FileClaudeSettingsStore::new();
        app::save_claude_settings(&store, &content, expected_modified_at_ms)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// 認証状態は「キーチェーンにトークンがあるか」を基準にする(issue #54)。
/// ログイン名(`AppState.github_login`)が未確定でもトークンさえあれば
/// `authenticated: true` とし(`login` は `null`)、オフライン起動時などに
/// 誤って「ログインしてください」と表示しないようにする。トークンの
/// 有効性はAPIを実際に呼んだとき(401)に初めて判定する。
#[tauri::command]
async fn get_github_auth_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<GithubAuthStatusDto, AppErrorDto> {
    let login = {
        let guard = state.lock().await;
        guard.github_login.clone()
    };

    let token =
        tauri::async_runtime::spawn_blocking(|| -> Result<Option<String>, app::AppError> {
            let store = KeyringTokenStore::new();
            store.load()
        })
        .await
        .unwrap_or_else(|_| {
            Err(app::AppError::Io(
                "バックグラウンド処理に失敗しました".to_string(),
            ))
        })
        .map_err(AppErrorDto::from)?;

    let authenticated = token.is_some();

    // トークンはあるがログイン名が未確定なら、この画面を開いたタイミングで
    // 1回だけ受動的に再取得を試みる(issue #54: タブ表示時の自己回復)。
    // 結果は `github:authenticated`/`github:logged_out` イベント経由で
    // 反映するため、このコマンド自体はブロックしない。
    if let (Some(token), None) = (token, &login) {
        let app_for_retry = app.clone();
        tauri::async_runtime::spawn(async move {
            resolve_and_apply_github_login(&app_for_retry, token, &[]).await;
        });
    }

    Ok(GithubAuthStatusDto {
        authenticated,
        login,
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
async fn list_github_projects(
    app: tauri::AppHandle,
) -> Result<Vec<GithubProjectSummaryDto>, AppErrorDto> {
    let result = tauri::async_runtime::spawn_blocking(
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
    });
    finish_github_command(&app, result).await
}

/// 設定済みのGitHubプロジェクトのアイテムを1ページ分取得する(ビューアの
/// 「GitHub Project」タブ用。issue #34)。未認証・プロジェクト未設定時の
/// 案内表示はフロント側で(既に持っている認証状態・設定値から)行うため、
/// ここでは通常のエラーとして返すのみでよい。
#[tauri::command]
async fn list_github_project_items(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    cursor: Option<String>,
    profile_id: Option<String>,
) -> Result<ProjectItemsPageDto, AppErrorDto> {
    let github_project = {
        let guard = state.lock().await;
        app::resolve_profile(&guard.settings, profile_id.as_deref())?
            .github_project
            .clone()
    };
    let project = github_project.ok_or_else(|| {
        AppErrorDto::from(app::AppError::InvalidInput(
            "GitHubプロジェクトが設定されていません".to_string(),
        ))
    })?;

    let result = tauri::async_runtime::spawn_blocking(
        move || -> Result<ProjectItemsPageDto, app::AppError> {
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
        },
    )
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    });
    finish_github_command(&app, result).await
}

/// GitHub Projectアイテムのステータス(かんばんのカラム)を変更する
/// (issue #50)。`project_id`/`field_id` は `list_github_project_items` の
/// 戻り値をフロントがそのまま渡す。`option_id` が `None` のときは
/// 「No status」カラムへの移動としてStatusを未設定に戻す。
/// 楽観的更新はしない(native.md §3.1)。フロントは成功後に
/// `list_github_project_items` を呼び直して一覧を更新する。
#[tauri::command]
async fn update_github_project_item_status(
    app: tauri::AppHandle,
    project_id: String,
    item_id: String,
    field_id: String,
    option_id: Option<String>,
) -> Result<(), AppErrorDto> {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let store = KeyringTokenStore::new();
        let token = store.load()?.ok_or_else(|| {
            app::AppError::GithubUnauthenticated("GitHubにログインしてください".to_string())
        })?;
        let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
        app::update_github_project_item_status(
            &gateway,
            &token,
            &project_id,
            &item_id,
            &field_id,
            option_id.as_deref(),
        )
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    });
    finish_github_command(&app, result).await
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

/// 起動時のログイン名解決の再試行間隔(秒)。一時的な通信失敗(ネットワーク
/// 不通・タイムアウト・5xx)の場合だけこの間隔で再試行し、以後は打ち切る
/// (issue #54)。確定的な失効(401)は即座に打ち切り再試行しない。
const STARTUP_VIEWER_RETRY_BACKOFF_SECS: [u64; 3] = [10, 60, 300];

/// 起動時、既にGitHubトークンがキーチェーンにあれば有効性を確認し、
/// `AppState.github_login` を埋めて `github:authenticated` を通知する。
/// 一時的な失敗は `STARTUP_VIEWER_RETRY_BACKOFF_SECS` に沿って再試行する
/// (issue #54)。ネットワークI/Oを伴うため `.setup()` 自体をブロックしない
/// よう バックグラウンドタスクにする(起動を待たせない)。
fn start_github_session_check(app: &tauri::App) {
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let token = tauri::async_runtime::spawn_blocking(|| -> Option<String> {
            let store = KeyringTokenStore::new();
            store.load().ok().flatten()
        })
        .await
        .ok()
        .flatten();

        if let Some(token) = token {
            resolve_and_apply_github_login(&app_handle, token, &STARTUP_VIEWER_RETRY_BACKOFF_SECS)
                .await;
        }
    });
}

/// トークンが存在する前提でログイン名解決(`fetch_viewer`)を試み、結果を
/// `AppState`/イベントへ反映する(issue #54)。`backoff_secs` が空なら1回
/// だけ試す(タブ表示時の受動的な再取得など、長時間ブロックしたくない
/// 呼び出し用)。一時的な失敗が続き打ち切った場合は何もしない
/// (ログイン名は未確定のまま。次の機会に再試行される)。
async fn resolve_and_apply_github_login(
    app_handle: &tauri::AppHandle,
    token: String,
    backoff_secs: &'static [u64],
) {
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let gateway = GithubApiClient::new(GITHUB_CLIENT_ID);
        app::resolve_github_login_with_retry(&gateway, &token, backoff_secs, |secs| {
            std::thread::sleep(std::time::Duration::from_secs(secs));
        })
    })
    .await
    .unwrap_or(app::ViewerCheckOutcome::GaveUp);

    match outcome {
        app::ViewerCheckOutcome::Resolved(viewer) => {
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
        app::ViewerCheckOutcome::TokenExpired => {
            handle_confirmed_github_auth_expiry(app_handle).await;
        }
        app::ViewerCheckOutcome::GaveUp => {}
    }
}

/// 確定的なGitHub認証失効(401)の後始末。キーチェーンのトークンを削除し
/// (既に無ければ何もしない)、`AppState.github_login` をクリアして
/// `github:logged_out` を通知する。一時的な通信失敗はこの経路に来ない
/// (`AppError::GithubAuthExpired` は確定的な失効のみを表す。issue #54)。
async fn handle_confirmed_github_auth_expiry(app_handle: &tauri::AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(|| {
        let store = KeyringTokenStore::new();
        store.delete()
    })
    .await;

    let state = app_handle.state::<Mutex<AppState>>();
    {
        let mut guard = state.lock().await;
        guard.github_login = None;
    }
    let _ = app_handle.emit("github:logged_out", ());
}

/// GitHub API呼び出しを伴うコマンドの結果を仕上げる共通処理。確定的な失効
/// (`AppError::GithubAuthExpired`)ならトークン削除+`github:logged_out`を
/// 通知してから、通常どおりDTOへ変換する(issue #54)。
async fn finish_github_command<T>(
    app: &tauri::AppHandle,
    result: Result<T, app::AppError>,
) -> Result<T, AppErrorDto> {
    if let Err(app::AppError::GithubAuthExpired(_)) = &result {
        handle_confirmed_github_auth_expiry(app).await;
    }
    result.map_err(Into::into)
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
            switch_profile,
            create_profile,
            delete_profile,
            rename_profile,
            open_profile_window,
            get_repository_claude_md,
            save_repository_claude_md,
            get_project_claude_md,
            save_project_claude_md,
            list_rules,
            get_rule,
            list_skills,
            get_skill,
            get_project_settings_file,
            save_project_settings_file,
            get_claude_settings_file,
            save_claude_settings_file,
            get_github_auth_status,
            github_login_start,
            github_logout,
            list_github_projects,
            list_github_project_items,
            update_github_project_item_status,
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
