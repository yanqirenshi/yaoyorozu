//! app が起動したまま持つ claude CLI(実行中セッション)の Command 群(issue #391。Phase 1
//! 「1セッションを app から対話する」、issue #407。Phase 2「複数・新規作成・モード切替・画面ごとの
//! 購読」)。native.md §1 のとおり、ここは薄い層:引数の変換 → ユースケース(`app`)の呼び出し →
//! DTO 化。状態遷移・起動の可否の規則は domain / app にある。
//!
//! - 実行中セッションは**複数**持てる。対象は `RunningSessionRefDto`(pid_domain + pid +
//!   started_at)で指定する。
//! - 途中経過(テキストの断片・ツールの開始など)は **Channel**(`AddressedProgressDto`)で流す。
//!   Channel は起動した画面にしか届かないため、**画面ごとに購読する**
//!   (`subscribe_running_session_progress`)。再読み込み・別ウィンドウでも購読し直せる。購読が無い
//!   間の出来事は捨ててよい(状態・答え待ちの問い合わせは Query で取れる)。
//! - 状態変化・権限の問い合わせの到着は**軽量イベント** `running-session:changed`(宛先付き)で
//!   知らせ、データ本体はフロントが `get_running_session` / `list_running_sessions` で取り直す
//!   (native.md §3.2)。
//! - ロック(`AppState`)の中でファイル I/O・子プロセスへの書き込み・`emit` をしない(§2)。
//!   状態を先に動かし、ロックを外してから書き込む(`app::begin_*` の説明)。
//! - フロントから cwd やパスは受け取らない(§4)。cwd・リポジトリは会話ファイル・プロファイルから
//!   app が求める。

use crate::dto::{
    AddressedProgressDto, AppErrorDto, AppWarningEventDto, PermissionBehaviorDto,
    PermissionSuggestionDto, RunningSessionChangedEventDto, RunningSessionDto,
    RunningSessionRefDto, RunningSessionSummaryDto, RunningSessionSwitchDto,
    StartRunningSessionDto, WorktreeSpecDto,
};
use crate::state::{
    resolve_effective_projects_dir, AppState, ProgressSubscriber, RunningSessionSlot,
};
use app::{
    AddressedRunningSessionEvent, AppError, PermissionDecision, RunningSessionEvent,
    RunningSessionEventSink, RunningSessionRef,
};
use domain::{PermissionSuggestion, ProcessState, RunningSessionByApp};
use infra::{
    ClaudeCliProcessLauncher, FileArchivedSessionsStore, FileRestorableRunningSessionsStore,
    FileRunningSessionSource, FileSystemRepository,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, Mutex};

/// 実行中セッションの状態が変わった・権限の問い合わせが届いた/決着したことの通知。
pub const RUNNING_SESSION_CHANGED_EVENT: &str = "running-session:changed";

/// 画面に出す軽い警告(復元できなかったセッションの理由など。native.md §3.2)。
pub const APP_WARNING_EVENT: &str = "app:warning";

/// 前回動かしていた実行中セッションの控え(issue #459)。`app_data_dir` 直下に置く。
fn restorable_running_sessions_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app_handle
        .path()
        .app_data_dir()
        .map(|dir| dir.join("running-sessions.json"))
        .map_err(|e| AppError::Io(e.to_string()))
}

/// アーカイブ済みのセッション ID の集合(issue #494)。`app_data_dir` 直下に置く。`lib.rs` の
/// `list_sessions` / `get_pc` command も、`archived: bool` を差し込むためにこの場所を使う。
pub(crate) fn archived_sessions_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app_handle
        .path()
        .app_data_dir()
        .map(|dir| dir.join("archived-sessions.json"))
        .map_err(|e| AppError::Io(e.to_string()))
}

/// 控えの読み書きは小さなファイル I/O なので、ロックを持たないところでブロッキングスレッドへ
/// 逃がして行う(native.md §2)。失敗しても起動・停止は続ける(控えは便宜であり、次の保存で
/// 直るため)。理由はログにだけ残す。
async fn with_restorable_store<F>(app_handle: &tauri::AppHandle, what: &'static str, change: F)
where
    F: FnOnce(&FileRestorableRunningSessionsStore) -> Result<(), AppError> + Send + 'static,
{
    let path = match restorable_running_sessions_path(app_handle) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("{what}に失敗しました: {e}");
            return;
        }
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        change(&FileRestorableRunningSessionsStore::new(path))
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()));
    if let Err(e) = result {
        eprintln!("{what}に失敗しました: {e}");
    }
}

/// [`with_restorable_store`] のアーカイブ版(issue #494)。失敗はログにだけ残し、呼び出し側へは
/// 伝えない(ついでの処理向け。利用者が明示的に起動した `archive_session` / `unarchive_session`
/// command 自体は、永続化の失敗を握りつぶさず呼び出し側へ返す。native.md §3.1。
/// [`try_with_archived_sessions_store`] を使うこと)。
async fn with_archived_sessions_store<F>(
    app_handle: &tauri::AppHandle,
    what: &'static str,
    change: F,
) where
    F: FnOnce(&FileArchivedSessionsStore) -> Result<(), AppError> + Send + 'static,
{
    if let Err(e) = try_with_archived_sessions_store(app_handle, change).await {
        eprintln!("{what}に失敗しました: {}", e.message);
    }
}

