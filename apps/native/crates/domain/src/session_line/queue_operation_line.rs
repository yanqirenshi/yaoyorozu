use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QueueOperationLine {
    pub operation: Option<String>,
    pub timestamp: Option<String>,
    pub session_id: Option<String>,
    pub content: Option<String>,
}
