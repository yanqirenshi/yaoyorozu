use super::{ApiErrorDetail, ChainLineBase};
use serde::Deserialize;

/// API 呼び出しの失敗とリトライ。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApiErrorLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub error: ApiErrorDetail,
    pub retry_in_ms: Option<u64>,
    pub retry_attempt: Option<u64>,
    pub max_retries: Option<u64>,
    pub source: Option<String>,
}
