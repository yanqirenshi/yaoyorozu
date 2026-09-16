use serde::Deserialize;

/// `system.level`。将来値が増える可能性があるため `Unknown` を用意する。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SystemLevel {
    Info,
    Warning,
    Error,
    Suggestion,
    #[serde(other)]
    Unknown,
}
