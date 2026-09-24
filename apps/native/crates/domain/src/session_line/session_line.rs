use super::{
    AiTitleLine, AssistantLine, AtisLatchLine, AttachmentLine, ChainLineBase, CustomTitleLine,
    LastPromptLine, ModeLine, PrLinkLine, QueueOperationLine, SystemLine, UserLine,
};
use serde::Deserialize;

/// セッションログ(`.jsonl`)1行分。未知の `type`(将来のバージョンで
/// 増える可能性がある)は `Unknown` に落とし、読み飛ばす。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum SessionLine {
    #[serde(rename = "user")]
    User(UserLine),
    #[serde(rename = "assistant")]
    Assistant(AssistantLine),
    #[serde(rename = "system")]
    System(SystemLine),
    #[serde(rename = "attachment")]
    Attachment(AttachmentLine),
    #[serde(rename = "queue-operation")]
    QueueOperation(QueueOperationLine),
    #[serde(rename = "last-prompt")]
    LastPrompt(LastPromptLine),
    #[serde(rename = "custom-title")]
    CustomTitle(CustomTitleLine),
    #[serde(rename = "ai-title")]
    AiTitle(AiTitleLine),
    #[serde(rename = "mode")]
    Mode(ModeLine),
    #[serde(rename = "pr-link")]
    PrLink(PrLinkLine),
    #[serde(rename = "atis-latch")]
    AtisLatch(AtisLatchLine),
    #[serde(other)]
    Unknown,
}

impl SessionLine {
    fn base(&self) -> Option<&ChainLineBase> {
        match self {
            SessionLine::User(l) => Some(&l.base),
            SessionLine::Assistant(l) => Some(&l.base),
            SessionLine::System(l) => l.base(),
            SessionLine::Attachment(l) => Some(&l.base),
            _ => None,
        }
    }

    /// `sessionId`。会話チェーン行・セッションメタ行のどちらにも
    /// 存在する(未知の行 type のみ `None`)。
    pub fn session_id(&self) -> Option<&str> {
        match self {
            SessionLine::User(l) => l.base.session_id.as_deref(),
            SessionLine::Assistant(l) => l.base.session_id.as_deref(),
            SessionLine::System(l) => l.base().and_then(|b| b.session_id.as_deref()),
            SessionLine::Attachment(l) => l.base.session_id.as_deref(),
            SessionLine::QueueOperation(l) => l.session_id.as_deref(),
            SessionLine::LastPrompt(l) => l.session_id.as_deref(),
            SessionLine::CustomTitle(l) => l.session_id.as_deref(),
            SessionLine::AiTitle(l) => l.session_id.as_deref(),
            SessionLine::Mode(l) => l.session_id.as_deref(),
            SessionLine::PrLink(l) => l.session_id.as_deref(),
            SessionLine::AtisLatch(l) => l.session_id.as_deref(),
            SessionLine::Unknown => None,
        }
    }

    /// `cwd`。会話チェーン行のみが持つ(セッションメタ行・未知の行は
    /// `None`)。
    pub fn cwd(&self) -> Option<&str> {
        self.base().and_then(|b| b.cwd.as_deref())
    }

    /// `gitBranch`。会話チェーン行のみが持つ(セッションメタ行・未知の行は
    /// `None`)。値が `"HEAD"` はデタッチ状態を表す(issue #104)。
    pub fn git_branch(&self) -> Option<&str> {
        self.base().and_then(|b| b.git_branch.as_deref())
    }

    /// `slug`(TM: セッション別名)。会話チェーン行のみが持つ(セッションメタ
    /// 行・未知の行は `None`。オブジェクトモデル実装 第4弾。issue #197。
    /// `domain::Session.slug`)。
    pub fn slug(&self) -> Option<&str> {
        self.base().and_then(|b| b.slug.as_deref())
    }

    /// `uuid`。会話チェーン行のみが持つ(セッションメタ行・未知の行は
    /// `None`)。フォーク系列の根(root_uuid)判定に使う(issue #345)。
    pub fn uuid(&self) -> Option<&str> {
        self.base().and_then(|b| b.uuid.as_deref())
    }

    /// `parentUuid`。会話チェーン行のみが持つ。先頭行(チェーンの起点)は
    /// 欠損時と同じく `None`(issue #345の根uuid判定では「parentUuidが無い
    /// 最初の行」を根とみなせば十分で、両者の区別は不要)。
    pub fn parent_uuid(&self) -> Option<&str> {
        self.base().and_then(|b| b.parent_uuid.as_deref())
    }
}
