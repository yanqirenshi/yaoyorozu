//! app が起動したまま持つ claude CLI(実行中セッション)のユースケースと port
//! (issue #391。Phase 1「1セッションを app から対話する」)。
//!
//! CLI の起動・標準入出力・wire 形式の解釈といった I/O は port の実装(infra)の責務で、
//! ここには状態遷移を動かす規則と、入力の検証・順序だけを置く(native.md §1)。
//! 途中経過(`ProgressEvent`)は画面へ流すだけで保存しない。

use crate::{AppError, RunningSessionSource, SessionSource};
use domain::{
    is_valid_project_dir_name, is_valid_session_id, validate_image_attachments, ImageAttachment,
    PermissionRequest, PermissionResponse, ProcessState, ProcessTrigger, ProgressEvent,
    RunningSession, RunningSessionByApp,
};
use std::path::PathBuf;
use std::sync::Arc;

/// Phase 1 で選べる権限モード。`plan`(計画だけ)と `default`(すべてのツール使用が
/// 権限の問い合わせとして届く)の2つ。`auto` など他のモードは Phase 2。
///
/// CLI 2.1.280 では `default` が `manual` に改名されているが、`default` も受け付ける
/// (PoC #382 レポート §0.3)。ここでは判定に使わず、CLI へそのまま渡すだけ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RunningPermissionMode {
    Plan,
    #[default]
    Default,
}

impl RunningPermissionMode {
    /// CLI の `--permission-mode` に渡す値。
    pub fn as_cli_value(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Default => "default",
        }
    }
}

/// 起動の要求。値は app が解決済みで、フロントから受け取ったパスは含まない
/// (cwd は会話ファイルから求める。native.md §4)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartRunningSession {
    pub session_id: String,
    pub cwd: PathBuf,
    pub mode: RunningPermissionMode,
}

/// 実行中セッション(子プロセス)からの出来事。infra の読み取りスレッドが、CLI の wire 形式を
/// domain の型に写したうえで [`RunningSessionEventSink`] へ流す。
#[derive(Debug, Clone, PartialEq)]
pub enum RunningSessionEvent {
    /// 最初の `system/init` を受けた(以降のターンごとの `init` も同じ出来事として届く)。
    Initialized,
    /// 画面へ流す途中経過。
    Progress(ProgressEvent),
    /// ツール使用の問い合わせが届いた。
    PermissionRequested(PermissionRequest),
    /// CLI が問い合わせを取り下げた(中断。`control_cancel_request`)。
    PermissionCancelled { request_id: String },
    /// プロセスが終了した。`stderr_tail` は終了理由の手がかり(起動失敗など。末尾の数行)。
    Exited {
        exit_code: Option<i32>,
        stderr_tail: String,
    },
}

/// 実行中セッションからの出来事の受け口(port。実装は tauri 層)。読み取りスレッドから
/// 呼ばれるので、呼び出しは順序どおりに届く前提で、ブロックしないこと。
pub trait RunningSessionEventSink: Send + Sync {
    fn emit(&self, event: RunningSessionEvent);
}

/// 起動済みの子プロセス(port。実装は infra)。
pub trait RunningProcess: Send + Sync {
    fn pid(&self) -> u32;
    /// pid が有効な範囲(`<OS>:<ホスト名>`)。
    fn pid_domain(&self) -> String;
    /// user メッセージ(本文と画像)を標準入力へ書く。
    fn send_user_message(&self, text: &str, images: &[ImageAttachment]) -> Result<(), AppError>;
    /// 権限の応答を標準入力へ書く。
    fn respond_permission(&self, response: &PermissionResponse) -> Result<(), AppError>;
    /// 生成中(権限待ち中を含む)の中断を要求する。プロセスは生きたまま、次の入力を送れる。
    fn interrupt(&self) -> Result<(), AppError>;
    /// 標準入力を閉じて終了を待つ(約1秒で終了する)。応答が無ければ強制終了する。
    /// 終了済みなら何もしない。
    fn stop(&self);
}

/// 子プロセスを起動する(port。実装は infra)。
pub trait RunningSessionLauncher: Send + Sync {
    /// `request` で `claude` を起動する。起動後の出来事は `sink` へ流す。
    fn start(
        &self,
        request: &StartRunningSession,
        sink: Arc<dyn RunningSessionEventSink>,
    ) -> Result<Arc<dyn RunningProcess>, AppError>;
}

