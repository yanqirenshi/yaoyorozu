//! 複数の実行中セッションを画面へ渡すための、app の読み取り専用の型(issue #407。Phase 2。
//! クラス図 `classes-domain.ts` の【Phase 2 の申し送り】(d)(e))。
//!
//! domain の [`ProgressEvent`] は CLI にも複数セッションにも依存しない中立の型のまま変えず、
//! 宛先([`RunningSessionRef`])を付けた包みをここに置く。一覧の項目([`RunningSessionSummary`])
//! は [`RunningSessionByApp`] からの純粋な変換([`summarize`])で作る。

use crate::RunningSessionEvent;
use domain::{ProcessState, ProgressEvent, RunningSessionByApp};
use std::path::PathBuf;

/// 実行中セッション(app が起動した子プロセス)1つの宛先。個体指定子は `pid_domain` + `pid` +
/// `started_at`(pid は OS が使い回すので、単独では個体を指定できない。domain の
/// `RunningSession` と同じ)。画面はこれを持ち回って、送信・応答・購読の対象を指定する。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RunningSessionRef {
    pub pid_domain: String,
    pub pid: u32,
    pub started_at: u64,
}

impl RunningSessionRef {
    pub fn of(session: &RunningSessionByApp) -> Self {
        Self {
            pid_domain: session.base.pid_domain.clone(),
            pid: session.base.pid,
            started_at: session.base.started_at,
        }
    }

    /// `session` がこの宛先の個体か。
    pub fn matches(&self, session: &RunningSessionByApp) -> bool {
        session.base.pid == self.pid
            && session.base.started_at == self.started_at
            && session.base.pid_domain == self.pid_domain
    }
}

/// 宛先を付けた途中経過。Channel(画面ごとの購読)で流す。
#[derive(Debug, Clone, PartialEq)]
pub struct AddressedProgress {
    pub target: RunningSessionRef,
    pub event: ProgressEvent,
}

/// 宛先を付けた、実行中セッションからの出来事。子プロセスごとの受け口は宛先を知らない
/// (pid は起動してから分かる)ので、tauri 層の処理タスクが宛先を付けて状態へ反映する。
#[derive(Debug, Clone, PartialEq)]
pub struct AddressedRunningSessionEvent {
    pub target: RunningSessionRef,
    pub event: RunningSessionEvent,
}

impl AddressedRunningSessionEvent {
    /// 画面へ流す途中経過([`RunningSessionEvent::Progress`])なら、宛先付きで取り出す。
    pub fn as_progress(&self) -> Option<AddressedProgress> {
        match &self.event {
            RunningSessionEvent::Progress(progress) => Some(AddressedProgress {
                target: self.target.clone(),
                event: progress.clone(),
            }),
            _ => None,
        }
    }
}

/// ハブなどが並べる、実行中セッション1つの一覧項目(読み取り専用)。答え待ちの問い合わせの
/// 中身は持たない(数だけ。中身は `get_running_session` で取る)。
#[derive(Debug, Clone, PartialEq)]
pub struct RunningSessionSummary {
    pub target: RunningSessionRef,
    pub session_id: String,
    pub repository_path: PathBuf,
    pub process_state: ProcessState,
    pub pending_permission_count: usize,
    pub current_model: Option<String>,
    pub current_permission_mode: Option<String>,
    pub cwd: Option<PathBuf>,
    /// 起動した `claude` の版(`claude --version` の出力。読めなければ `None`。issue #437)。
    pub cli_version: Option<String>,
    /// セッション間メッセージに使える版か(`None` は版が分からない)。使えない版なら、状態バー・
    /// 一覧に警告を出す(起動は止めない)。
    pub peer_messaging: Option<bool>,
    /// 起動時に付けた表示名(`--name`)。会話ファイルができる前(新規作成の直後)は、会話の
    /// タイトルがまだ無いので、一覧はこれを名前に使える(申し送り(e)への追加。issue #407)。
    pub name: Option<String>,
}

