use crate::{PermissionRequest, ProcessState, ProcessTrigger, RunningSession};
use std::path::PathBuf;

/// app が子プロセスとして起動した claude CLI(クラス図 `RunningSessionByApp`。issue #391。
/// PoC #382)。標準入出力(stream-json)で対話し続けるため、このサブクラスだけがプロセスの
/// 状態と、答え待ちの権限の問い合わせを持つ。
///
/// 台帳は外部起動と同じ形で書かれる(`entrypoint` は `sdk-cli`)ので台帳では区別できず、
/// app が自分の子プロセスの PID を知っていることで区分する。#361 のガード(実行中の検知)では
/// app は自分が起動した PID を除外する。
#[derive(Debug, Clone, PartialEq)]
pub struct RunningSessionByApp {
    pub base: RunningSession,
    pub process_state: ProcessState,
    /// 状態を最後に変えた日時(epoch ms)。
    pub process_state_at: u64,
    /// まだ答えていない権限の問い合わせ(届いた順。0..*)。
    pub permission_requests: Vec<PermissionRequest>,
    /// いま送るときに使われるモデル(TM: 現在のモデル。issue #407)。CLI の `system/init` の
    /// `model` か、`set_model` の結果。起動直後は CLI が最初のターンで `init` を出すまで分からない
    /// (`None`)。モデル名は版で変わるので文字列のまま持つ。
    pub current_model: Option<String>,
    /// いま送るときに使われる権限モード(TM: 現在の権限モード)。CLI の `system/init` の
    /// `permissionMode` か、`set_permission_mode` の結果。CLI の版で名前が変わる
    /// (`default` / `manual`)ため文字列で持つ(対応づけは app の責務)。
    pub current_permission_mode: Option<String>,
    /// この実行中セッションを動かすリポジトリ(`GitRepository.repository_path` への参照。R)。
    /// app が起動時にプロファイル(登録済みリポジトリ)から選んだ記録された事実で、cwd からの
    /// 推測ではない(cwd はリポジトリの worktree など別の場所でもありうる)。
    pub repository_path: PathBuf,
    /// 起動した worktree(`GitWorktree.worktree_id`への参照。R。TM: ワーキングツリーID。
    /// issue #437。Phase 3)。app が起動時に「このリポジトリの、このブランチの worktree」を
    /// 用意して選ぶので、cwd からの推測ではなく記録された事実になる。リポジトリ本体で起動した
    /// ときは [`crate::MAIN_WORKTREE_ID`]、worktree のどれでもない場所なら
    /// [`crate::OUTSIDE_WORKTREE_ID`]。`repository_path` は、worktree を指す鍵(worktree_id +
    /// リポジトリパス)の片方として残る。
    pub worktree_id: String,
}

impl RunningSessionByApp {
    /// 起動直後(`Starting`)の状態で作る。現在のモデル・権限モードは分かったときに
    /// [`Self::observe_configuration`] などで入れる(起動時に選んだ権限モードは呼び出し側が入れる)。
    pub fn new(
        base: RunningSession,
        repository_path: PathBuf,
        worktree_id: &str,
        at_time: u64,
    ) -> Self {
        Self {
            worktree_id: worktree_id.to_string(),
            base,
            process_state: ProcessState::Starting,
            process_state_at: at_time,
            permission_requests: Vec::new(),
            current_model: None,
            current_permission_mode: None,
            repository_path,
        }
    }

    /// CLI が報告した現在の設定(`system/init` の `model` / `permissionMode`)を反映する。
    /// 値のあるものだけ更新する(欠けた項目では、分かっている値を消さない)。
    pub fn observe_configuration(
        &mut self,
        model: Option<String>,
        permission_mode: Option<String>,
    ) {
        if model.is_some() {
            self.current_model = model;
        }
        if permission_mode.is_some() {
            self.current_permission_mode = permission_mode;
        }
    }

