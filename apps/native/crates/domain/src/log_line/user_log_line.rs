use super::LogLineBase;

/// クラス図の `UserLogLine`(issue #208)。人間の入力とツール実行結果の行
/// (`type = user`)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserLogLine {
    pub base: LogLineBase,
    pub prompt_id: Option<String>,
    pub permission_mode: Option<String>,
}
