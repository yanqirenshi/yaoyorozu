use super::{ImageBlock, TextBlock, ToolResultBlock};
use serde::Deserialize;

/// `user.message.content` が配列の場合の要素。表示対象は `Text` のみ
/// (`ToolResult`/`Image` は非表示。現行方針を維持)。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum UserContentBlock {
    #[serde(rename = "tool_result")]
    ToolResult(ToolResultBlock),
    #[serde(rename = "text")]
    Text(TextBlock),
    #[serde(rename = "image")]
    Image(ImageBlock),
    #[serde(other)]
    Unknown,
}
