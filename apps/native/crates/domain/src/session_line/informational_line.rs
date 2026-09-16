use super::ChainLineBase;
use serde::Deserialize;

/// 情報通知(スキル引数の警告など)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InformationalLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub content: Option<String>,
    pub is_meta: Option<bool>,
}
