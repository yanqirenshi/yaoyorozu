use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApiErrorDetail {
    pub message: Option<String>,
    pub formatted: Option<String>,
    pub is_network_down: Option<bool>,
}
