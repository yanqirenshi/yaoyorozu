//! app が起動したまま持つ claude CLI(実行中セッション)の Command 群(issue #391。
//! Phase 1「1セッションを app から対話する」)。native.md §1 のとおり、ここは薄い層:
//! 引数の変換 → ユースケース(`app`)の呼び出し → DTO 化。状態遷移の規則は domain / app にある。
//!
//! - 途中経過(テキストの断片・ツールの開始など)は **Channel**(`ProgressEventDto`)で流す。
//! - 状態変化・権限の問い合わせの到着は**軽量イベント** `running-session:changed` で知らせ、
//!   データ本体はフロントが `get_running_session` で取り直す(native.md §3.2)。
//! - ロック(`AppState`)の中でファイル I/O・子プロセスへの書き込み・`emit` をしない(§2)。
//!   状態を先に動かし、ロックを外してから書き込む(`app::begin_*` の説明)。
//! - フロントから cwd やパスは受け取らない(§4)。cwd は会話ファイルから app が求める。

use crate::dto::{
    AppErrorDto, PermissionBehaviorDto, PermissionSuggestionDto, ProgressEventDto,
    RunningPermissionModeDto, RunningSessionChangedEventDto, RunningSessionDto,
};
use crate::state::{resolve_effective_projects_dir, AppState, RunningSessionSlot};
use app::{AppError, PermissionDecision, RunningSessionEvent, RunningSessionEventSink};
use domain::{PermissionSuggestion, ProcessState};
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
    AppError::NotFound("実行中のセッションがありません。先に開始してください".to_string()).into()
}

/// 読み取りスレッドから、順序を保ったまま tauri 層の処理タスクへ出来事を渡す受け口。
struct ChannelSink(mpsc::UnboundedSender<RunningSessionEvent>);

impl RunningSessionEventSink for ChannelSink {
    fn emit(&self, event: RunningSessionEvent) {
        // 受け側(処理タスク)が終わっていれば捨てる。
        let _ = self.0.send(event);
    }
}

fn changed_event(
    slot: &RunningSessionSlot,
    exit_code: Option<i32>,
) -> RunningSessionChangedEventDto {
    RunningSessionChangedEventDto {
        session_id: slot.session.base.session_id.clone(),
        process_state: slot.session.process_state.into(),
        pending_permission_count: slot.session.permission_requests.len(),
        exit_code,
    }
}

/// 起動した世代 `generation` の出来事を、順に処理する。途中経過は Channel へ流し、状態を
/// 動かす出来事は `AppState` へ反映して軽量イベントで知らせる。`Exited` で終わる。
fn spawn_event_loop(
    app_handle: tauri::AppHandle,
    generation: u64,
    mut rx: mpsc::UnboundedReceiver<RunningSessionEvent>,
    on_progress: Channel<ProgressEventDto>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let RunningSessionEvent::Progress(progress) = &event {
                // 画面が閉じている等で送れなくても、状態の反映は続ける。
                let _ = on_progress.send(ProgressEventDto::from(progress.clone()));
            }
            let exit_code = match &event {
                RunningSessionEvent::Exited { exit_code, .. } => *exit_code,
                _ => None,
            };
            if let RunningSessionEvent::Exited { stderr_tail, .. } = &event {
                if !stderr_tail.is_empty() {
                    // 起動失敗などの手がかり(正常系では何も出ない)。秘匿値は含まれない想定だが、
                    // 画面には出さずログにだけ残す。
                    eprintln!("実行中セッション(claude)が終了しました。標準エラー: {stderr_tail}");
                }
            }

            let notify = {
                let state = app_handle.state::<Mutex<AppState>>();
                let mut guard = state.lock().await;
                match guard
                    .running_session
                    .as_mut()
                    .filter(|slot| slot.generation == generation)
                {
                    Some(slot) => {
                        let before = (
                            slot.session.process_state,
                            slot.session.permission_requests.len(),
                        );
                        app::apply_running_session_event(&mut slot.session, &event, now_ms());
                        let after = (
                            slot.session.process_state,
                            slot.session.permission_requests.len(),
                        );
                        (before != after || exit_code.is_some())
                            .then(|| changed_event(slot, exit_code))
                    }
                    None => None,
                }
            };
            if let Some(payload) = notify {
                let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);
            }
            if matches!(event, RunningSessionEvent::Exited { .. }) {
                break;
            }
        }
    });
}

