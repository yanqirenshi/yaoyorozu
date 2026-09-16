use super::{ChainLineBase, HookInfo, SystemLevel};
use serde::Deserialize;

/// ターン終了時に実行されたフックの結果。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StopHookSummaryLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub level: Option<SystemLevel>,
    pub hook_count: Option<u64>,
    pub hook_infos: Vec<HookInfo>,
    pub prevented_continuation: Option<bool>,
    pub stop_reason: Option<String>,
    pub has_output: Option<bool>,
    #[serde(rename = "toolUseID")]
    pub tool_use_id: Option<String>,
}
