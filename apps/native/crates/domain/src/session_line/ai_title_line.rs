use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiTitleLine {
    pub ai_title: Option<String>,
    pub session_id: Option<String>,
}