/// [`start_running_session`] の結果。
pub struct StartedRunningSession {
    pub session: RunningSessionByApp,
    pub process: Arc<dyn RunningProcess>,
}

/// 現在時刻(epoch ms)。時計は app に置かない(呼び出し側が渡す)。
pub type NowMs = u64;

/// 会話 `session_id` を、子プロセスの `claude` として起動する(`--resume`)。
///
/// - Phase 1 は**同時に1つ**。`current`(いま持っている実行中セッション)が終了していなければ、
///   先に停止を求める(2つ目は開かない)。Phase 2 で複数化する。
/// - #361 のガードは**外部**で実行中かを見る。app が起動した子プロセスは同じ台帳を書くので、
///   自分の PID(`current` のもの)は除外して調べる。
/// - 起動に成功したら、`Starting` の状態の [`RunningSessionByApp`] を返す(以降の状態は
///   [`apply_running_session_event`] などが動かす)。
#[allow(clippy::too_many_arguments)]
pub fn start_running_session(
    source: &dyn SessionSource,
    launcher: &dyn RunningSessionLauncher,
    ledger: &dyn RunningSessionSource,
    current: Option<&RunningSessionByApp>,
    project: &str,
    session_id: &str,
    mode: RunningPermissionMode,
    sink: Arc<dyn RunningSessionEventSink>,
    now: NowMs,
) -> Result<StartedRunningSession, AppError> {
    if !is_valid_project_dir_name(project) {
        return Err(AppError::InvalidInput(
            "不正なプロジェクト名です".to_string(),
        ));
    }
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }

    let own_pids = own_running_pids(current);
    if let Some(pid) = own_pids.first() {
        return Err(AppError::SessionBusy(format!(
            "実行中のセッション(PID {pid})があります。先に停止してから開いてください"
        )));
    }

    // 自分の子プロセスは除外して、外部で実行中かを調べる(上で止めるので、ここでは通常空。
    // Phase 2 で複数化したとき、自分の子を除外する仕組みがそのまま使える)。
    if let Some(running) = ledger.find_running(session_id, &own_pids)? {
        return Err(AppError::SessionBusy(running.block_message()));
    }

    let cwd = source.session_cwd(project, session_id)?;
    let request = StartRunningSession {
        session_id: session_id.to_string(),
        cwd: cwd.clone(),
        mode,
    };
    let process = launcher.start(&request, sink)?;

    let mut base = RunningSession::new(session_id, &process.pid_domain(), process.pid(), now);
    base.cwd = Some(cwd);
    Ok(StartedRunningSession {
        session: RunningSessionByApp::new(base, now),
        process,
    })
}

/// 送信の準備: 本文・画像の検証(1回きり送信 [`crate::send_message`] と同じ規則。domain の
/// 関数)と、状態を `MessageSent` で動かすところまでを行い、検証済みの画像を返す。書き込みは
/// しない。
///
/// 状態を**書き込みの前に**動かすのは、CLI が数 ms で応答して(エラーなど)読み取りスレッドの
/// 出来事(`TurnFinished`)が、書き込み直後の `MessageSent` より先に状態へ反映されると、
/// 待機のはずが実行中のまま固まるため。呼び出し側(tauri 層)は状態のロックの中でこれを呼び、
/// **ロックを外してから**書き込む(ロック保持中に I/O をしない。native.md §2)。
/// 終了済みには送れない。実行中に次の入力を送ってもよい(キューは CLI 側)。
pub fn begin_send_to_running_session(
    session: &mut RunningSessionByApp,
    text: &str,
    images: &[String],
    now: NowMs,
) -> Result<Vec<ImageAttachment>, AppError> {
    if text.trim().is_empty() && images.is_empty() {
        return Err(AppError::InvalidInput(
            "メッセージを入力してください".to_string(),
        ));
    }
    let images =
        validate_image_attachments(images).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    ensure_not_exited(session)?;
    if session.process_state == ProcessState::Starting {
        // 起動できたか(initialize の応答)が分かる前に送ると、状態の遷移が食い違う
        // (起動中に送った印は遷移表に無く、あとで届く起動完了で待機になってしまう)。
        return Err(AppError::InvalidInput(
            "実行中のセッションを起動している最中です。しばらく待ってから送ってください"
                .to_string(),
        ));
    }
    session.apply(ProcessTrigger::MessageSent, now);
    Ok(images)
}

