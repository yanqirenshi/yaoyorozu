use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HookInfo {
    pub command: Option<String>,
    pub duration_ms: Option<u64>,
}
