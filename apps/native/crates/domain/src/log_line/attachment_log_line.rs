use super::LogLineBase;

/// クラス図の `AttachmentLogLine`(issue #208)。実行環境が会話に注入した
/// 情報の行(`type = attachment`)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentLogLine {
    pub base: LogLineBase,
    pub attachment_type: String,
}
