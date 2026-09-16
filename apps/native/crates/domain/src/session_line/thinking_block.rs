use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ThinkingBlock {
    pub thinking: String,
    pub signature: String,
}
