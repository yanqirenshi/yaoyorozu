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
    AddressedProgressDto, AppErrorDto, PermissionBehaviorDto, PermissionSuggestionDto,
    RunningSessionChangedEventDto, RunningSessionDto, RunningSessionRefDto,
    RunningSessionSummaryDto, RunningSessionSwitchDto, StartRunningSessionDto,
};
use crate::state::{
    resolve_effective_projects_dir, AppState, ProgressSubscriber, RunningSessionSlot,
};
use app::{
    AddressedRunningSessionEvent, AppError, PermissionDecision, RunningSessionEvent,
    RunningSessionEventSink, RunningSessionRef,
};
use domain::{PermissionSuggestion, ProcessState, RunningSessionByApp};
use infra::{ClaudeCliProcessLauncher, FileRunningSessionSource, FileSystemRepository};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, Mutex};

/// 実行中セッションの状態が変わった・権限の問い合わせが届いた/決着したことの通知。
pub const RUNNING_SESSION_CHANGED_EVENT: &str = "running-session:changed";

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

    let prepared = (|| -> Result<(Option<std::path::PathBuf>, std::path::PathBuf), AppError> {
        let profile = app::resolve_profile(&settings, profile_id.as_deref())?;
        let repository = match &request {
            StartRunningSessionDto::Resume { .. } => profile.repository_path.clone(),
            // 新規は、プロファイルのリポジトリが cwd になる(未設定なら InvalidInput)。
            StartRunningSessionDto::New { .. } => Some(app::resolve_repository_dir(
                &settings,
                profile_id.as_deref(),
            )?),
        };
        Ok((repository, resolve_effective_projects_dir(&settings)?))
    })();
    let (repository, root) = match prepared {
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
                            worktree,
                            worktree_index,
                        },
                        sink,
                        now_ms(),
                    )
                }
                StartRunningSessionDto::New { mode, name, .. } => {
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
    let (dto, payload) = {
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
        guard.running_sessions.push(slot);
        (dto, payload)
    };
    spawn_event_loop(app_handle.clone(), target, rx);
    let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);
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
