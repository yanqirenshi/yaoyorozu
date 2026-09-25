/// 画面へ流す途中経過(クラス図 `ProgressEvent`。issue #391)。
///
/// claude CLI の wire 形式(stream_event / system / result / control_request などの
/// JSON 行)は infra が読む DTO であり、domain には置かない(版で項目が増えるため)。
/// domain にはこの CLI に依存しない中立の型だけを置き、infra が wire → domain に写す。
/// 保存しない(画面へ流すだけ。確定した応答は会話ファイルの AI 応答行が受ける)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProgressEvent {
    /// 文章の断片が届いた。
    TextDelta { text: String },
    /// ツールの実行が始まった。
    ToolStarted {
        tool_use_id: String,
        tool_name: String,
    },
    /// ツールの結果が届いた。
    ToolResultArrived { tool_use_id: String, is_error: bool },
    /// ターンが終わった。失敗のときは、送信した行を会話に残さない判断に使う
    /// (#352 で残った件)。
    TurnFinished { succeeded: bool },
    /// 送信した行の `uuid` が確定した(`--replay-user-messages`)。画面上の「送信中」の行と
    /// 会話ファイルの行を結ぶ。
    SentLineConfirmed { uuid: String },
}