/// アーカイブの印の読み書き(issue #494)。失敗は呼び出し側へそのまま返す(native.md §3.1
/// 「永続化の失敗はエラーを返す。握りつぶさない」)。利用者の操作で直接呼ばれる
/// `archive_session` / `unarchive_session` command が使う。
async fn try_with_archived_sessions_store<F>(
    app_handle: &tauri::AppHandle,
    change: F,
) -> Result<(), AppErrorDto>
where
    F: FnOnce(&FileArchivedSessionsStore) -> Result<(), AppError> + Send + 'static,
{
    let path = archived_sessions_path(app_handle)?;
    tauri::async_runtime::spawn_blocking(move || change(&FileArchivedSessionsStore::new(path)))
        .await
        .unwrap_or_else(|_| Err(background_failed()))
        .map_err(Into::into)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn not_running() -> AppErrorDto {
    AppError::NotFound(
        "実行中のセッションが見つかりません(すでに忘れられたか、まだ開始していません)".to_string(),
    )
    .into()
}

fn background_failed() -> AppError {
    AppError::Io("バックグラウンド処理に失敗しました".to_string())
}

/// 読み取りスレッドから、順序を保ったまま tauri 層の処理タスクへ出来事を渡す受け口。
struct ChannelSink(mpsc::UnboundedSender<RunningSessionEvent>);

impl RunningSessionEventSink for ChannelSink {
    fn emit(&self, event: RunningSessionEvent) {
        // 受け側(処理タスク)が終わっていれば捨てる。
        let _ = self.0.send(event);
    }
}

fn find_slot<'a>(
    state: &'a AppState,
    target: &RunningSessionRef,
) -> Option<&'a RunningSessionSlot> {
    state
        .running_sessions
        .iter()
        .find(|slot| target.matches(&slot.session))
}

fn find_slot_mut<'a>(
    state: &'a mut AppState,
    target: &RunningSessionRef,
) -> Option<&'a mut RunningSessionSlot> {
    state
        .running_sessions
        .iter_mut()
        .find(|slot| target.matches(&slot.session))
}

fn changed_event(
    session: &RunningSessionByApp,
    exit_code: Option<i32>,
) -> RunningSessionChangedEventDto {
    RunningSessionChangedEventDto {
        target: RunningSessionRef::of(session).into(),
        session_id: session.base.session_id.clone(),
        process_state: session.process_state.into(),
        pending_permission_count: session.permission_requests.len(),
        exit_code,
    }
}

/// 状態の変化を見るための要約(状態・答え待ちの数・現在のモデルと権限モード)。
fn watched(session: &RunningSessionByApp) -> (ProcessState, usize, Option<String>, Option<String>) {
    (
        session.process_state,
        session.permission_requests.len(),
        session.current_model.clone(),
        session.current_permission_mode.clone(),
    )
}

/// 起動した子プロセス1つ(`target`)の出来事を、順に処理する。途中経過は購読中の画面の Channel へ
/// 宛先付きで流し、状態を動かす出来事は `AppState` へ反映して軽量イベントで知らせる。
/// `Exited` で終わる。
fn spawn_event_loop(
    app_handle: tauri::AppHandle,
    target: RunningSessionRef,
    // 控え(issue #459)の更新に使う会話の ID。宛先(PID の組)からは引けないため別に渡す。
    session_id: String,
    mut rx: mpsc::UnboundedReceiver<RunningSessionEvent>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let addressed = AddressedRunningSessionEvent {
                target: target.clone(),
                event,
            };
            let exit_code = match &addressed.event {
                RunningSessionEvent::Exited { exit_code, .. } => *exit_code,
                _ => None,
            };
            if let RunningSessionEvent::Exited { stderr_tail, .. } = &addressed.event {
                if !stderr_tail.is_empty() {
                    // 起動失敗などの手がかり(正常系では何も出ない)。秘匿値は含まれない想定だが、
                    // 画面には出さずログにだけ残す。
                    eprintln!("実行中セッション(claude)が終了しました。標準エラー: {stderr_tail}");
                }
            }

            let (notify, subscribers) = {
                let state = app_handle.state::<Mutex<AppState>>();
                let mut guard = state.lock().await;
                match find_slot_mut(&mut guard, &target) {
                    Some(slot) => {
                        let before = watched(&slot.session);
                        app::apply_running_session_event(
                            &mut slot.session,
                            &addressed.event,
                            now_ms(),
                        );
                        // 選べるモデルの一覧が届いたら、画面が取り直せるよう知らせる。
                        let models_listed = match &addressed.event {
                            RunningSessionEvent::ModelsListed(models) => {
                                slot.available_models = models.clone();
                                true
                            }
                            _ => false,
                        };
                        let changed = before != watched(&slot.session)
                            || exit_code.is_some()
                            || models_listed;
                        let subscribers = if addressed.as_progress().is_some() {
                            slot.subscribers.clone()
                        } else {
                            Vec::new()
                        };
                        if matches!(addressed.event, RunningSessionEvent::Exited { .. }) {
                            slot.subscribers.clear();
                        }
                        (
                            changed.then(|| changed_event(&slot.session, exit_code)),
                            subscribers,
                        )
                    }
                    None => (None, Vec::new()),
                }
            };

            // 途中経過を、購読中の画面へ流す(ロックの外)。送れなくなった購読は取り除く。
            if let Some(progress) = addressed.as_progress() {
                let dto = AddressedProgressDto::from(progress);
                let failed: Vec<u64> = subscribers
                    .iter()
                    .filter(|subscriber| subscriber.channel.send(dto.clone()).is_err())
                    .map(|subscriber| subscriber.id)
                    .collect();
                if !failed.is_empty() {
                    let state = app_handle.state::<Mutex<AppState>>();
                    let mut guard = state.lock().await;
                    if let Some(slot) = find_slot_mut(&mut guard, &target) {
                        slot.subscribers.retain(|s| !failed.contains(&s.id));
                    }
                }
            }
            if let Some(payload) = notify {
                let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);
            }
            // 切り替えが CLI に受け入れられたら、控えも現在の値にしておく(issue #459)。
            // `Configured`(`system/init` の報告)では更新しない: モデルは実際のモデル名で届き、
            // 別名として覚えられないため(起動時に選んだ別名を保つ)。
            if let RunningSessionEvent::SwitchApplied(switch) = &addressed.event {
                let switch = switch.clone();
                let session_id = session_id.clone();
                with_restorable_store(
                    &app_handle,
                    "実行中セッションの控えの更新",
                    move |store| app::remember_running_session_switch(store, &session_id, &switch),
                )
                .await;
            }
            if matches!(addressed.event, RunningSessionEvent::Exited { .. }) {
                break;
            }
        }
    });
}

