use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AtisLatchLine {
    pub atis: Option<String>,
    pub session_id: Option<String>,
}
