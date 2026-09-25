/// メッセージの種類(表示のための見分け。issue #437。会話ファイルは書き換えない)。
/// セッション間メッセージ(CLI の `SendMessage`。PoC #429)の受信・送信・送信の結果を、
/// 通常の会話と見分けて出すために使う。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum MessageKind {
    /// 通常のメッセージ。
    #[default]
    Normal,
    /// 他のセッションから届いたメッセージ(`origin.kind == "peer"` の user 行)。本文は封筒を
    /// 剥いだもの。
    PeerReceived {
        /// 送り元の名前。
        from_name: Option<String>,
    },
    /// 他のセッションへ送った(`SendMessage` の tool_use の行)。本文は送った文。
    PeerSent {
        /// 宛先(名前または受信口のアドレス)。
        to: String,
        /// 結果の行との突き合わせに使う `tool_use` の ID。
        tool_use_id: String,
    },
    /// 送信の結果(`SendMessage` の tool_result の行)。本文は結果の説明。
    PeerSendResult { success: bool, tool_use_id: String },
}
