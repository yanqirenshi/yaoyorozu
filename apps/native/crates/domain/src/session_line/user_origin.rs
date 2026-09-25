use serde::Deserialize;

/// user 行の `origin`(その入力がどこから来たか。issue #437。PoC #429 レポート §5.1)。
/// 他の Claude セッションから `SendMessage` で届いたメッセージは `kind: "peer"` で、封筒
/// (`<cross-session-message>`)を剥いだ本文が `body` に入る(画面に出すなら `body` を使えばよく、
/// 封筒を自前で解釈しない)。読む側は寛容にする(版で項目が増える)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UserOrigin {
    /// 入力の出どころの種別(`peer` など)。
    pub kind: Option<String>,
    /// 送り元の受信口(`uds:\\.\pipe\LOCAL\cc-msg-…`)。
    pub from: Option<String>,
    /// 送り元の名前(`--name` / Desktop のタブ名)。
    pub name: Option<String>,
    /// 送り元の権限モードのクラス(`prompting` / `bypass`)。
    #[serde(rename = "fromMode")]
    pub from_mode: Option<String>,
    /// 送り元が Desktop のセッションのときの ID(CLI 由来には無い)。
    #[serde(rename = "fromSession")]
    pub from_session: Option<String>,
    /// 送信側の `msg_id`(送信側の `SendMessage` の結果と突き合わせられる)。
    #[serde(rename = "msg_id")]
    pub msg_id: Option<String>,
    /// 封筒を剥いだ本文。
    pub body: Option<String>,
}

impl UserOrigin {
    /// 他のセッションから届いたメッセージか。
    pub fn is_peer(&self) -> bool {
        self.kind.as_deref() == Some("peer")
    }
}