/// 実行中セッションへ user メッセージを送る([`begin_send_to_running_session`] +
/// 書き込み)。書き込みに失敗したら、標準入力が壊れている(プロセスが終わりつつある)ので、
/// 状態が「実行中」のまま固まらないようプロセスを止める(`Exited` の出来事が続く)。
pub fn send_to_running_session(
    session: &mut RunningSessionByApp,
    process: &dyn RunningProcess,
    text: &str,
    images: &[String],
    now: NowMs,
) -> Result<(), AppError> {
    let images = begin_send_to_running_session(session, text, images, now)?;
    write_or_stop(process, |p| p.send_user_message(text, &images))
}

/// user メッセージを標準入力へ書く(ロックの外で呼ぶ。[`begin_send_to_running_session`] の後)。
/// 失敗したらプロセスを止めてからエラーを返す。
pub fn write_user_message(
    process: &dyn RunningProcess,
    text: &str,
    images: &[ImageAttachment],
) -> Result<(), AppError> {
    write_or_stop(process, |p| p.send_user_message(text, images))
}

/// 権限の応答を標準入力へ書く(ロックの外で呼ぶ。[`begin_respond_permission`] の後)。
/// 失敗したらプロセスを止めてからエラーを返す。
pub fn write_permission_response(
    process: &dyn RunningProcess,
    response: &PermissionResponse,
) -> Result<(), AppError> {
    write_or_stop(process, |p| p.respond_permission(response))
}

/// 書き込みに失敗したらプロセスを止めてからエラーを返す。
fn write_or_stop(
    process: &dyn RunningProcess,
    write: impl FnOnce(&dyn RunningProcess) -> Result<(), AppError>,
) -> Result<(), AppError> {
    write(process).inspect_err(|_| process.stop())
}

/// 権限の問い合わせへの答えの準備: 答え待ちから `request_id` を探し、送る応答を組み立て、
/// 答え待ちから外す(答え待ちが無くなったら状態を動かす)。書き込みはしない(ロックの外で
/// [`RunningProcess::respond_permission`] を呼ぶ。[`begin_send_to_running_session`] と同じ理由で、
/// 状態は先に動かす)。`request_id` が答え待ちに無ければエラー(取り下げ済み・二重応答)。
/// 許可は `updated_input` を省略すると問い合わせの入力をそのまま返す。
pub fn begin_respond_permission(
    session: &mut RunningSessionByApp,
    request_id: &str,
    decision: PermissionDecision,
    now: NowMs,
) -> Result<PermissionResponse, AppError> {
    let request = session
        .permission_requests
        .iter()
        .find(|r| r.request_id == request_id)
        .cloned()
        .ok_or_else(|| {
            AppError::NotFound(
                "その問い合わせは見つかりません(すでに答えたか、取り下げられました)".to_string(),
            )
        })?;

    let response = match decision {
        PermissionDecision::Allow {
            updated_input,
            updated_permissions,
        } => PermissionResponse::allow(
            request_id,
            &request.tool_input,
            updated_input,
            updated_permissions,
            now,
        ),
        PermissionDecision::Deny { message } => PermissionResponse::deny(
            request_id,
            message
                .as_deref()
                .filter(|m| !m.trim().is_empty())
                .unwrap_or(DEFAULT_DENY_MESSAGE),
            now,
        ),
    };
    session.settle_permission_request(request_id, now);
    Ok(response)
}

/// 権限の問い合わせに答える([`begin_respond_permission`] + 書き込み)。書き込みに失敗したら
/// プロセスを止める(理由は [`send_to_running_session`] と同じ)。
pub fn respond_permission(
    session: &mut RunningSessionByApp,
    process: &dyn RunningProcess,
    request_id: &str,
    decision: PermissionDecision,
    now: NowMs,
) -> Result<(), AppError> {
    let response = begin_respond_permission(session, request_id, decision, now)?;
    write_or_stop(process, |p| p.respond_permission(&response))
}

/// 画面から受け取る、権限の問い合わせへの答え。取り消し(`Cancelled`)は CLI 側が決めるもので
/// 画面からは選べない。
#[derive(Debug, Clone, PartialEq)]
pub enum PermissionDecision {
    Allow {
        updated_input: Option<serde_json::Value>,
        updated_permissions: Option<serde_json::Value>,
    },
    Deny {
        message: Option<String>,
    },
}

