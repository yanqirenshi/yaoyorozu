use super::UserContent;
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UserMessage {
    pub role: Option<String>,
    pub content: Option<UserContent>,
}