/// 会話 `session_id` を、子プロセスの `claude` として起動する(`--resume`)。Phase 1 は同時に
/// 1つ。起動済み(終了していない)があれば `session_busy`。`profile_id` は対象プロファイルの
/// 確認に使う(省略時はアクティブなプロファイル)。
#[tauri::command]
pub async fn start_running_session(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: Option<String>,
    project: String,
    session_id: String,
    mode: RunningPermissionModeDto,
    on_progress: Channel<ProgressEventDto>,
) -> Result<RunningSessionDto, AppErrorDto> {
    let (settings, current, generation) = {
        let mut guard = state.lock().await;
        // 起動は数秒かかりうる。その間に2つ目が起動されないよう、先に印を付ける。
        if guard.running_session_starting {
            return Err(AppError::SessionBusy(
                "実行中のセッションを起動している最中です".to_string(),
            )
            .into());
        }
        guard.running_session_starting = true;
        guard.running_session_generation += 1;
        (
            guard.settings.clone(),
            guard
                .running_session
                .as_ref()
                .map(|slot| slot.session.clone()),
            guard.running_session_generation,
        )
    };

    let prepared = (|| -> Result<std::path::PathBuf, AppError> {
        app::resolve_profile(&settings, profile_id.as_deref())?;
        resolve_effective_projects_dir(&settings)
    })();
    let root = match prepared {
        Ok(root) => root,
        Err(e) => {
            state.lock().await.running_session_starting = false;
            return Err(e.into());
        }
    };

    let (tx, rx) = mpsc::unbounded_channel();
    let sink: Arc<dyn RunningSessionEventSink> = Arc::new(ChannelSink(tx));
    let project_for_task = project.clone();
    let session_id_for_task = session_id.clone();
    // claude の起動は数秒かかりうるため、async ランタイムを塞がないようブロッキングスレッドで行う。
    let started = tauri::async_runtime::spawn_blocking(
        move || -> Result<app::StartedRunningSession, AppError> {
            let source = FileSystemRepository::new(root);
            let launcher = ClaudeCliProcessLauncher::new();
            let ledger =
                FileRunningSessionSource::new(FileRunningSessionSource::default_sessions_dir()?);
            app::start_running_session(
                &source,
                &launcher,
                &ledger,
                current.as_ref(),
                &project_for_task,
                &session_id_for_task,
                mode.into(),
                sink,
                now_ms(),
            )
        },
    )
    .await
    .unwrap_or_else(|_| {
        Err(AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    });

    let started = match started {
        Ok(started) => started,
        Err(e) => {
            state.lock().await.running_session_starting = false;
            return Err(e.into());
        }
    };

    let (dto, payload) = {
        let mut guard = state.lock().await;
        guard.running_session_starting = false;
        let slot = RunningSessionSlot {
            project: project.clone(),
            generation,
            session: started.session,
            process: started.process,
        };
        let dto = RunningSessionDto::from_session(&project, slot.session.clone());
        let payload = changed_event(&slot, None);
        guard.running_session = Some(slot);
        (dto, payload)
    };
    spawn_event_loop(app_handle.clone(), generation, rx, on_progress);
    let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);
    Ok(dto)
}

