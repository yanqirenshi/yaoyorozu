use super::{
    ApiErrorLine, ChainLineBase, CompactBoundaryLine, InformationalLine, StopHookSummaryLine,
};
use serde::Deserialize;

/// `system` 行は `subtype` でさらに4種に分かれる。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "subtype")]
pub enum SystemLine {
    #[serde(rename = "stop_hook_summary")]
    StopHookSummary(StopHookSummaryLine),
    #[serde(rename = "api_error")]
    ApiError(ApiErrorLine),
    #[serde(rename = "compact_boundary")]
    CompactBoundary(CompactBoundaryLine),
    #[serde(rename = "informational")]
    Informational(InformationalLine),
    #[serde(other)]
    Unknown,
}

impl SystemLine {
    pub(super) fn base(&self) -> Option<&ChainLineBase> {
        match self {
            SystemLine::StopHookSummary(l) => Some(&l.base),
            SystemLine::ApiError(l) => Some(&l.base),
            SystemLine::CompactBoundary(l) => Some(&l.base),
            SystemLine::Informational(l) => Some(&l.base),
            SystemLine::Unknown => None,
        }
    }
}
