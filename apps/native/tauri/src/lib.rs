mod dto;
mod local_api;
mod state;

use app::{SessionSource, SettingsStore, TokenStore};
use dto::{
    AgentKindDto, AgentModeDto, AppErrorDto, AppWarningDto, ClaudeDirPageDto, ClaudeMdDto,
    ClaudeSettingsDto, ConversationDto, DeviceCodeDto, GithubAuthFailedEventDto,
    GithubAuthStatusDto, GithubAuthenticatedEventDto, GithubProjectDto, GithubProjectSummaryDto,
    HubLayoutDto, HubTuningDto, NodePositionDto, PcDto, ProfileSummaryDto, ProjectDto,
    ProjectItemsPageDto, ProjectSettingsFileDto, RuleDto, RuleSummaryDto, SessionChangedEventDto,
    SessionSummaryDto, SettingsCorruptedEventDto, SettingsDto, SettingsInputDto, SkillDto,
    SkillSummaryDto, WindowStateDto, WindowTabDto,
};
use infra::{
    ClaudeCliAgent, FileClaudeDirStore, FileClaudeMdStore, FileClaudeSettingsStore,
    FileHubLayoutStore, FileHubTuningStore, FileProjectSettingsStore, FileRulesStore,
    FileSettingsStore, FileSkillsStore, FileSystemRepository, GithubApiClient, KeyringTokenStore,
};
use state::{resolve_effective_projects_dir, AppState};
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

