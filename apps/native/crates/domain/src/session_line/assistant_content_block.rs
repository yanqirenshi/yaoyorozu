use super::{TextBlock, ThinkingBlock, ToolUseBlock};
use serde::Deserialize;

/// `assistant.message.content` の要素。表示対象は `Text` のみ
/// (`Thinking`/`ToolUse` は非表示。issue #39 の制約: 現行方針を維持)。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum AssistantContentBlock {
    #[serde(rename = "text")]
    Text(TextBlock),
    #[serde(rename = "thinking")]
    Thinking(ThinkingBlock),
    #[serde(rename = "tool_use")]
    ToolUse(ToolUseBlock),
    #[serde(other)]
    Unknown,
}
