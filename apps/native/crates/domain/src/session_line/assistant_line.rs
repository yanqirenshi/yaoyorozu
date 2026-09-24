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
    /// AI への問い合わせの失敗を示すエラー行(`model` は `<synthetic>`)かどうか
    /// (issue #364)。`model` が `<synthetic>` なだけの行(`No response requested.` など、
    /// 失敗ではないもの)は `false` で出るため、この項目だけを判別に使う。
    pub is_api_error_message: Option<bool>,
}
