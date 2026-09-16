use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ToolResultBlock {
    #[serde(default, rename = "tool_use_id")]
    pub tool_use_id: String,
    #[serde(default)]
    pub content: serde_json::Value,
    #[serde(default, rename = "is_error")]
    pub is_error: Option<bool>,
}
