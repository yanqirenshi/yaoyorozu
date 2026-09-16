use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct TextBlock {
    #[serde(default)]
    pub text: String,
}