/// 起動する worktree を用意する(必要なら作り、起動前に最新化する。issue #437)。用意できたら、
/// 新しい worktree を Git 台帳へ反映してから、その `worktree_id` を引く(台帳の ID は反映で採番される)。
/// `spec` が `None` なら何もしない(再開で worktree を指定しないとき)。失敗(競合・ネットワーク・
/// 不正な指定)は、起動しないでそのまま返す。
async fn prepare_start_worktree(
    app_handle: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<AppState>>,
    repository: Option<&std::path::Path>,
    spec: Option<app::WorktreeSpec>,
    sync: bool,
) -> Result<(Option<app::ResolvedWorktree>, app::WorktreeIndex), AppError> {
    let Some(repository) = repository else {
        return match spec {
            Some(_) => Err(AppError::InvalidInput(
                "プロファイルにリポジトリが設定されていません".to_string(),
            )),
            None => Ok((None, app::WorktreeIndex::default())),
        };
    };
    let ledger = state.lock().await.git_ledger.clone();
    let index = app::WorktreeIndex::from_ledger(&ledger, repository);
    let Some(spec) = spec else {
        return Ok((None, index));
    };

    let repo = repository.to_path_buf();
    let index_for_task = index.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        app::prepare_worktree(
            &infra::SystemGitWorktreeManager::new(),
            &repo,
            &spec,
            &index_for_task,
            sync,
        )
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()))?;

    // 新しく作った(または台帳が知らない)worktree は、台帳へ反映して ID を得る。
    let index = if prepared.is_main || index.knows(&prepared.path) {
        index
    } else {
        crate::reload_git_ledger(app_handle).await?;
        let ledger = state.lock().await.git_ledger.clone();
        app::WorktreeIndex::from_ledger(&ledger, repository)
    };
    let worktree_id = index.id_of(&prepared.path);
    Ok((
        Some(app::ResolvedWorktree {
            path: prepared.path,
            worktree_id,
        }),
        index,
    ))
}