/// 拒否メッセージを省略したときの文言(そのままモデルへの tool_result になる)。
const DEFAULT_DENY_MESSAGE: &str = "ユーザーが拒否しました";

/// 生成中(権限待ちを含む)の中断を要求する。プロセスは生きたまま次の入力を送れる。
/// 権限待ちのときは、CLI が問い合わせを取り下げる(`PermissionCancelled` が届く)。
/// 状態はここでは動かさない(`result` と取り下げの出来事が動かす)。
pub fn interrupt_running_session(
    session: &RunningSessionByApp,
    process: &dyn RunningProcess,
) -> Result<(), AppError> {
    ensure_not_exited(session)?;
    process.interrupt()
}

/// 子プロセスを止める(標準入力を閉じて終了を待つ)。終了済みでも呼んでよい。
pub fn stop_running_session(
    session: &mut RunningSessionByApp,
    process: &dyn RunningProcess,
    now: NowMs,
) {
    process.stop();
    session.exit(now);
}

/// 子プロセスからの出来事を、実行中セッションの状態へ反映する(純粋な規則)。
///
/// | 出来事 | 状態への反映 |
/// |---|---|
/// | `Initialized` | `Initialized` |
/// | `Progress(TurnFinished)` | `TurnFinished` |
/// | `Progress`(それ以外) | なし(画面へ流すだけ) |
/// | `PermissionRequested` | 答え待ちに足して `PermissionAsked` |
/// | `PermissionCancelled` | 答え待ちから外し、無くなったら `PermissionSettled` |
/// | `Exited` | 答え待ちを捨てて `Exited` |
pub fn apply_running_session_event(
    session: &mut RunningSessionByApp,
    event: &RunningSessionEvent,
    now: NowMs,
) {
    match event {
        RunningSessionEvent::Initialized => session.apply(ProcessTrigger::Initialized, now),
        RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. }) => {
            session.apply(ProcessTrigger::TurnFinished, now)
        }
        RunningSessionEvent::Progress(_) => {}
        RunningSessionEvent::PermissionRequested(request) => {
            session.receive_permission_request(request.clone(), now)
        }
        RunningSessionEvent::PermissionCancelled { request_id } => {
            session.settle_permission_request(request_id, now);
        }
        RunningSessionEvent::Exited { .. } => session.exit(now),
    }
}

/// app が起動した(終了していない)実行中セッションの PID の一覧。#361 のガードで、
/// 外部で実行中かを調べるときに除外する。
pub fn own_running_pids(session: Option<&RunningSessionByApp>) -> Vec<u32> {
    session
        .filter(|s| s.process_state != ProcessState::Exited)
        .map(|s| s.base.pid)
        .into_iter()
        .collect()
}

