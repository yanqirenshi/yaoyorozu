use super::LogLineBase;

/// クラス図の `SystemLogLine`(issue #208)。内部イベントの行
/// (`type = system`)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemLogLine {
    pub base: LogLineBase,
    pub subtype: String,
    pub level: Option<String>,
}
