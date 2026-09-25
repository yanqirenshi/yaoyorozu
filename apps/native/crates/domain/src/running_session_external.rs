use crate::RunningSession;

/// app 以外(ターミナルの claude、Claude Desktop、ほかの SDK 利用)が起動した実行中セッション
/// (クラス図 `RunningSessionExternal`。issue #391)。app は台帳から存在を知るだけで、
/// 標準入出力を持たないため対話できない。右側の語彙は親([`RunningSession`])が持つものだけ。
#[derive(Debug, Clone, PartialEq)]
pub struct RunningSessionExternal {
    pub base: RunningSession,
}

impl RunningSessionExternal {
    pub fn new(base: RunningSession) -> Self {
        Self { base }
    }
}