/// 実行中セッションを起動する。`Resume` は既存の会話を `--resume` で、`New` は新しい会話を
/// `--session-id`(app が決めた UUID v4)で開く。同じ会話の二重起動と上限
/// (`app::MAX_RUNNING_SESSIONS`)は `session_busy`。`profile_id` は対象プロファイルの解決に使う
/// (省略時はアクティブなプロファイル)。途中経過は起動後に `subscribe_running_session_progress` で
/// 購読する(起動の前後で出来事を取りこぼしても、状態は Query で取れる)。
#[tauri::command]
pub async fn start_running_session(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: Option<String>,
    request: StartRunningSessionDto,
) -> Result<RunningSessionDto, AppErrorDto> {
    // 会話の ID(再開は指定された ID、新規は app が決める)。
    let session_id = match &request {
        StartRunningSessionDto::Resume { session_id, .. } => session_id.clone(),
        StartRunningSessionDto::New { .. } => app::new_session_id(),
    };

    // 起動してよいかを見て、起動の最中の印を付ける(起動は数秒かかりうるので、その間に来る同じ会話・
    // 上限超えの起動を止める)。
    let (settings, running, starting) = {
        let mut guard = state.lock().await;
        let running: Vec<RunningSessionByApp> = guard
            .running_sessions
            .iter()
            .map(|slot| slot.session.clone())
            .collect();
        let starting = guard.starting_session_ids.clone();
        app::ensure_can_start(&running, &starting, &session_id)?;
        guard.starting_session_ids.push(session_id.clone());
        (guard.settings.clone(), running, starting)
    };
    // 起動の最中の印を外す(成功・失敗のどちらでも)。
    let release = |guard: &mut AppState| {
        guard.starting_session_ids.retain(|id| id != &session_id);
    };

    type PreparedStart = (Option<std::path::PathBuf>, std::path::PathBuf, String);
    let prepared = (|| -> Result<PreparedStart, AppError> {
        let profile = app::resolve_profile(&settings, profile_id.as_deref())?;
        let resolved_profile_id = profile.id.clone();
        let repository = match &request {
            StartRunningSessionDto::Resume { .. } => profile.repository_path.clone(),
            // 新規は、プロファイルのリポジトリが cwd になる(未設定なら InvalidInput)。
            StartRunningSessionDto::New { .. } => Some(app::resolve_repository_dir(
                &settings,
                profile_id.as_deref(),
            )?),
        };
        Ok((
            repository,
            resolve_effective_projects_dir(&settings)?,
            resolved_profile_id,
        ))
    })();
    let (repository, root, resolved_profile_id) = match prepared {
        Ok(prepared) => prepared,
        Err(e) => {
            release(&mut *state.lock().await);
            return Err(e.into());
        }
    };

    // 起動する worktree(新規の既定はリポジトリ本体。再開で指定が無ければ、会話ファイルの cwd)。
    let (spec, sync) = match &request {
        StartRunningSessionDto::Resume {
            worktree,
            sync_origin_main,
            ..
        } => (
            worktree.clone().map(app::WorktreeSpec::from),
            sync_origin_main.unwrap_or(true),
        ),
        StartRunningSessionDto::New {
            worktree,
            sync_origin_main,
            ..
        } => (
            Some(
                worktree
                    .clone()
                    .map(app::WorktreeSpec::from)
                    .unwrap_or(app::WorktreeSpec::Main),
            ),
            sync_origin_main.unwrap_or(true),
        ),
    };
    let (worktree, worktree_index) = match prepare_start_worktree(
        &app_handle,
        &state,
        repository.as_deref(),
        spec,
        sync,
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(e) => {
            release(&mut *state.lock().await);
            return Err(e.into());
        }
    };

    let (tx, rx) = mpsc::unbounded_channel();
    let sink: Arc<dyn RunningSessionEventSink> = Arc::new(ChannelSink(tx));
    let resumed_project = match &request {
        StartRunningSessionDto::Resume { project, .. } => Some(project.clone()),
        StartRunningSessionDto::New { .. } => None,
    };
    // 起動(再開)したら自動でアーカイブの印を外す(issue #494。開いて使い始めた = 戻した、と
    // 見なす。新規作成はアーカイブされているはずがないので対象外)。
    let is_resume = matches!(request, StartRunningSessionDto::Resume { .. });
    // 起動のときに選んだモデルの別名(控えに覚える値。issue #459)。`system/init` が報告する
    // 実際のモデル名ではなく、この別名を覚える。
    let start_model: Option<app::StartModel> = match &request {
        StartRunningSessionDto::Resume { model, .. }
        | StartRunningSessionDto::New { model, .. } => model.map(Into::into),
    };
    let session_id_for_task = session_id.clone();
    // claude の起動は数秒かかりうるため、async ランタイムを塞がないようブロッキングスレッドで行う。
    let started = tauri::async_runtime::spawn_blocking(
        move || -> Result<app::StartedRunningSession, AppError> {
            let launcher = ClaudeCliProcessLauncher::new();
            match request {
                StartRunningSessionDto::Resume {
                    project,
                    session_id,
                    mode,
                    name,
                    model,
                    ..
                } => {
                    let source = FileSystemRepository::new(root);
                    let ledger = FileRunningSessionSource::new(
                        FileRunningSessionSource::default_sessions_dir()?,
                    );
                    app::resume_running_session(
                        &source,
                        &launcher,
                        &ledger,
                        &running,
                        &starting,
                        &app::ResumeRunningSession {
                            project,
                            session_id,
                            mode: mode.into(),
                            repository_path: repository,
                            name,
                            model: model.map(Into::into),
                            worktree,
                            worktree_index,
                        },
                        sink,
                        now_ms(),
                    )
                }
                StartRunningSessionDto::New {
                    mode, name, model, ..
                } => {
                    let repository_path = repository.ok_or_else(|| {
                        AppError::InvalidInput(
                            "プロファイルにリポジトリが設定されていません".to_string(),
                        )
                    })?;
                    let ledger = FileRunningSessionSource::new(
                        FileRunningSessionSource::default_sessions_dir()?,
                    );
                    app::create_running_session(
                        &launcher,
                        &ledger,
                        &running,
                        &starting,
                        &app::CreateRunningSession {
                            repository_path,
                            mode: mode.into(),
                            name,
                            model: model.map(Into::into),
                            worktree: worktree.ok_or_else(|| {
                                AppError::InvalidInput(
                                    "起動する worktree が決まりません".to_string(),
                                )
                            })?,
                        },
                        session_id_for_task,
                        sink,
                        now_ms(),
                    )
                }
            }
        },
    )
    .await
    .unwrap_or_else(|_| Err(background_failed()));

    let started = match started {
        Ok(started) => started,
        Err(e) => {
            release(&mut *state.lock().await);
            return Err(e.into());
        }
    };

    let target = RunningSessionRef::of(&started.session);
    let remembered_project = resumed_project.clone();
    let (dto, payload, remembered) = {
        let mut guard = state.lock().await;
        release(&mut guard);
        // 同じ会話の終了済みは置き換え、終了済みが増えすぎないよう古いものを忘れる。
        let current: Vec<RunningSessionByApp> = guard
            .running_sessions
            .iter()
            .map(|slot| slot.session.clone())
            .collect();
        for gone in app::exited_to_forget(&current, &session_id) {
            guard
                .running_sessions
                .retain(|slot| !gone.matches(&slot.session));
        }
        let slot = RunningSessionSlot {
            project: resumed_project,
            session: started.session,
            process: started.process,
            available_models: Vec::new(),
            subscribers: Vec::new(),
        };
        let dto = RunningSessionDto::from_session(
            slot.project.as_deref(),
            slot.session.clone(),
            slot.available_models.clone(),
        );
        let payload = changed_event(&slot.session, None);
        let remembered = slot.session.clone();
        guard.running_sessions.push(slot);
        (dto, payload, remembered)
    };
    spawn_event_loop(app_handle.clone(), target, session_id.clone(), rx);
    let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);

    // 次の app の起動で再開できるよう、指定を覚える(issue #459。ロックの外で書く)。
    let project = remembered_project;
    with_restorable_store(
        &app_handle,
        "実行中セッションの控えの保存",
        move |store| {
            app::remember_running_session(
                store,
                &remembered,
                &resolved_profile_id,
                project.as_deref(),
                start_model,
            )
        },
    )
    .await;
    if is_resume {
        // 起動(再開)の「ついで」の処理(issue #494)。失敗しても起動自体は成功のまま返す
        // (利用者が明示的に起動した `archive_session`/`unarchive_session` command と違い、
        // 印を外せなかったからといって再開を失敗扱いにする理由がないため。ログにだけ残す)。
        let sid = session_id.clone();
        with_archived_sessions_store(&app_handle, "アーカイブの印の解除", move |store| {
            app::unarchive_session(store, &sid)
        })
        .await;
    }
    Ok(dto)
}

