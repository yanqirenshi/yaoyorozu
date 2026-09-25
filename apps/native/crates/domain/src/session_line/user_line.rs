use super::{ChainLineBase, UserContent, UserContentBlock, UserMessage, UserOrigin};
use serde::Deserialize;

/// ユーザー入力(`content` が文字列)またはツール実行結果
/// (`content` が配列)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UserLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub message: UserMessage,
    pub prompt_id: Option<String>,
    pub permission_mode: Option<String>,
    pub tool_use_result: Option<serde_json::Value>,
    /// 入力の出どころ(他のセッションから届いたメッセージは `kind: "peer"`。issue #437)。
    pub origin: Option<UserOrigin>,
    #[serde(rename = "sourceToolAssistantUUID")]
    pub source_tool_assistant_uuid: Option<String>,
}

impl UserLine {
    /// `content` の画像ブロックのうち、表示できるもの(base64 ソース・対応形式)を
    /// `(形式, base64データ)` で順に返す。メッセージの「画像 n 枚」の枚数と、
    /// オンデマンドで取り出す画像の両方がこれを元にする(issue #349)。
    pub fn base64_images(&self) -> Vec<(crate::ImageMediaType, &str)> {
        match &self.message.content {
            Some(UserContent::Blocks(blocks)) => blocks
                .iter()
                .filter_map(|block| match block {
                    UserContentBlock::Image(image) => image.base64_source(),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        }
    }
}