fn ensure_not_exited(session: &RunningSessionByApp) -> Result<(), AppError> {
    if session.process_state == ProcessState::Exited {
        return Err(AppError::InvalidInput(
            "実行中のセッションは終了しています。開き直してください".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DetectedRunning;
    use domain::{PermissionBehavior, Project};
    use std::sync::Mutex;

    // ---- フェイク ----

    #[derive(Default)]
    struct FakeProcess {
        sent: Mutex<Vec<(String, usize)>>,
        responses: Mutex<Vec<PermissionResponse>>,
        interrupts: Mutex<usize>,
        stopped: Mutex<usize>,
        fail_send: bool,
    }

    impl RunningProcess for FakeProcess {
        fn pid(&self) -> u32 {
            4242
        }
        fn pid_domain(&self) -> String {
            "windows:PC".to_string()
        }
        fn send_user_message(
            &self,
            text: &str,
            images: &[ImageAttachment],
        ) -> Result<(), AppError> {
            if self.fail_send {
                return Err(AppError::Io("pipe closed".to_string()));
            }
            self.sent
                .lock()
                .unwrap()
                .push((text.to_string(), images.len()));
            Ok(())
        }
        fn respond_permission(&self, response: &PermissionResponse) -> Result<(), AppError> {
            self.responses.lock().unwrap().push(response.clone());
            Ok(())
        }
        fn interrupt(&self) -> Result<(), AppError> {
            *self.interrupts.lock().unwrap() += 1;
            Ok(())
        }
        fn stop(&self) {
            *self.stopped.lock().unwrap() += 1;
        }
    }

    struct FakeLauncher {
        process: Arc<FakeProcess>,
        started: Mutex<Vec<StartRunningSession>>,
    }

    impl FakeLauncher {
        fn new() -> Self {
            Self {
                process: Arc::new(FakeProcess::default()),
                started: Mutex::new(Vec::new()),
            }
        }
    }

    impl RunningSessionLauncher for FakeLauncher {
        fn start(
            &self,
            request: &StartRunningSession,
            _sink: Arc<dyn RunningSessionEventSink>,
        ) -> Result<Arc<dyn RunningProcess>, AppError> {
            self.started.lock().unwrap().push(request.clone());
            Ok(self.process.clone())
        }
    }

    struct NullSink;
    impl RunningSessionEventSink for NullSink {
        fn emit(&self, _event: RunningSessionEvent) {}
    }

    /// 台帳のフェイク。`running_pid` の PID の台帳が sessionId 一致で残っている状況を作る。
    /// 実物と同じく、`exclude_pids` に入っている PID は見ない。
    struct FakeLedger {
        running_pid: Option<u32>,
        asked_excludes: Mutex<Vec<Vec<u32>>>,
    }

    impl FakeLedger {
        fn none() -> Self {
            Self {
                running_pid: None,
                asked_excludes: Mutex::new(Vec::new()),
            }
        }
        fn with_pid(pid: u32) -> Self {
            Self {
                running_pid: Some(pid),
                asked_excludes: Mutex::new(Vec::new()),
            }
        }
    }

    impl RunningSessionSource for FakeLedger {
        fn find_running(
            &self,
            _session_id: &str,
            exclude_pids: &[u32],
        ) -> Result<Option<DetectedRunning>, AppError> {
            self.asked_excludes
                .lock()
                .unwrap()
                .push(exclude_pids.to_vec());
            Ok(self
                .running_pid
                .filter(|pid| !exclude_pids.contains(pid))
                .map(|pid| DetectedRunning {
                    ledger_path: PathBuf::from(format!("/sessions/{pid}.json")),
                    pid,
                    evidence: crate::RunningEvidence::SessionMatched,
                }))
        }
    }

    struct FakeSource;
    impl SessionSource for FakeSource {
        fn list_projects(&self) -> Result<Vec<Project>, AppError> {
            Ok(Vec::new())
        }
        fn read_session(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<crate::SessionContent, AppError> {
            Err(AppError::NotFound("unused".to_string()))
        }
        fn session_fingerprint(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<crate::FileFingerprint, AppError> {
            Err(AppError::NotFound("unused".to_string()))
        }
        fn session_cwd(&self, _project: &str, _session_id: &str) -> Result<PathBuf, AppError> {
            Ok(PathBuf::from("/work/proj"))
        }
        fn list_sessions(&self, _project: &str) -> Result<Vec<domain::SessionSummary>, AppError> {
            Ok(Vec::new())
        }
        fn list_parsed_sessions(
            &self,
            _project: &str,
        ) -> Result<Vec<domain::ParsedSession>, AppError> {
            Ok(Vec::new())
        }
        fn session_line_raw(
            &self,
            _project: &str,
            _session_id: &str,
            _uuid: &str,
        ) -> Result<String, AppError> {
            Err(AppError::NotFound("unused".to_string()))
        }
    }

    fn sink() -> Arc<dyn RunningSessionEventSink> {
        Arc::new(NullSink)
    }

    fn start(
        launcher: &FakeLauncher,
        ledger: &FakeLedger,
        current: Option<&RunningSessionByApp>,
    ) -> Result<StartedRunningSession, AppError> {
        start_running_session(
            &FakeSource,
            launcher,
            ledger,
            current,
            "proj",
            "s1",
            RunningPermissionMode::Default,
            sink(),
            1000,
        )
    }

    fn started_in(state: ProcessState) -> (RunningSessionByApp, Arc<FakeProcess>) {
        let launcher = FakeLauncher::new();
        let mut started = start(&launcher, &FakeLedger::none(), None).unwrap();
        started.session.process_state = state;
        (started.session, launcher.process)
    }

    fn request(id: &str) -> PermissionRequest {
        PermissionRequest {
            request_id: id.to_string(),
            tool_name: "Write".to_string(),
            display_name: None,
            description: None,
            tool_use_id: "toolu_1".to_string(),
            tool_input: serde_json::json!({"file_path":"a.txt","content":"hi"}),
            blocked_path: None,
            requested_at: 1,
            suggestions: Vec::new(),
        }
    }

    // ---- 起動 ----

    #[test]
    fn start_launches_the_process_with_the_resolved_cwd_and_returns_a_starting_session() {
        let launcher = FakeLauncher::new();

        let started = start(&launcher, &FakeLedger::none(), None).expect("should start");

        let requests = launcher.started.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].session_id, "s1");
        assert_eq!(requests[0].cwd, PathBuf::from("/work/proj"));
        assert_eq!(requests[0].mode, RunningPermissionMode::Default);
        assert_eq!(started.session.process_state, ProcessState::Starting);
        assert_eq!(started.session.base.pid, 4242);
        assert_eq!(started.session.base.session_id, "s1");
        assert_eq!(started.session.base.started_at, 1000);
        assert_eq!(started.session.base.cwd, Some(PathBuf::from("/work/proj")));
    }

    #[test]
    fn start_rejects_unsafe_ids_without_launching() {
        let launcher = FakeLauncher::new();

        let bad_session = start_running_session(
            &FakeSource,
            &launcher,
            &FakeLedger::none(),
            None,
            "proj",
            "../etc/passwd",
            RunningPermissionMode::Plan,
            sink(),
            1,
        );
        let bad_project = start_running_session(
            &FakeSource,
            &launcher,
            &FakeLedger::none(),
            None,
            "../x",
            "s1",
            RunningPermissionMode::Plan,
            sink(),
            1,
        );

        assert!(matches!(bad_session, Err(AppError::InvalidInput(_))));
        assert!(matches!(bad_project, Err(AppError::InvalidInput(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn only_one_running_session_can_be_started_at_a_time() {
        let (existing, _) = started_in(ProcessState::Idle);
        let launcher = FakeLauncher::new();

        let second = start(&launcher, &FakeLedger::none(), Some(&existing));

        assert!(matches!(second, Err(AppError::SessionBusy(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn a_new_session_can_be_started_after_the_previous_one_exited() {
        let (existing, _) = started_in(ProcessState::Exited);
        let launcher = FakeLauncher::new();

        assert!(start(&launcher, &FakeLedger::none(), Some(&existing)).is_ok());
    }

    #[test]
    fn start_is_blocked_when_another_process_is_running_the_same_session() {
        let launcher = FakeLauncher::new();

        let result = start(&launcher, &FakeLedger::with_pid(9999), None);

        assert!(matches!(result, Err(AppError::SessionBusy(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn the_guard_excludes_the_pid_of_the_app_started_process() {
        // #361 のガード: app が起動した子プロセスは外部の実行中とみなさない。
        assert_eq!(own_running_pids(None), Vec::<u32>::new());
        let (idle, _) = started_in(ProcessState::Idle);
        assert_eq!(own_running_pids(Some(&idle)), vec![4242]);
        let (exited, _) = started_in(ProcessState::Exited);
        assert_eq!(
            own_running_pids(Some(&exited)),
            Vec::<u32>::new(),
            "終了済みの PID は除外しない(PID は使い回される)"
        );

        // 自分の PID の台帳だけが残っている状況では、ガードを通る。
        let own = own_running_pids(Some(&idle));
        assert!(FakeLedger::with_pid(4242)
            .find_running("s1", &own)
            .unwrap()
            .is_none());
        // 別のプロセスの台帳は、自分の PID を除外しても実行中と判定する。
        assert!(FakeLedger::with_pid(9999)
            .find_running("s1", &own)
            .unwrap()
            .is_some());
    }

    // ---- 送信 ----

    #[test]
    fn send_while_starting_is_rejected_until_the_process_reports_it_started() {
        let (mut session, process) = started_in(ProcessState::Starting);

        let early = send_to_running_session(&mut session, process.as_ref(), "x", &[], 5);

        assert!(matches!(early, Err(AppError::InvalidInput(_))));
        assert!(process.sent.lock().unwrap().is_empty());
        assert_eq!(session.process_state, ProcessState::Starting);

        apply_running_session_event(&mut session, &RunningSessionEvent::Initialized, 6);
        assert!(send_to_running_session(&mut session, process.as_ref(), "x", &[], 7).is_ok());
    }

    #[test]
    fn send_writes_to_the_process_and_moves_idle_to_running() {
        let (mut session, process) = started_in(ProcessState::Idle);

        send_to_running_session(&mut session, process.as_ref(), "こんにちは", &[], 2000)
            .expect("should send");

        assert_eq!(
            process.sent.lock().unwrap().as_slice(),
            &[("こんにちは".to_string(), 0)]
        );
        assert_eq!(session.process_state, ProcessState::Running);
        assert_eq!(session.process_state_at, 2000);
    }

    #[test]
    fn send_while_running_is_allowed_and_keeps_running() {
        let (mut session, process) = started_in(ProcessState::Running);

        send_to_running_session(&mut session, process.as_ref(), "続き", &[], 2000)
            .expect("should send");

        assert_eq!(session.process_state, ProcessState::Running);
        assert_eq!(process.sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn send_rejects_blank_text_invalid_images_and_an_exited_session_without_writing() {
        let (mut session, process) = started_in(ProcessState::Idle);
        assert!(matches!(
            send_to_running_session(&mut session, process.as_ref(), "  ", &[], 1),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            send_to_running_session(
                &mut session,
                process.as_ref(),
                "x",
                &["not-base64!!".to_string()],
                1
            ),
            Err(AppError::InvalidInput(_))
        ));
        let (mut exited, process2) = started_in(ProcessState::Exited);
        assert!(matches!(
            send_to_running_session(&mut exited, process2.as_ref(), "x", &[], 1),
            Err(AppError::InvalidInput(_))
        ));
        assert!(process.sent.lock().unwrap().is_empty());
        assert!(process2.sent.lock().unwrap().is_empty());
        assert_eq!(session.process_state, ProcessState::Idle);
    }

    #[test]
    fn a_failed_write_stops_the_process_so_the_state_does_not_stay_running() {
        let launcher = FakeLauncher::new();
        let mut started = start(&launcher, &FakeLedger::none(), None).unwrap();
        started.session.process_state = ProcessState::Idle;
        let process = FakeProcess {
            fail_send: true,
            ..FakeProcess::default()
        };

        let result = send_to_running_session(&mut started.session, &process, "x", &[], 5);

        assert!(matches!(result, Err(AppError::Io(_))));
        // 状態は書き込みの前に動かしてある。壊れた標準入力のプロセスは止め、
        // 出来事(Exited)が状態を終わりにする。
        assert_eq!(*process.stopped.lock().unwrap(), 1);
    }

    #[test]
    fn the_state_moves_before_the_write_so_a_fast_reply_cannot_be_lost() {
        // 書き込みの前に MessageSent を反映しておけば、CLI が即座に返した TurnFinished が
        // その後で待機に戻せる(逆順だと実行中のまま固まる)。
        let (mut session, _) = started_in(ProcessState::Idle);

        let images = begin_send_to_running_session(&mut session, "x", &[], 5).unwrap();
        assert!(images.is_empty());
        assert_eq!(session.process_state, ProcessState::Running);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: false }),
            6,
        );
        assert_eq!(session.process_state, ProcessState::Idle);
    }

    #[test]
    fn begin_respond_settles_first_and_returns_the_response_to_write() {
        let (mut session, _) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);

        let response = begin_respond_permission(
            &mut session,
            "r1",
            PermissionDecision::Deny { message: None },
            20,
        )
        .unwrap();

        assert_eq!(response.request_id, "r1");
        assert_eq!(session.process_state, ProcessState::Running);
        assert!(session.permission_requests.is_empty());
        // 二重応答はできない(先に外してあるので、同時に2回押されても2回書かない)。
        assert!(matches!(
            begin_respond_permission(
                &mut session,
                "r1",
                PermissionDecision::Deny { message: None },
                21
            ),
            Err(AppError::NotFound(_))
        ));
    }

    // ---- 権限の応答 ----

    #[test]
    fn respond_allow_returns_the_requested_input_and_settles_the_request() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);
        assert_eq!(session.process_state, ProcessState::AwaitingPermission);

        respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Allow {
                updated_input: None,
                updated_permissions: None,
            },
            20,
        )
        .expect("should respond");

        let responses = process.responses.lock().unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(
            responses[0].behavior,
            PermissionBehavior::Allow {
                updated_input: serde_json::json!({"file_path":"a.txt","content":"hi"}),
                updated_permissions: None
            }
        );
        assert_eq!(session.process_state, ProcessState::Running);
        assert!(session.permission_requests.is_empty());
    }

    #[test]
    fn respond_deny_uses_the_message_or_a_default() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);
        session.receive_permission_request(request("r2"), 11);

        respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Deny {
                message: Some("だめ".to_string()),
            },
            20,
        )
        .unwrap();
        respond_permission(
            &mut session,
            process.as_ref(),
            "r2",
            PermissionDecision::Deny { message: None },
            21,
        )
        .unwrap();

        let responses = process.responses.lock().unwrap();
        assert_eq!(
            responses[0].behavior,
            PermissionBehavior::Deny {
                message: "だめ".to_string()
            }
        );
        assert_eq!(
            responses[1].behavior,
            PermissionBehavior::Deny {
                message: DEFAULT_DENY_MESSAGE.to_string()
            }
        );
    }

    #[test]
    fn respond_to_an_unknown_or_already_answered_request_is_an_error_and_writes_nothing() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);
        respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Deny { message: None },
            20,
        )
        .unwrap();

        let again = respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Deny { message: None },
            21,
        );

        assert!(matches!(again, Err(AppError::NotFound(_))));
        assert_eq!(process.responses.lock().unwrap().len(), 1);
    }

    // ---- 中断・停止 ----

    #[test]
    fn interrupt_is_forwarded_and_does_not_move_the_state() {
        let (session, process) = started_in(ProcessState::AwaitingPermission);

        interrupt_running_session(&session, process.as_ref()).unwrap();

        assert_eq!(*process.interrupts.lock().unwrap(), 1);
        assert_eq!(session.process_state, ProcessState::AwaitingPermission);
    }

    #[test]
    fn interrupt_of_an_exited_session_is_an_error() {
        let (session, process) = started_in(ProcessState::Exited);

        assert!(matches!(
            interrupt_running_session(&session, process.as_ref()),
            Err(AppError::InvalidInput(_))
        ));
        assert_eq!(*process.interrupts.lock().unwrap(), 0);
    }

    #[test]
    fn stop_stops_the_process_and_marks_the_session_exited() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);

        stop_running_session(&mut session, process.as_ref(), 30);

        assert_eq!(*process.stopped.lock().unwrap(), 1);
        assert_eq!(session.process_state, ProcessState::Exited);
        assert!(session.permission_requests.is_empty());
    }

    // ---- 出来事の反映 ----

    #[test]
    fn events_drive_the_state_machine() {
        let (mut session, _) = started_in(ProcessState::Starting);

        apply_running_session_event(&mut session, &RunningSessionEvent::Initialized, 1);
        assert_eq!(session.process_state, ProcessState::Idle);

        session.apply(ProcessTrigger::MessageSent, 2);
        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TextDelta {
                text: "a".to_string(),
            }),
            3,
        );
        assert_eq!(
            session.process_state,
            ProcessState::Running,
            "途中経過は状態を動かさない"
        );

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::PermissionRequested(request("r1")),
            4,
        );
        assert_eq!(session.process_state, ProcessState::AwaitingPermission);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::PermissionCancelled {
                request_id: "r1".to_string(),
            },
            5,
        );
        assert_eq!(session.process_state, ProcessState::Running);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: true }),
            6,
        );
        assert_eq!(session.process_state, ProcessState::Idle);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Exited {
                exit_code: Some(0),
                stderr_tail: String::new(),
            },
            7,
        );
        assert_eq!(session.process_state, ProcessState::Exited);
        assert_eq!(session.process_state_at, 7);
    }

    #[test]
    fn a_failed_turn_also_returns_to_idle() {
        let (mut session, _) = started_in(ProcessState::Running);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: false }),
            9,
        );

        assert_eq!(session.process_state, ProcessState::Idle);
    }

    #[test]
    fn the_mode_is_passed_to_the_cli_as_is() {
        assert_eq!(RunningPermissionMode::Plan.as_cli_value(), "plan");
        assert_eq!(RunningPermissionMode::Default.as_cli_value(), "default");
        assert_eq!(
            RunningPermissionMode::default(),
            RunningPermissionMode::Default
        );
    }
}