/// 指定セッションの会話(メッセージ本文)を返す。あわせて、同じ操作の
/// 一部として`LogLine`一覧も組み立てて`AppState.loaded_log_lines`へ
/// キャッシュする(オブジェクトモデル実装 第6弾。issue #208。
/// `app::SessionSource::session_lines`のドキュメントコメント参照:
/// 実装上は別読み込みだが、セッションを開いた操作に相乗りする形で
/// 「開いたときに組み立てる」意図を満たす)。LogLine側の読み込みに
/// 失敗しても会話表示自体は妨げない(fail-safe。警告ログのみ)。
#[tauri::command]
async fn get_session(
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    session_id: String,
    offset: usize,
    limit: usize,
) -> Result<ConversationDto, AppErrorDto> {
    let root = effective_projects_dir_from_state(&state).await?;
    let conversation_file_path = root.join(&project).join(format!("{session_id}.jsonl"));

    let project_for_lines = project.clone();
    let session_id_for_lines = session_id.clone();
    let root_for_lines = root.clone();

    let conversation =
        tauri::async_runtime::spawn_blocking(move || -> Result<ConversationDto, app::AppError> {
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
        .map_err(AppErrorDto::from)?;

    let log_lines = tauri::async_runtime::spawn_blocking(move || {
        let source = FileSystemRepository::new(root_for_lines);
        app::load_session_lines(&source, &project_for_lines, &session_id_for_lines)
    })
    .await
    .ok()
    .and_then(|result| {
        result
            .inspect_err(|e| {
                eprintln!("LogLineの読み込みに失敗したため、行キャッシュは更新しません: {e}")
            })
            .ok()
    });

    if let Some(log_lines) = log_lines {
        let mut guard = state.lock().await;
        guard
            .loaded_log_lines
            .insert(conversation_file_path, log_lines);
    }

    Ok(conversation)
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
/// 生成する。URLのパスパラメータ `/profiles/<id>` がそのウィンドウの対象
/// プロファイルを表す(フロントは `useWindowProfileId` で読む。issue #88)。
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
    let url = tauri::WebviewUrl::App(format!("index.html#/profiles/{profile_id}").into());
    tauri::WebviewWindowBuilder::new(&app, label, url)
        .title(format!("{profile_name} - ビューア"))
        .inner_size(800.0, 600.0)
        .drag_and_drop(false)
        .build()
        .map_err(|e| AppErrorDto::from(app::AppError::Io(e.to_string())))?;

    Ok(())
}

/// このウィンドウの表示状態(タブの配列+アクティブタブ)をレジストリへ
/// 報告する(ハブ化 その1。issue #83)。ウィンドウのラベルは呼び出し元の
/// Tauriウィンドウから取得する(フロントに送らせない。native.md §4)。
/// 設定ファイルには保存しないランタイム状態のため永続化ステップは無い
/// (native.md §3.1: ロック→更新→解放→emit)。
#[tauri::command]
async fn report_window_state(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, Mutex<AppState>>,
    tabs: Vec<WindowTabDto>,
    active_tab_index: usize,
) -> Result<(), AppErrorDto> {
    let label = window.label().to_string();
    let domain_tabs = tabs.into_iter().map(domain::WindowTab::from).collect();
    {
        let mut guard = state.lock().await;
        guard.window_states =
            app::report_window_state(&guard.window_states, label, domain_tabs, active_tab_index);
    }
    let _ = app.emit("windows:changed", ());
    Ok(())
}

/// 全ウィンドウの表示状態の一覧を返す(ハブ化 その1。issue #83)。
#[tauri::command]
async fn list_window_states(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Vec<WindowStateDto>, AppErrorDto> {
    let guard = state.lock().await;
    Ok(app::list_window_states(&guard.window_states)
        .into_iter()
        .map(WindowStateDto::from)
        .collect())
}

/// 現在のPC・ログインユーザー情報を返す(オブジェクトモデル実装 第1弾。
/// issue #182)。PC・ユーザー自体は起動時に一度組み立てて `AppState` に
/// 保持したものを使うが(リクエストのたびにOSへ問い合わせ直すことはしない)、
/// ユーザーが所有する `GitRepository` 一覧は settings のプロファイルから
/// クエリのたびに都度組み立てて差し込む(鮮度のため。issue #189。
/// `app::current_pc_with_repositories` のドキュメントコメント参照)。
/// `GitRepository.branches`/`.worktrees` は `AppState.git_ledger`(起動時と
/// 再読み込み操作時にのみ突き合わせ済みのもの)を差し込むだけで、ここでは
/// gitコマンドを実行しない(issue #193。`app::reconcile_git_ledger` の
/// ドキュメントコメント参照: 都度実行するには重すぎるため)。
/// `User.sessions` も同様に `AppState.user_sessions`(起動時と再読み込み
/// 操作時にのみ組み立て済みのもの)を差し込むだけで、ここではjsonlを
/// 走査しない(issue #197)。`Session.conversation_files[].lines`(`LogLine`)は
/// `AppState.loaded_log_lines`(`get_session`でセッションを開いたときに
/// キャッシュ済みのもの)を差し込むだけで、ここでは行の読み込みをしない
/// (issue #208。未読み込みのセッションは空Vecのまま)。
///
/// `data_loaded`(issue #218)は`AppState.pc_data_loaded`をそのまま返す。
/// `pc:data_loaded`イベントはマウント中のハブにしか届かない(#212の既知の
/// 制約)ため、フロントはマウント時にこの値をまず問い合わせ、あわせて
/// イベントを購読する形にする(イベントとポーリングの二重化はしない)。
///
/// `SessionDto.cwd`/`git_branch`(issue #224)も同様に`From`では埋まらない
/// (`domain::Session`が持たないため)。`AppState.user_sessions`から
/// `apply_session_display_hints`で差し込む。
#[tauri::command]
async fn get_pc(state: tauri::State<'_, Mutex<AppState>>) -> Result<PcDto, AppErrorDto> {
    let guard = state.lock().await;
    let pc = app::current_pc_with_repositories(guard.pc.clone(), &guard.settings);
    let pc = app::pc_with_git_ledger(pc, &guard.git_ledger);
    let pc = app::pc_with_user_sessions(pc, guard.user_sessions.clone());
    let pc = app::pc_with_loaded_lines(pc, &guard.loaded_log_lines);
    let mut dto = PcDto::from(pc);
    dto.data_loaded = guard.pc_data_loaded;
    apply_session_display_hints(&mut dto, &guard.user_sessions);
    Ok(dto)
}

/// `SessionDto.cwd`/`git_branch`(issue #224)へ、表示補助データを差し込む。
/// 解決規則(同じsession_idが複数あれば更新時刻の新しい方を優先)自体は
/// `app::resolve_session_display_hints`(純粋関数)に置き、ここでは結果を
/// `SessionDto`へ書き戻すだけの薄い配線に留める。
fn apply_session_display_hints(dto: &mut PcDto, parsed: &[domain::ParsedSession]) {
    let hints = app::resolve_session_display_hints(parsed);
    for user in &mut dto.users {
        for session in &mut user.sessions {
            if let Some(hint) = hints.get(&session.session_id) {
                session.cwd = hint.cwd.clone();
                session.git_branch = hint.git_branch.clone();
            }
        }
    }
}

/// 登録済み全リポジトリのGit状態(ブランチ・worktree)を再観測して台帳を
/// 更新し、あわせて全プロジェクトから`Session`一覧も再構築して
/// `AppState`へ書き込む(オブジェクトモデル実装 第3弾。issue #193/
/// 第4弾。issue #197)。起動後のバックグラウンドタスク
/// (`start_pc_data_background_load`)と `reconcile_git_state` command の
/// 両方から使う共通処理(issue #212)。ロックは設定値取得時と書き込み時の
/// 短時間だけ保持し、git実行・jsonl走査の間は保持しない(UI操作を
/// ブロックしないため)。
async fn reload_git_ledger_and_sessions(app: &tauri::AppHandle) -> Result<(), app::AppError> {
    let (settings, previous_ledger, git_ledger_path) = {
        let state = app.state::<Mutex<AppState>>();
        let guard = state.lock().await;
        (
            guard.settings.clone(),
            guard.git_ledger.clone(),
            guard.git_ledger_path.clone(),
        )
    };

    let spawn_result = tauri::async_runtime::spawn_blocking(move || {
        let ledger =
            state::reconcile_and_save_git_ledger(&settings, &previous_ledger, &git_ledger_path);
        let sessions = state::build_and_report_user_sessions(&settings);
        (ledger, sessions)
    })
    .await;

    let state = app.state::<Mutex<AppState>>();
    let mut guard = state.lock().await;
    // 成否によらずここまで来たら「読み込み完了」扱いにする(issue #218:
    // 観測・走査が失敗しても`pc_data_loaded`が永久に`false`のままにならない
    // ようにする。失敗の詳細はこの後の`?`で呼び出し元へ伝わり、既存の
    // fail-safe・ログ出力(`reconcile_and_save_git_ledger`/
    // `build_and_report_user_sessions`)に委ねる)。
    guard.pc_data_loaded = true;

    let (new_ledger, new_sessions) = spawn_result
        .map_err(|_| app::AppError::Io("バックグラウンド処理に失敗しました".to_string()))?;
    guard.git_ledger = new_ledger;
    guard.user_sessions = new_sessions?;
    Ok(())
}

/// ハブの「再読み込み」操作から呼ぶ想定(issue #193/#197)。明示操作のため
/// 同期応答のままでよい(issue #212の注記)。実体は
/// `reload_git_ledger_and_sessions` を共有する。
///
/// 手動実行中も「読み込み中」を表示できるよう(issue #245)、開始時に
/// `pc_data_loaded` を`false`へ戻して`pc:data_loading`を発火し、完了時は
/// 成否によらず(`reload_git_ledger_and_sessions`が`true`に戻す。issue #218の
/// 「永久loading防止」の保証を維持)`pc:data_loaded`を発火する。起動時の
/// バックグラウンド読み込み(`start_pc_data_background_load`)の挙動は
/// 変えない。イベントはロックを離してから発火する(native.md §2)。
#[tauri::command]
async fn reconcile_git_state(app: tauri::AppHandle) -> Result<(), AppErrorDto> {
    {
        let state = app.state::<Mutex<AppState>>();
        state.lock().await.pc_data_loaded = false;
    }
    let _ = app.emit("pc:data_loading", ());

    let result = reload_git_ledger_and_sessions(&app).await;
    let _ = app.emit("pc:data_loaded", ());
    result.map_err(Into::into)
}

/// 指定ラベルのウィンドウを前面化する(最小化されていれば復元してから)。
/// 存在しないラベルは `not_found`(ハブ化 その1。issue #83)。
#[tauri::command]
async fn focus_window(app: tauri::AppHandle, label: String) -> Result<(), AppErrorDto> {
    let window = app.get_webview_window(&label).ok_or_else(|| {
        AppErrorDto::from(app::AppError::NotFound(
            "指定されたウィンドウが見つかりません".to_string(),
        ))
    })?;
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.set_focus();
    Ok(())
}

/// `hub-layout.json` の保存先パスを解決する。`settings.json` と同じ
/// `app_data_dir()` 配下に置く(native.md §2)が、`AppState` には持たせない
/// (issue #121。プロファイル非依存かつ設定本体のマイグレーション履歴を
/// 汚さないための独立ファイル)。
fn hub_layout_path(app: &tauri::AppHandle) -> Result<PathBuf, AppErrorDto> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("hub-layout.json"))
        .map_err(|e| AppErrorDto::from(app::AppError::Io(e.to_string())))
}

/// `hub-tuning.json` の保存先パスを解決する(issue #249)。`hub-layout.json`
/// と同じく `app_data_dir()` 配下の独立ファイルで、`AppState` には持たせない。
fn hub_tuning_path(app: &tauri::AppHandle) -> Result<PathBuf, AppErrorDto> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("hub-tuning.json"))
        .map_err(|e| AppErrorDto::from(app::AppError::Io(e.to_string())))
}

