use super::LogLineBase;

/// クラス図の `AssistantLogLine`(issue #208)。AIの応答の行
/// (`type = assistant`)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssistantLogLine {
    pub base: LogLineBase,
    pub request_id: Option<String>,
    pub message_id: Option<String>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
}
