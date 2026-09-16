use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ToolUseBlock {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub input: serde_json::Value,
}
