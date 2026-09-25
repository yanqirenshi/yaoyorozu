/// app が起動した claude CLI プロセスの状態(クラス図 `ProcessState`。issue #391。
/// PoC #382 レポート §7.1)。app 側が持つ状態で、台帳の `status`(idle / busy)より
/// 細かい。遷移は [`crate::RunningSessionByApp::apply`] が [`crate::ProcessTrigger`] で動かす。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessState {
    /// 起動中(spawn 済みで、まだ最初の `system/init` を受けていない)。
    Starting,
    /// 待機(ターンが終わり、次の入力を待っている)。
    Idle,
    /// 実行中(入力を送り、`result` を待っている)。
    Running,
    /// 権限待ち(ツール使用の問い合わせに、まだ答えていない)。
    AwaitingPermission,
    /// 終了(戻らない)。
    Exited,
}