/// app が起動している実行中セッションの一覧(終了済みで残っているものを含む。起動が古い順)。
/// ハブなどが並べる項目で、答え待ちの問い合わせは数だけ(中身は `get_running_session`)。
#[tauri::command]
pub async fn list_running_sessions(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Vec<RunningSessionSummaryDto>, AppErrorDto> {
    let guard = state.lock().await;
    let mut summaries: Vec<app::RunningSessionSummary> = guard
        .running_sessions
        .iter()
        .map(|slot| app::summarize(&slot.session))
        .collect();
    summaries.sort_by_key(|s| s.target.started_at);
    Ok(summaries.into_iter().map(Into::into).collect())
}

/// 実行中セッション1つの現在の状態(答え待ちの問い合わせを含む)。無ければ `None`。
#[tauri::command]
pub async fn get_running_session(
    state: tauri::State<'_, Mutex<AppState>>,
    target: RunningSessionRefDto,
) -> Result<Option<RunningSessionDto>, AppErrorDto> {
    let target: RunningSessionRef = target.into();
    let guard = state.lock().await;
    Ok(find_slot(&guard, &target).map(|slot| {
        RunningSessionDto::from_session(
            slot.project.as_deref(),
            slot.session.clone(),
            slot.available_models.clone(),
        )
    }))
}

/// 実行中セッションの途中経過を、この画面(`on_progress`)へ流し始める。購読 ID を返す。
/// 画面ごとに購読するので、再読み込み・別ウィンドウ・複数の画面から購読し直せる。購読が無い間の
/// 出来事は捨てる。送れなくなった(画面が閉じた)購読は自動で外れる。
#[tauri::command]
pub async fn subscribe_running_session_progress(
    state: tauri::State<'_, Mutex<AppState>>,
    target: RunningSessionRefDto,
    on_progress: Channel<AddressedProgressDto>,
) -> Result<u64, AppErrorDto> {
    let target: RunningSessionRef = target.into();
    let mut guard = state.lock().await;
    let id = guard.next_progress_subscription_id;
    let slot = find_slot_mut(&mut guard, &target).ok_or_else(not_running)?;
    slot.subscribers.push(ProgressSubscriber {
        id,
        channel: on_progress,
    });
    guard.next_progress_subscription_id += 1;
    Ok(id)
}

/// 途中経過の購読をやめる(画面を閉じる・別の会話に切り替えるとき)。無い購読 ID は何もしない。
#[tauri::command]
pub async fn unsubscribe_running_session_progress(
    state: tauri::State<'_, Mutex<AppState>>,
    subscription_id: u64,
) -> Result<(), AppErrorDto> {
    let mut guard = state.lock().await;
    for slot in &mut guard.running_sessions {
        slot.subscribers.retain(|s| s.id != subscription_id);
    }
    Ok(())
}

/// 実行中セッションへ user メッセージ(本文と画像)を送る。
#[tauri::command]
pub async fn send_to_running_session(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    target: RunningSessionRefDto,
    text: String,
    images: Vec<String>,
) -> Result<(), AppErrorDto> {
    let target: RunningSessionRef = target.into();
    // 状態を先に動かす(ロックの中。書き込みはロックの外)。
    let (process, validated, payload) = {
        let mut guard = state.lock().await;
        let slot = find_slot_mut(&mut guard, &target).ok_or_else(not_running)?;
        let validated =
            app::begin_send_to_running_session(&mut slot.session, &text, &images, now_ms())?;
        (
            slot.process.clone(),
            validated,
            changed_event(&slot.session, None),
        )
    };
    let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);

    tauri::async_runtime::spawn_blocking(move || {
        app::write_user_message(process.as_ref(), &text, &validated)
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()))
    .map_err(Into::into)
}