/// [`RunningSessionByApp`] から一覧項目を作る(純粋な変換)。
pub fn summarize(session: &RunningSessionByApp) -> RunningSessionSummary {
    RunningSessionSummary {
        target: RunningSessionRef::of(session),
        session_id: session.base.session_id.clone(),
        repository_path: session.repository_path.clone(),
        process_state: session.process_state,
        pending_permission_count: session.permission_requests.len(),
        current_model: session.current_model.clone(),
        current_permission_mode: session.current_permission_mode.clone(),
        cwd: session.base.cwd.clone(),
        cli_version: session.base.version.clone(),
        peer_messaging: session
            .base
            .version
            .as_deref()
            .and_then(crate::supports_peer_messaging),
        name: session.base.name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{PermissionRequest, RunningSession};

    fn session(session_id: &str, pid: u32, started_at: u64) -> RunningSessionByApp {
        let mut base = RunningSession::new(session_id, "windows:PC", pid, started_at);
        base.cwd = Some(PathBuf::from("/work/wt"));
        base.name = Some("調査".to_string());
        RunningSessionByApp::new(base, PathBuf::from("/repo"), "wt-1", started_at)
    }

    fn request(id: &str) -> PermissionRequest {
        PermissionRequest {
            request_id: id.to_string(),
            tool_name: "Write".to_string(),
            display_name: None,
            description: None,
            tool_use_id: "t".to_string(),
            tool_input: serde_json::json!({}),
            blocked_path: None,
            requested_at: 1,
            suggestions: Vec::new(),
        }
    }

    #[test]
    fn the_ref_is_the_pid_domain_pid_and_started_at() {
        let s = session("s1", 100, 5);

        let target = RunningSessionRef::of(&s);

        assert_eq!(target.pid_domain, "windows:PC");
        assert_eq!(target.pid, 100);
        assert_eq!(target.started_at, 5);
        assert!(target.matches(&s));
    }

    #[test]
    fn a_reused_pid_with_another_start_time_is_a_different_individual() {
        // pid は OS が使い回す。同じ pid でも起動日時が違えば別の実行中セッション。
        let old = session("s1", 100, 5);
        let reused = session("s2", 100, 900);

        assert!(!RunningSessionRef::of(&old).matches(&reused));
        assert_ne!(RunningSessionRef::of(&old), RunningSessionRef::of(&reused));
    }

    #[test]
    fn summarize_copies_the_listed_fields() {
        let mut s = session("s1", 100, 5);
        s.apply(domain::ProcessTrigger::Initialized, 6);
        s.apply(domain::ProcessTrigger::MessageSent, 7);
        s.receive_permission_request(request("a"), 8);
        s.receive_permission_request(request("b"), 9);
        s.current_model = Some("claude-opus-4-7".to_string());
        s.current_permission_mode = Some("plan".to_string());

        let summary = summarize(&s);

        assert_eq!(summary.target, RunningSessionRef::of(&s));
        assert_eq!(summary.session_id, "s1");
        assert_eq!(summary.repository_path, PathBuf::from("/repo"));
        assert_eq!(summary.process_state, ProcessState::AwaitingPermission);
        assert_eq!(summary.pending_permission_count, 2);
        assert_eq!(summary.current_model.as_deref(), Some("claude-opus-4-7"));
        assert_eq!(summary.current_permission_mode.as_deref(), Some("plan"));
        assert_eq!(summary.cwd, Some(PathBuf::from("/work/wt")));
        assert_eq!(summary.name.as_deref(), Some("調査"));
        assert_eq!(summary.cli_version, None);
        assert_eq!(summary.peer_messaging, None, "版が分からなければ分からない");
    }

    #[test]
    fn summarize_says_whether_the_cli_supports_peer_messaging() {
        let mut old = session("s1", 100, 5);
        old.base.version = Some("2.1.150 (Claude Code)".to_string());
        let mut new = session("s2", 101, 5);
        new.base.version = Some("2.1.280 (Claude Code)".to_string());

        assert_eq!(summarize(&old).peer_messaging, Some(false));
        assert_eq!(summarize(&new).peer_messaging, Some(true));
        assert_eq!(
            summarize(&old).cli_version.as_deref(),
            Some("2.1.150 (Claude Code)")
        );
    }

    #[test]
    fn only_progress_events_are_addressed_to_the_screens() {
        let target = RunningSessionRef::of(&session("s1", 100, 5));
        let progress = AddressedRunningSessionEvent {
            target: target.clone(),
            event: RunningSessionEvent::Progress(ProgressEvent::TextDelta {
                text: "a".to_string(),
            }),
        };
        let other = AddressedRunningSessionEvent {
            target: target.clone(),
            event: RunningSessionEvent::Initialized,
        };

        assert_eq!(
            progress.as_progress(),
            Some(AddressedProgress {
                target,
                event: ProgressEvent::TextDelta {
                    text: "a".to_string()
                }
            })
        );
        assert_eq!(other.as_progress(), None);
    }
}