/// 起動済みの実行中セッションの現在の状態(答え待ちの問い合わせを含む)。無ければ `None`。
#[tauri::command]
pub async fn get_running_session(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Option<RunningSessionDto>, AppErrorDto> {
    let guard = state.lock().await;
    Ok(guard
        .running_session
        .as_ref()
        .map(|slot| RunningSessionDto::from_session(&slot.project, slot.session.clone())))
}

/// 実行中セッションへ user メッセージ(本文と画像)を送る。
#[tauri::command]
pub async fn send_to_running_session(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    text: String,
    images: Vec<String>,
) -> Result<(), AppErrorDto> {
    // 状態を先に動かす(ロックの中。書き込みはロックの外)。
    let (process, validated, payload) = {
        let mut guard = state.lock().await;
        let slot = guard.running_session.as_mut().ok_or_else(not_running)?;
        let validated =
            app::begin_send_to_running_session(&mut slot.session, &text, &images, now_ms())?;
        (slot.process.clone(), validated, changed_event(slot, None))
    };
    let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);

    tauri::async_runtime::spawn_blocking(move || {
        app::write_user_message(process.as_ref(), &text, &validated)
    })
    .await
    .unwrap_or_else(|_| {
        Err(AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// 権限の問い合わせに答える。許可(`allow`)は `updated_input`(書き換えた入力。省略で問い合わせの
/// 入力のまま)と `updated_permissions`(「今後も許可」にする提案。問い合わせの `suggestions` から
/// 選んだもの)を、拒否(`deny`)は `message` を添えられる。
#[tauri::command]
pub async fn respond_permission(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    request_id: String,
    behavior: PermissionBehaviorDto,
    updated_input: Option<serde_json::Value>,
    updated_permissions: Option<Vec<PermissionSuggestionDto>>,
    message: Option<String>,
) -> Result<(), AppErrorDto> {
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
        let slot = guard.running_session.as_mut().ok_or_else(not_running)?;
        let response =
            app::begin_respond_permission(&mut slot.session, &request_id, decision, now_ms())?;
        (slot.process.clone(), response, changed_event(slot, None))
    };
    let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);

    tauri::async_runtime::spawn_blocking(move || {
        app::write_permission_response(process.as_ref(), &response)
    })
    .await
    .unwrap_or_else(|_| {
        Err(AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// 生成中(権限待ちを含む)の中断を要求する。プロセスは生きたまま、次の入力を送れる。
#[tauri::command]
pub async fn interrupt_running_session(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), AppErrorDto> {
    let (snapshot, process) = {
        let guard = state.lock().await;
        let slot = guard.running_session.as_ref().ok_or_else(not_running)?;
        (slot.session.clone(), slot.process.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        app::interrupt_running_session(&snapshot, process.as_ref())
    })
    .await
    .unwrap_or_else(|_| {
        Err(AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map_err(Into::into)
}

/// 実行中セッションを止める(標準入力を閉じて終了を待つ。約1秒)。無い・終了済みなら何もしない。
#[tauri::command]
pub async fn stop_running_session(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), AppErrorDto> {
    let (mut snapshot, process, generation) = {
        let guard = state.lock().await;
        match guard.running_session.as_ref() {
            Some(slot) => (slot.session.clone(), slot.process.clone(), slot.generation),
            None => return Ok(()),
        }
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
    .map_err(|_| AppError::Io("バックグラウンド処理に失敗しました".to_string()))?;

    // 読み取りスレッドの `Exited` も同じ反映をするが、画面が停止直後に状態を取り直せるよう
    // ここでも終了に揃える(冪等)。
    let payload = {
        let mut guard = state.lock().await;
        match guard
            .running_session
            .as_mut()
            .filter(|slot| slot.generation == generation)
        {
            Some(slot) => {
                slot.session = snapshot;
                Some(changed_event(slot, None))
            }
            None => None,
        }
    };
    if let Some(payload) = payload {
        let _ = app_handle.emit(RUNNING_SESSION_CHANGED_EVENT, payload);
    }
    Ok(())
}

/// app の終了時に、起動したままの子プロセスを止める(残さない)。ウィンドウが閉じられて
/// アプリが終了するとき(`RunEvent::Exit`)に呼ぶ。同期的に終わるまで待つ(最大で数秒)。
pub fn stop_running_session_on_exit(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<Mutex<AppState>>();
    let process = tauri::async_runtime::block_on(async {
        let guard = state.lock().await;
        guard
            .running_session
            .as_ref()
            .filter(|slot| slot.session.process_state != ProcessState::Exited)
            .map(|slot| slot.process.clone())
    });
    if let Some(process) = process {
        process.stop();
    }
}

/// 1回きり送信(`send_message`)が、app が起動した実行中セッションと同じ会話へ並行して書き込ま
/// ないための確認。app 自身の子プロセスは #361 のガードには「他のプロセス」として見えるので、
/// 別の理由で止めるメッセージを返す。
pub async fn ensure_not_running_by_app(
    state: &Mutex<AppState>,
    session_id: &str,
) -> Result<(), AppErrorDto> {
    let guard = state.lock().await;
    let busy = guard.running_session.as_ref().is_some_and(|slot| {
        slot.session.base.session_id == session_id
            && slot.session.process_state != ProcessState::Exited
    });
    if busy {
        return Err(AppError::SessionBusy(
            "このセッションは app が起動した実行中のセッションで開いています。そちらから送信するか、先に停止してください"
                .to_string(),
        )
        .into());
    }
    Ok(())
}
