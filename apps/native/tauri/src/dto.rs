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

/// セッション一覧(設定画面のセッション選択)の1件分。
#[derive(Serialize, Clone)]
pub struct SessionSummaryDto {
    pub id: String,
    pub updated_at: u64,
    pub excerpt: String,
}

impl From<domain::SessionSummary> for SessionSummaryDto {
    fn from(summary: domain::SessionSummary) -> Self {
        Self {
            id: summary.id,
            updated_at: summary.updated_at_ms,
            excerpt: summary.excerpt,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GithubProjectDto {
    pub owner: String,
    pub number: u32,
}

impl From<domain::GithubProject> for GithubProjectDto {
    fn from(project: domain::GithubProject) -> Self {
        Self {
            owner: project.owner,
            number: project.number,
        }
    }
}

impl From<GithubProjectDto> for domain::GithubProject {
    fn from(project: GithubProjectDto) -> Self {
        Self {
            owner: project.owner,
            number: project.number,
        }
    }
}

/// `get_settings` の戻り値。
#[derive(Serialize, Clone)]
pub struct SettingsDto {
    pub repository_path: Option<String>,
    pub github_project: Option<GithubProjectDto>,
    pub selected_session_ids: Vec<String>,
}

impl From<domain::Settings> for SettingsDto {
    fn from(settings: domain::Settings) -> Self {
        Self {
            repository_path: settings.repository_path.map(|p| p.display().to_string()),
            github_project: settings.github_project.map(GithubProjectDto::from),
            selected_session_ids: settings.selected_session_ids,
        }
    }
}

/// `update_settings` の引数。スキーマ `version` はフロントが関知しない
/// (常に現行バージョンとして保存する)ため含めない。
#[derive(Deserialize, Clone)]
pub struct SettingsInputDto {
    pub repository_path: Option<String>,
    pub github_project: Option<GithubProjectDto>,
    pub selected_session_ids: Vec<String>,
}

impl From<SettingsInputDto> for domain::Settings {
    fn from(input: SettingsInputDto) -> Self {
        Self {
            version: domain::CURRENT_SETTINGS_VERSION,
            repository_path: input.repository_path.map(std::path::PathBuf::from),
            github_project: input.github_project.map(domain::GithubProject::from),
            selected_session_ids: input.selected_session_ids,
        }
    }
}

/// `settings:corrupted` イベントのペイロード。起動時に設定ファイルの破損を
/// 検知し、デフォルト値へフォールバックした場合に通知する(native.md §2)。
#[derive(Serialize, Clone)]
pub struct SettingsCorruptedEventDto {
    pub message: String,
}

/// `github_login_start` の戻り値。ユーザーに見せてよいのはこの2項目のみ
/// (トークンは含めない。native.md §4 NEVER)。
#[derive(Serialize, Clone)]
pub struct DeviceCodeDto {
    pub user_code: String,
    pub verification_uri: String,
}

impl From<app::DeviceAuthorization> for DeviceCodeDto {
    fn from(authorization: app::DeviceAuthorization) -> Self {
        Self {
            user_code: authorization.user_code,
            verification_uri: authorization.verification_uri,
        }
    }
}

/// `get_github_auth_status` の戻り値。
#[derive(Serialize, Clone)]
pub struct GithubAuthStatusDto {
    pub authenticated: bool,
    pub login: Option<String>,
}

/// GitHub Projects(v2) 一覧の1件分(設定画面のプロジェクト選択に使う)。
#[derive(Serialize, Clone)]
pub struct GithubProjectSummaryDto {
    pub number: u32,
    pub title: String,
    pub closed: bool,
}

impl From<domain::GithubProjectSummary> for GithubProjectSummaryDto {
    fn from(summary: domain::GithubProjectSummary) -> Self {
        Self {
            number: summary.number,
            title: summary.title,
            closed: summary.closed,
        }
    }
}

/// `github:authenticated` イベントのペイロード。ログイン名のみ(トークンは
/// 含めない。native.md §4 NEVER)。
#[derive(Serialize, Clone)]
pub struct GithubAuthenticatedEventDto {
    pub login: String,
}

/// `github:auth_failed` イベントのペイロード。デバイスフローがタイムアウト・
/// 拒否・エラーになった場合に通知する(フロントを待機表示のまま放置しない)。
#[derive(Serialize, Clone)]
pub struct GithubAuthFailedEventDto {
    pub message: String,
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
            app::AppError::GithubUnauthenticated(message) => ("github_unauthenticated", message),
            app::AppError::GithubAuthExpired(message) => ("github_auth_expired", message),
            app::AppError::GithubApiFailed(message) => ("github_api_failed", message),
        };
        Self {
            code: code.to_string(),
            message,
        }
    }
}