/// ハブグラフの調整値を返す(issue #249)。ファイルが無い/壊れている場合は
/// 既定値(`HubTuningStore` 実装のフォールバック)。
#[tauri::command]
async fn get_hub_tuning(app: tauri::AppHandle) -> Result<HubTuningDto, AppErrorDto> {
    let path = hub_tuning_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<HubTuningDto, app::AppError> {
        let store = FileHubTuningStore::new(path);
        Ok(app::load_hub_tuning(&store)?.into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// ハブグラフの調整値を保存する(issue #249)。フロントがデバウンスして
/// 呼ぶ。
#[tauri::command]
async fn save_hub_tuning(app: tauri::AppHandle, tuning: HubTuningDto) -> Result<(), AppErrorDto> {
    let path = hub_tuning_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let store = FileHubTuningStore::new(path);
        app::save_hub_tuning(&store, tuning.into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// ハブグラフのノード位置(ドラッグ固定)を返す(issue #121)。プロファイル
/// 非依存のためステートレスに解決する(`get_claude_settings_file` と同じ
/// パターン)。
#[tauri::command]
async fn get_hub_layout(app: tauri::AppHandle) -> Result<HubLayoutDto, AppErrorDto> {
    let path = hub_layout_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<HubLayoutDto, app::AppError> {
        let store = FileHubLayoutStore::new(path);
        let layout = app::load_hub_layout(&store)?;
        Ok(layout.into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// ハブグラフのノード位置を丸ごと置き換えて保存する(issue #121)。マージ
/// ではなく置き換えなので、呼び出し側は現在有効な全ノード分の位置を渡す
/// こと(存在しないノードの残骸は自然に消える)。
#[tauri::command]
async fn save_hub_layout(
    app: tauri::AppHandle,
    positions: std::collections::HashMap<String, NodePositionDto>,
) -> Result<(), AppErrorDto> {
    let path = hub_layout_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let store = FileHubLayoutStore::new(path);
        let positions = positions
            .into_iter()
            .map(|(key, position)| (key, position.into()))
            .collect();
        app::save_hub_layout(&store, positions)
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

/// `~/.claude/CLAUDE.md`(ユーザーレベルのメモリ)を読む(/claude 画面の
/// CLAUDE.mdタブ)。対象ディレクトリはRust側で `~/.claude` に固定解決し、
/// フロントからパスは受け取らない(native.md §4)。読み書きはリポジトリ直下の
/// CLAUDE.mdと同じ `FileClaudeMdStore`・楽観ロック(`app::save_claude_md`)を使う。
#[tauri::command]
async fn get_user_claude_md() -> Result<ClaudeMdDto, AppErrorDto> {
    tauri::async_runtime::spawn_blocking(|| -> Result<ClaudeMdDto, app::AppError> {
        let claude_dir = infra::claude_home_dir()?;
        let store = FileClaudeMdStore::new();
        let file = app::read_claude_md(&store, &claude_dir)?;
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
async fn save_user_claude_md(
    content: String,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppErrorDto> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), app::AppError> {
        let claude_dir = infra::claude_home_dir()?;
        let store = FileClaudeMdStore::new();
        app::save_claude_md(&store, &claude_dir, &content, expected_modified_at_ms)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// `~/.claude` 配下の `path`(`~/.claude` からの相対パス。区切りは `/`、
/// 空文字列はルート)直下のエントリを一覧する(/claude 画面のExplorerタブ。
/// 表示専用)。パス形式の検証は `app::list_claude_dir`、リンク経由での
/// `~/.claude` 外への逸脱の検出は `FileClaudeDirStore` が行う(native.md §4)。
#[tauri::command]
async fn list_claude_dir(
    path: String,
    offset: usize,
    limit: usize,
) -> Result<ClaudeDirPageDto, AppErrorDto> {
    tauri::async_runtime::spawn_blocking(move || -> Result<ClaudeDirPageDto, app::AppError> {
        let store = FileClaudeDirStore::new(infra::claude_home_dir()?);
        let page = app::list_claude_dir(&store, &path, offset, limit)?;
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
    let app_data_dir = app.path().app_data_dir()?;
    let save_path = app_data_dir.join("settings.json");
    let git_ledger_path = app_data_dir.join("git-ledger.json");
    let state::LoadResult {
        state,
        recovered_from_corruption,
    } = AppState::load(save_path, git_ledger_path)?;
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

/// 起動直後は settings 読み込み・Pc 組み立てのみを同期で行い(`AppState::
/// load`)、Git状態の観測(gitサブプロセス実行)・全プロジェクトのjsonl走査
/// (`list_parsed_sessions`)はこのバックグラウンドタスクへ遅延させる
/// (issue #212: 初回表示のラグ解消)。`.setup()` はすぐ返るため、ウィンドウは
/// これらの完了を待たずに表示される。完了時に `pc:data_loaded` を発火し、
/// ハブが `onSettingsUpdated` 等と同じ流儀で自動的に再取得する。
///
/// イベントは成否によらず発火する(issue #218)。失敗時も`AppState.
/// pc_data_loaded`は`true`になる(`reload_git_ledger_and_sessions`
/// 参照)ため、マウント中のハブの「読み込み中」表示を確実に解除する
/// (失敗の詳細はログのみで、既存のfail-safeに委ねる)。
fn start_pc_data_background_load(app: &tauri::App) {
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = reload_git_ledger_and_sessions(&app_handle).await {
            eprintln!("起動後のPCデータ読み込みに失敗しました: {e}");
        }
        let _ = app_handle.emit("pc:data_loaded", ());
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
        // ウィンドウが閉じられたら(全ウィンドウ共通のハンドラ。issue #83)
        // レジストリから自動除去する。フロント側の明示的な解除には頼らない。
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let label = window.label().to_string();
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<Mutex<AppState>>();
                    {
                        let mut guard = state.lock().await;
                        guard.window_states =
                            app::remove_window_state(&guard.window_states, &label);
                    }
                    let _ = app.emit("windows:changed", ());
                });
            }
        })
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
            report_window_state,
            list_window_states,
            focus_window,
            get_pc,
            reconcile_git_state,
            get_hub_layout,
            save_hub_layout,
            get_hub_tuning,
            save_hub_tuning,
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
            get_user_claude_md,
            save_user_claude_md,
            list_claude_dir,
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
            start_pc_data_background_load(app);
            local_api::start(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