/// 権限の問い合わせに答える。許可(`allow`)は `updated_input`(書き換えた入力。省略で問い合わせの
/// 入力のまま)と `updated_permissions`(「今後も許可」にする提案。問い合わせの `suggestions` から
/// 選んだもの)を、拒否(`deny`)は `message` を添えられる。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn respond_permission(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    target: RunningSessionRefDto,
    request_id: String,
    behavior: PermissionBehaviorDto,
    updated_input: Option<serde_json::Value>,
    updated_permissions: Option<Vec<PermissionSuggestionDto>>,
    message: Option<String>,
) -> Result<(), AppErrorDto> {
    let target: RunningSessionRef = target.into();
    let decision = match behavior {
        PermissionBehaviorDto::Allow => PermissionDecision::Allow {
            updated_input,
            updated_permissions: updated_permissions.map(|list| {
                serde_json::Value::Array(
                    list.into_iter()
                        .map(|dto| PermissionSuggestion::from(dto).to_update_value())
                        .collect(),
                )
            }),
        },
        PermissionBehaviorDto::Deny => PermissionDecision::Deny { message },
    };

    let (process, response, payload) = {
        let mut guard = state.lock().await;
        let slot = find_slot_mut(&mut guard, &target).ok_or_else(not_running)?;
        let response =
            app::begin_respond_permission(&mut slot.session, &request_id, decision, now_ms())?;
        (
            slot.process.clone(),
            response,
            changed_event(&slot.session, None),
        )
    };
    let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);

    tauri::async_runtime::spawn_blocking(move || {
        app::write_permission_response(process.as_ref(), &response)
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()))
    .map_err(Into::into)
}

/// 生成中(権限待ちを含む)の中断を要求する。プロセスは生きたまま、次の入力を送れる。
#[tauri::command]
pub async fn interrupt_running_session(
    state: tauri::State<'_, Mutex<AppState>>,
    target: RunningSessionRefDto,
) -> Result<(), AppErrorDto> {
    let target: RunningSessionRef = target.into();
    let (snapshot, process) = {
        let guard = state.lock().await;
        let slot = find_slot(&guard, &target).ok_or_else(not_running)?;
        (slot.session.clone(), slot.process.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        app::interrupt_running_session(&snapshot, process.as_ref())
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()))
    .map_err(Into::into)
}

/// 起動中に、モデル・権限モードを切り替える(`set_model` / `set_permission_mode`)。結果(現在の
/// モデル・権限モード)は CLI が受け入れたとき(応答)に反映され、`running-session:changed` で
/// 知らせる。要求しただけでは現在値を変えない(画面は状態を取り直して表示する)。
#[tauri::command]
pub async fn switch_running_session(
    state: tauri::State<'_, Mutex<AppState>>,
    target: RunningSessionRefDto,
    switch: RunningSessionSwitchDto,
) -> Result<(), AppErrorDto> {
    let target: RunningSessionRef = target.into();
    let switch: app::RunningSessionSwitch = switch.into();
    let process = {
        let guard = state.lock().await;
        let slot = find_slot(&guard, &target).ok_or_else(not_running)?;
        app::begin_switch_running_session(&slot.session, &switch)?;
        slot.process.clone()
    };
    tauri::async_runtime::spawn_blocking(move || app::write_switch(process.as_ref(), &switch))
        .await
        .unwrap_or_else(|_| Err(background_failed()))
        .map_err(Into::into)
}

