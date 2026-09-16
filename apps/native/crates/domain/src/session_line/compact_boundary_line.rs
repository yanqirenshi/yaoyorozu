use super::{ChainLineBase, CompactMetadata};
use serde::Deserialize;

/// `/compact` による履歴圧縮の境界。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompactBoundaryLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub logical_parent_uuid: Option<String>,
    pub content: Option<String>,
    pub is_meta: Option<bool>,
    pub compact_metadata: CompactMetadata,
}