    /// 状態遷移(純粋な関数。I/O は port の責務)。入口・出口は PoC #382 レポート §7.1:
    ///
    /// | 契機 | 遷移 |
    /// |---|---|
    /// | `Initialized` | 起動中 → 待機 |
    /// | `MessageSent` | 待機 → 実行中 |
    /// | `PermissionAsked` | 実行中 → 権限待ち |
    /// | `PermissionSettled` | 権限待ち → 実行中 |
    /// | `TurnFinished` | 実行中 → 待機 |
    /// | `Exited` | どの状態からでも → 終了 |
    ///
    /// 表にない組み合わせは状態を変えない(実行中に次の入力を送っても実行中のまま。キューは
    /// CLI 側)。終了は戻らない。状態が変わったときだけ `at_time` を `process_state_at` に
    /// 記録する(変わらなかったときは「状態を最後に変えた日時」を動かさない)。
    pub fn apply(&mut self, trigger: ProcessTrigger, at_time: u64) {
        use ProcessState as S;
        use ProcessTrigger as T;
        let next = match (self.process_state, trigger) {
            (S::Exited, _) => S::Exited,
            (_, T::Exited) => S::Exited,
            (S::Starting, T::Initialized) => S::Idle,
            (S::Idle, T::MessageSent) => S::Running,
            (S::Running, T::PermissionAsked) => S::AwaitingPermission,
            (S::AwaitingPermission, T::PermissionSettled) => S::Running,
            (S::Running, T::TurnFinished) => S::Idle,
            (state, _) => state,
        };
        if next != self.process_state {
            self.process_state = next;
            self.process_state_at = at_time;
        }
    }

    /// 権限の問い合わせを受け取る。答え待ちの列に足し(同じ `request_id` は足さない)、
    /// 状態を `PermissionAsked` で動かす。
    pub fn receive_permission_request(&mut self, request: PermissionRequest, at_time: u64) {
        if self
            .permission_requests
            .iter()
            .any(|r| r.request_id == request.request_id)
        {
            return;
        }
        self.permission_requests.push(request);
        self.apply(ProcessTrigger::PermissionAsked, at_time);
    }

    /// 権限の問い合わせが決着した(応答した・CLI が取り下げた)。答え待ちの列から外し、
    /// 答え待ちが無くなったら `PermissionSettled` で状態を動かす。外した問い合わせを返す
    /// (列に無ければ `None`。状態は動かさない)。
    pub fn settle_permission_request(
        &mut self,
        request_id: &str,
        at_time: u64,
    ) -> Option<PermissionRequest> {
        let index = self
            .permission_requests
            .iter()
            .position(|r| r.request_id == request_id)?;
        let removed = self.permission_requests.remove(index);
        if self.permission_requests.is_empty() {
            self.apply(ProcessTrigger::PermissionSettled, at_time);
        }
        Some(removed)
    }