/// 実行中セッションを止める(標準入力を閉じて終了を待つ。約1秒)。終了済みなら何もしない。
/// 対象が見つからなければ `not_found`。
#[tauri::command]
pub async fn stop_running_session(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    target: RunningSessionRefDto,
) -> Result<(), AppErrorDto> {
    let target: RunningSessionRef = target.into();
    let (mut snapshot, process) = {
        let guard = state.lock().await;
        let slot = find_slot(&guard, &target).ok_or_else(not_running)?;
        (slot.session.clone(), slot.process.clone())
    };
    // 利用者が止めたものは、次の app の起動で再開しない(issue #459)。すでに終了していても
    // (CLI が自分で終わったあとに利用者が「終了」を押した場合)控えからは外す。
    let stopped_session_id = snapshot.base.session_id.clone();
    with_restorable_store(
        &app_handle,
        "実行中セッションの控えからの削除",
        move |store| app::forget_running_session(store, &stopped_session_id),
    )
    .await;
    if snapshot.process_state == ProcessState::Exited {
        return Ok(());
    }
    // 停止は最大で数秒かかる(応答が無ければ強制終了)。ロックの外・ブロッキングスレッドで行う。
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        app::stop_running_session(&mut snapshot, process.as_ref(), now_ms());
        snapshot
    })
    .await
    .map_err(|_| background_failed())?;

    // 読み取りスレッドの `Exited` も同じ反映をするが、画面が停止直後に状態を取り直せるよう
    // ここでも終了に揃える(冪等)。
    let payload = {
        let mut guard = state.lock().await;
        find_slot_mut(&mut guard, &target).map(|slot| {
            slot.session = snapshot;
            changed_event(&slot.session, None)
        })
    };
    if let Some(payload) = payload {
        let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);
    }
    Ok(())
}

/// 会話をアーカイブする(issue #494。Desktop の「アーカイブ」を app にも入れる)。会話ファイルは
/// 消さず、印(`archived-sessions.json`)を付けるだけ。app が持つ実行中プロセス(この
/// `session_id` のもの。プロファイルをまたいで探す)があれば、印を付ける前に止める
/// (`stop_running_session` command と同じ止め方)。外部(ターミナル等)で実行中のものは
/// 止められないので、印だけ付ける。
///
/// `project` は印の対象ではなく(印はセッション ID だけで管理する)、変更後に発火する
/// `session:changed`(新しいイベントは増やさない。issue #494)の対象フォルダを知らせるためだけに
/// 使う。不正な値でも印の付与自体は失敗させず、通知だけ省く。
///
/// プロセスの停止は、印の保存に失敗しても取り消さない(済んでいてよい)。印の保存(永続化)が
/// 失敗した場合は、握りつぶさず呼び出し側へそのまま返す(native.md §3.1)。
#[tauri::command]
pub async fn archive_session(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    project: String,
    session_id: String,
) -> Result<(), AppErrorDto> {
    stop_running_sessions_for(&app_handle, &state, &session_id).await;

    try_with_archived_sessions_store(&app_handle, {
        let session_id = session_id.clone();
        move |store| app::archive_session(store, &session_id)
    })
    .await?;

    notify_session_changed(&app_handle, &project);
    Ok(())
}

/// 会話のアーカイブを解除する(issue #494)。`archive_session` の逆。
#[tauri::command]
pub async fn unarchive_session(
    app_handle: tauri::AppHandle,
    project: String,
    session_id: String,
) -> Result<(), AppErrorDto> {
    try_with_archived_sessions_store(&app_handle, move |store| {
        app::unarchive_session(store, &session_id)
    })
    .await?;

    notify_session_changed(&app_handle, &project);
    Ok(())
}

/// `session_id` に一致する、app が持つ実行中セッション(終了していないもの)を**全部**止める。
/// 同じ会話の二重起動は防いでいる(#361・#345)ため、通常は高々1件だが、プロファイルをまたいで
/// 探すために `find_slot` ではなく全走査にする。
async fn stop_running_sessions_for(
    app_handle: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<AppState>>,
    session_id: &str,
) {
    let targets: Vec<(domain::RunningSessionByApp, Arc<dyn app::RunningProcess>)> = {
        let guard = state.lock().await;
        guard
            .running_sessions
            .iter()
            .filter(|slot| {
                slot.session.base.session_id == session_id
                    && slot.session.process_state != ProcessState::Exited
            })
            .map(|slot| (slot.session.clone(), slot.process.clone()))
            .collect()
    };
    for (mut snapshot, process) in targets {
        let target = RunningSessionRef::of(&snapshot);
        let stopped = tauri::async_runtime::spawn_blocking(move || {
            app::stop_running_session(&mut snapshot, process.as_ref(), now_ms());
            snapshot
        })
        .await;
        let Ok(snapshot) = stopped else {
            eprintln!("アーカイブ前の停止に失敗しました(バックグラウンド処理の失敗)");
            continue;
        };
        let payload = {
            let mut guard = state.lock().await;
            find_slot_mut(&mut guard, &target).map(|slot| {
                slot.session = snapshot;
                changed_event(&slot.session, None)
            })
        };
        if let Some(payload) = payload {
            let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);
        }
    }
}

/// `project` が妥当な名前に見えるときだけ `session:changed` を発火する(issue #494)。
/// アーカイブ・解除はセッション ID だけで完結する操作なので、`project` は通知のための
/// ヒントに過ぎない。不正な値でアーカイブ自体を失敗させない。
fn notify_session_changed(app_handle: &tauri::AppHandle, project: &str) {
    if !domain::is_valid_project_dir_name(project) {
        return;
    }
    let _ = app_handle.emit(
        "session:changed",
        crate::dto::SessionChangedEventDto {
            project: project.to_string(),
            agent: crate::dto::AgentKindDto::ClaudeCode,
        },
    );
}

