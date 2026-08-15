use serde::{Deserialize, Serialize};

/// 会話を生成しているエージェントの種類。現時点では `"claude-code"` のみを返す。
/// 将来 Gemini / Codex 等が加わった際、フロントがどのアイコン・ラベルを
/// 出すか等の分岐に使う想定の席(native.md 3.4 と同様、値ではなく `code`
/// 相当の識別子として扱う)。
#[derive(Serialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum AgentKindDto {
    ClaudeCode,
}

impl From<domain::AgentKind> for AgentKindDto {
    fn from(kind: domain::AgentKind) -> Self {
        match kind {
            domain::AgentKind::ClaudeCode => AgentKindDto::ClaudeCode,
        }
    }
}

#[derive(Serialize, Clone)]
pub struct ProjectDto {
    pub name: String,
    pub updated_at: u64,
    pub agent: AgentKindDto,
}

impl From<domain::Project> for ProjectDto {
    fn from(project: domain::Project) -> Self {
        Self {
            name: project.name,
            updated_at: project.updated_at_ms,
            agent: project.agent.into(),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum RoleDto {
    User,
    Assistant,
}

impl From<domain::Role> for RoleDto {
    fn from(role: domain::Role) -> Self {
        match role {
            domain::Role::User => RoleDto::User,
            domain::Role::Assistant => RoleDto::Assistant,
        }
    }
}

#[derive(Serialize, Clone)]
pub struct MessageDto {
    pub role: RoleDto,
    pub text: String,
    pub timestamp: String,
}

impl From<domain::Message> for MessageDto {
    fn from(message: domain::Message) -> Self {
        Self {
            role: message.role.into(),
            text: message.text,
            timestamp: message.timestamp,
        }
    }
}

/// 最新セッション。`session_id` はフロントが保持し、送信時に渡すことで
/// 「表示中の会話 = 追記される会話」の一致検証(送信直前チェック)に使う。
#[derive(Serialize, Clone)]
pub struct SessionDto {
    pub session_id: String,
    pub messages: Vec<MessageDto>,
    pub agent: AgentKindDto,
}

impl From<domain::Session> for SessionDto {
    fn from(session: domain::Session) -> Self {
        Self {
            session_id: session.id,
            messages: session.messages.into_iter().map(MessageDto::from).collect(),
            agent: session.agent.into(),
        }
    }
}

/// `session:changed` イベントのペイロード。変更のあったプロジェクト(フォルダ名)
/// のみを通知し、データ本体はフロントが Query(get_latest_session 等)で
/// 取り直す(native.md §3.2)。
#[derive(Serialize, Clone)]
pub struct SessionChangedEventDto {
    pub project: String,
    pub agent: AgentKindDto,
}

/// 送信時のツール実行権限モード。フロントから送られてくるため `Deserialize` が要る
/// (他の DTO は Rust → フロントの一方向なので `Serialize` のみで足りていた)。
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum AgentModeDto {
    Chat,
    Read,
}

impl From<AgentModeDto> for app::AgentMode {
    fn from(mode: AgentModeDto) -> Self {
        match mode {
            AgentModeDto::Chat => app::AgentMode::Chat,
            AgentModeDto::Read => app::AgentMode::Read,
        }
    }
}

/// `app:warning` イベントのペイロード。送信自体は成功しているが、送信前チェックと
/// 実際の送信実行の間に別セッションが割り込んだ可能性がある場合に通知する
/// (native.md §3.2)。エラーではなく警告のため、`send_message` の戻り値ではなく
/// イベントとして届ける。
#[derive(Serialize, Clone)]
pub struct AppWarningDto {
    pub project: String,
    pub expected_session_id: String,
    pub actual_session_id: String,
}

/// `code` の一覧はフロントの分岐先(native.md §3.4)。メッセージ文字列では
/// なく必ずこの `code` で分岐すること。
#[derive(Serialize, Clone)]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
}

impl From<app::AppError> for AppErrorDto {
    fn from(error: app::AppError) -> Self {
        let (code, message) = match error {
            app::AppError::NotFound(message) => ("not_found", message),
            app::AppError::Io(message) => ("io", message),
            app::AppError::InvalidInput(message) => ("invalid_input", message),
            app::AppError::SessionStale(message) => ("session_stale", message),
            app::AppError::CliNotFound(message) => ("cli_not_found", message),
            app::AppError::CliFailed(message) => ("cli_failed", message),
            app::AppError::Timeout(message) => ("timeout", message),
            app::AppError::CwdMissing(message) => ("cwd_missing", message),
        };
        Self {
            code: code.to_string(),
            message,
        }
    }
}
