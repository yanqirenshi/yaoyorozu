use super::{AssistantMessage, ChainLineBase};
use serde::Deserialize;

/// AIの応答。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AssistantLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub request_id: Option<String>,
    pub message: AssistantMessage,
}
