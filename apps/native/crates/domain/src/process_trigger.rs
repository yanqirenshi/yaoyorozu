/// [`crate::ProcessState`] を動かす出来事(クラス図 `ProcessTrigger`。issue #391)。
/// [`crate::RunningSessionByApp::apply`] の入力で、app が子プロセスとのやり取りから決める。
/// 状態遷移の入力であり保存しない(TM には無い)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessTrigger {
    /// 最初の `system/init` を受けた(起動中 → 待機)。
    Initialized,
    /// 入力を送った(待機 → 実行中)。
    MessageSent,
    /// CLI がターンを始めた(`message_start`。待機 → 実行中)。app からの送信を介さずに
    /// ターンが始まった場合(セッション間メッセージなど、CLI 自身が始めたターン)に、
    /// `MessageSent` を補う(issue #501)。
    TurnStarted,
    /// ツール使用の問い合わせが届いた(実行中 → 権限待ち)。
    PermissionAsked,
    /// 問い合わせが決着した(応答した・取り消された。権限待ち → 実行中)。
    PermissionSettled,
    /// ターンが終わった(`result`。実行中 → 待機)。
    TurnFinished,
    /// プロセスが終了した(どの状態からでも → 終了)。
    Exited,
}
