use super::{AssistantContentBlock, Usage};
use serde::Deserialize;

/// `assistant.message`。Anthropic Messages API のレスポンス形式のため、
/// フィールド名はAPI側のsnake_case規約に従う(Claude Code独自の
/// ラッパーフィールド(`ChainLineBase`等)のcamelCaseとは別系統)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AssistantMessage {
    pub id: Option<String>,
    pub role: Option<String>,
    pub model: Option<String>,
    pub content: Vec<AssistantContentBlock>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub usage: Option<Usage>,
}
