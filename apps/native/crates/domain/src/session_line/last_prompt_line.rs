use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LastPromptLine {
    pub last_prompt: Option<String>,
    pub leaf_uuid: Option<String>,
    pub session_id: Option<String>,
}
