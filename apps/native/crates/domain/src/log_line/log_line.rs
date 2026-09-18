use super::{AssistantLogLine, AttachmentLogLine, LogLineBase, SystemLogLine, UserLogLine};

/// クラス図の `LogLine`(抽象クラス。issue #208)。uuid/parent_uuidで親子
/// チェーンを構成する行。行種別(user/assistant/system/attachment)ごとの
/// サブクラスに分け尽くされる。Rustでは継承を持たないため、抽象クラスを
/// enumで表現する(既存の`session_line::SessionLine`と同じ発想。ただし
/// あちらはjsonlの生パース用、こちらは変換後のドメインモデル)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogLine {
    User(UserLogLine),
    Assistant(AssistantLogLine),
    System(SystemLogLine),
    Attachment(AttachmentLogLine),
}

impl LogLine {
    /// 行種別によらない共通属性。
    pub fn base(&self) -> &LogLineBase {
        match self {
            LogLine::User(l) => &l.base,
            LogLine::Assistant(l) => &l.base,
            LogLine::System(l) => &l.base,
            LogLine::Attachment(l) => &l.base,
        }
    }
}