    /// プロセスが終了した。答え待ちの問い合わせは答えようがなくなるので捨てる。
    pub fn exit(&mut self, at_time: u64) {
        self.permission_requests.clear();
        self.apply(ProcessTrigger::Exited, at_time);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ProcessState::*;
    use ProcessTrigger::*;

    fn session() -> RunningSessionByApp {
        RunningSessionByApp::new(
            RunningSession::new("s1", "windows:PC", 100, 1),
            PathBuf::from("/repo"),
            "wt-1",
            10,
        )
    }

    fn in_state(state: ProcessState) -> RunningSessionByApp {
        let mut s = session();
        s.process_state = state;
        s
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
    fn a_new_session_starts_in_starting_at_the_given_time() {
        let s = session();

        assert_eq!(s.process_state, Starting);
        assert_eq!(s.process_state_at, 10);
        assert!(s.permission_requests.is_empty());
    }

    #[test]
    fn a_new_session_knows_its_repository_but_not_yet_its_model_or_mode() {
        let s = session();

        assert_eq!(s.repository_path, PathBuf::from("/repo"));
        assert_eq!(s.worktree_id, "wt-1");
        assert_eq!(s.current_model, None);
        assert_eq!(s.current_permission_mode, None);
    }

    #[test]
    fn observing_the_configuration_updates_only_the_values_that_are_present() {
        let mut s = session();

        s.observe_configuration(
            Some("claude-opus-4-7".to_string()),
            Some("default".to_string()),
        );
        assert_eq!(s.current_model.as_deref(), Some("claude-opus-4-7"));
        assert_eq!(s.current_permission_mode.as_deref(), Some("default"));

        // 項目が欠けた報告では、分かっている値を消さない。
        s.observe_configuration(None, Some("plan".to_string()));
        assert_eq!(s.current_model.as_deref(), Some("claude-opus-4-7"));
        assert_eq!(s.current_permission_mode.as_deref(), Some("plan"));

        s.observe_configuration(None, None);
        assert_eq!(s.current_permission_mode.as_deref(), Some("plan"));
    }

    /// 遷移表の全行(クラス図のコメント)。
    #[test]
    fn apply_follows_every_row_of_the_transition_table() {
        let table = [
            (Starting, Initialized, Idle),
            (Idle, MessageSent, Running),
            (Running, PermissionAsked, AwaitingPermission),
            (AwaitingPermission, PermissionSettled, Running),
            (Running, TurnFinished, Idle),
        ];
        for (from, trigger, to) in table {
            let mut s = in_state(from);

            s.apply(trigger, 99);

            assert_eq!(s.process_state, to, "{from:?} --{trigger:?}--> {to:?}");
            assert_eq!(s.process_state_at, 99, "遷移したときは日時が記録される");
        }
    }

    #[test]
    fn exited_is_reachable_from_every_state() {
        for from in [
            Starting,
            Idle,
            Running,
            AwaitingPermission,
            ProcessState::Exited,
        ] {
            let mut s = in_state(from);

            s.apply(ProcessTrigger::Exited, 50);

            assert_eq!(s.process_state, ProcessState::Exited, "{from:?}");
        }
    }

    #[test]
    fn combinations_outside_the_table_do_not_change_the_state_or_the_time() {
        let all = [
            Initialized,
            MessageSent,
            PermissionAsked,
            PermissionSettled,
            TurnFinished,
            ProcessTrigger::Exited,
        ];
        let valid = [
            (Starting, Initialized),
            (Idle, MessageSent),
            (Running, PermissionAsked),
            (AwaitingPermission, PermissionSettled),
            (Running, TurnFinished),
        ];
        for from in [Starting, Idle, Running, AwaitingPermission] {
            for trigger in all {
                if trigger == ProcessTrigger::Exited || valid.contains(&(from, trigger)) {
                    continue;
                }
                let mut s = in_state(from);

                s.apply(trigger, 99);

                assert_eq!(s.process_state, from, "{from:?} + {trigger:?} は不正遷移");
                assert_eq!(s.process_state_at, 10, "変わらなければ日時も動かさない");
            }
        }
    }

    #[test]
    fn sending_again_while_running_stays_running() {
        let mut s = in_state(Running);

        s.apply(MessageSent, 99);

        assert_eq!(s.process_state, Running);
    }

    #[test]
    fn exited_never_comes_back() {
        let mut s = in_state(ProcessState::Exited);

        for trigger in [Initialized, MessageSent, PermissionAsked, TurnFinished] {
            s.apply(trigger, 99);
        }

        assert_eq!(s.process_state, ProcessState::Exited);
        assert_eq!(s.process_state_at, 10, "終了後の契機は日時も動かさない");
    }

    #[test]
    fn a_permission_request_moves_running_to_awaiting_and_settling_the_last_one_moves_back() {
        let mut s = in_state(Running);

        s.receive_permission_request(request("a"), 20);
        assert_eq!(s.process_state, AwaitingPermission);
        assert_eq!(s.permission_requests.len(), 1);

        let settled = s.settle_permission_request("a", 30);

        assert_eq!(settled.map(|r| r.request_id), Some("a".to_string()));
        assert_eq!(s.process_state, Running);
        assert_eq!(s.process_state_at, 30);
        assert!(s.permission_requests.is_empty());
    }

    #[test]
    fn stays_awaiting_until_every_request_is_settled() {
        let mut s = in_state(Running);
        s.receive_permission_request(request("a"), 20);
        s.receive_permission_request(request("b"), 21);

        s.settle_permission_request("a", 30);
        assert_eq!(s.process_state, AwaitingPermission);

        s.settle_permission_request("b", 31);
        assert_eq!(s.process_state, Running);
    }

    #[test]
    fn a_duplicate_or_unknown_request_id_changes_nothing() {
        let mut s = in_state(Running);
        s.receive_permission_request(request("a"), 20);
        s.receive_permission_request(request("a"), 21);
        assert_eq!(s.permission_requests.len(), 1);

        assert!(s.settle_permission_request("nope", 30).is_none());
        assert_eq!(s.process_state, AwaitingPermission);
    }

    #[test]
    fn exit_drops_pending_requests_and_ends_the_session() {
        let mut s = in_state(Running);
        s.receive_permission_request(request("a"), 20);

        s.exit(40);

        assert_eq!(s.process_state, ProcessState::Exited);
        assert_eq!(s.process_state_at, 40);
        assert!(s.permission_requests.is_empty());
    }
}