/// app の起動時に、前回動かしていた実行中セッションを順に再開する(issue #459)。ハブの初回表示を
/// 妨げないよう、`setup` からバックグラウンドで走らせる(#205 と同じ考え方)。
///
/// **順に(同時に1件ずつ)**再開する: `claude` は1つが数百 MB・起動に数秒かかるため、15 件を一度に
/// 起こすと PC が塞がる。並行させると、上限(#453)・同じ会話の二重起動・表示名の一意化(#458)の
/// 判定が互いに追い越して読みにくくなる。1件ずつなら既存の起動の道筋
/// ([`start_running_session`])をそのまま通せる(ガード・上限・名前の一意化がそのまま効く)。
///
/// 再開できなかったもの(会話ファイルが無い・worktree が無い・外部で実行中・上限)は**飛ばして
/// 次へ進み**、理由を `app:warning` とログに残す。控えからは**消さない**: 一時的な理由
/// (Desktop が同じ会話を開いている等)で消してしまうと、次の起動でもう試さなくなるため。
/// 利用者が「停止」したときだけ控えから外れる。
pub fn start_restoring_running_sessions(app_handle: &tauri::AppHandle) {
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let settings = {
            let state = app_handle.state::<Mutex<AppState>>();
            let guard = state.lock().await;
            guard.settings.clone()
        };
        let root = match resolve_effective_projects_dir(&settings) {
            Ok(root) => root,
            Err(e) => {
                eprintln!("前回の実行中セッションを再開できませんでした: {e}");
                return;
            }
        };
        let path = match restorable_running_sessions_path(&app_handle) {
            Ok(path) => path,
            Err(e) => {
                eprintln!("前回の実行中セッションの控えを読めませんでした: {e}");
                return;
            }
        };
        let archived_path = match archived_sessions_path(&app_handle) {
            Ok(path) => path,
            Err(e) => {
                eprintln!("アーカイブ済みの一覧を読めませんでした: {e}");
                return;
            }
        };
        let entries = tauri::async_runtime::spawn_blocking(move || {
            let archived =
                app::load_archived_sessions(&FileArchivedSessionsStore::new(archived_path))?;
            app::sessions_to_restore(
                &FileRestorableRunningSessionsStore::new(path),
                &settings,
                &archived,
            )
        })
        .await
        .unwrap_or_else(|_| Err(background_failed()));
        let entries = match entries {
            Ok(entries) => entries,
            Err(e) => {
                eprintln!("前回の実行中セッションの控えを読めませんでした: {e}");
                return;
            }
        };

        for entry in entries {
            let name = entry
                .name
                .clone()
                .unwrap_or_else(|| entry.session_id.clone());
            let planned = match app::plan_restore(&entry) {
                Ok(planned) => planned,
                Err(e) => {
                    warn_restore_skipped(&app_handle, &name, &e.to_string());
                    continue;
                }
            };
            // 会話ファイルが消えていたら、起こす前に飛ばす(消えた会話を `--resume` すると、
            // CLI は起動直後にエラーで終わり、利用者には「終了」だけが残って分かりにくい)。
            let checked = {
                let source = FileSystemRepository::new(root.clone());
                let planned = planned.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    app::ensure_restorable_conversation(&source, &planned)
                })
                .await
                .unwrap_or_else(|_| Err(background_failed()))
            };
            if let Err(e) = checked {
                warn_restore_skipped(&app_handle, &name, &e.to_string());
                continue;
            }

            let request = StartRunningSessionDto::Resume {
                project: planned.project,
                session_id: planned.session_id,
                mode: planned.mode.into(),
                name: planned.name,
                model: planned.model.map(Into::into),
                worktree: planned.worktree.map(WorktreeSpecDto::from),
                // 復元では origin/main の最新化をしない(利用者が選んで起動したときだけ行う。
                // 勝手にブランチを動かさない)。
                sync_origin_main: Some(false),
            };
            let state = app_handle.state::<Mutex<AppState>>();
            if let Err(e) =
                start_running_session(app_handle.clone(), state, Some(planned.profile_id), request)
                    .await
            {
                warn_restore_skipped(&app_handle, &name, &e.message);
            }
        }
    });
}

/// 復元できなかった1件を、画面(`app:warning`)とログに残す。
fn warn_restore_skipped(app_handle: &tauri::AppHandle, name: &str, reason: &str) {
    let message = format!("「{name}」を再開できませんでした: {reason}");
    eprintln!("{message}");
    let _ = app_handle.emit(APP_WARNING_EVENT, AppWarningEventDto { message });
}

/// app の終了時に、起動したままの子プロセスを**全部**止める(残さない)。ウィンドウが閉じられて
/// アプリが終了するとき(`RunEvent::Exit`)に呼ぶ。同期的に終わるまで待つ。停止は最大で数秒
/// かかるので、並行して止める(セッションの数だけ待たない)。
pub fn stop_running_session_on_exit(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<Mutex<AppState>>();
    let processes = tauri::async_runtime::block_on(async {
        let guard = state.lock().await;
        guard
            .running_sessions
            .iter()
            .filter(|slot| slot.session.process_state != ProcessState::Exited)
            .map(|slot| slot.process.clone())
            .collect::<Vec<_>>()
    });
    std::thread::scope(|scope| {
        for process in &processes {
            scope.spawn(move || process.stop());
        }
    });
}
