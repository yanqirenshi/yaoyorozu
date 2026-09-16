use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ImageBlock {
    #[serde(default)]
    pub source: serde_json::Value,
}
