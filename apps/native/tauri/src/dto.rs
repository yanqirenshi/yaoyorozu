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

/// 表示中のセッション。`session_id` はフロントが保持し、送信時に渡すことで
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

/// セッション一覧(ビューア左ペイン)の1件分。
#[derive(Serialize, Clone)]
pub struct SessionSummaryDto {
    pub id: String,
    pub title: String,
    pub modified_at: u64,
    /// そのフォルダで最も新しいセッションかどうか。`true` のときだけ
    /// 送信フォームを有効にする(`--continue` の性質上、最新以外へは
    /// 送信できないため。issue #33)。
    pub is_latest: bool,
}

impl From<domain::SessionSummary> for SessionSummaryDto {
    fn from(summary: domain::SessionSummary) -> Self {
        Self {
            id: summary.id,
            title: summary.title,
            modified_at: summary.modified_at_ms,
            is_latest: summary.is_latest,
        }
    }
}

/// `session:changed` イベントのペイロード。変更のあったプロジェクト(フォルダ名)
/// のみを通知し、データ本体はフロントが Query(get_session 等)で
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

/// プロジェクトの `.claude/` 配下にある設定ファイルの選択。フロントから
/// ファイル名を自由入力させず、この enum で選ばせる(native.md §4。
/// issue #70)。`Deserialize` が要るのは `AgentModeDto` と同じ理由。
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ProjectSettingsFileDto {
    Settings,
    SettingsLocal,
}

impl From<ProjectSettingsFileDto> for app::ProjectSettingsFile {
    fn from(which: ProjectSettingsFileDto) -> Self {
        match which {
            ProjectSettingsFileDto::Settings => app::ProjectSettingsFile::Settings,
            ProjectSettingsFileDto::SettingsLocal => app::ProjectSettingsFile::SettingsLocal,
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

/// プロファイル一覧に出す最小限の情報(issue #72)。アクティブプロファイルの
/// 内容自体は `SettingsDto` にフラットに展開して返す(既存フロントの読み替えを
/// 最小にするため)。
#[derive(Serialize, Clone)]
pub struct ProfileSummaryDto {
    pub id: String,
    pub name: String,
}

/// 開いているタブ1件分の、復元用の最小限のスナップショット(issue #77)。
#[derive(Serialize, Deserialize, Clone)]
pub struct TabStateDto {
    pub profile_id: String,
}

impl From<domain::TabState> for TabStateDto {
    fn from(tab: domain::TabState) -> Self {
        Self {
            profile_id: tab.profile_id,
        }
    }
}

/// `get_settings` の戻り値。`active_profile_id`/`profiles` はプロファイル
/// 一覧・切り替えUI用、`open_tabs` はメインウィンドウのタブバー(issue #77)
/// 復元用、それ以外はアクティブプロファイルの内容(+グローバル項目の
/// `claude_projects_dir`)をフラットに展開したもの(issue #72。既存フロントの
/// 読み替えを最小にするため)。
#[derive(Serialize, Clone)]
pub struct SettingsDto {
    pub active_profile_id: String,
    pub profiles: Vec<ProfileSummaryDto>,
    pub open_tabs: Vec<TabStateDto>,
    pub repository_path: Option<String>,
    pub github_project: Option<GithubProjectDto>,
    /// `~/.claude/projects/` 配下のフォルダ名のうち、対象として選んだもの。
    pub selected_project_folders: Vec<String>,
    /// 明示的な上書き値。`null` は「既定を使用中」を意味する。設定画面が
    /// 「未変更なら保存時に既定→上書きへ意図せず固定してしまう」ことを
    /// 避けるため、表示用の `effective_projects_dir` とは別に生値も返す。
    pub claude_projects_dir: Option<String>,
    /// セッション一覧が実際に読んでいるルートディレクトリ(上書きがあれば
    /// それ、なければ既定値を解決した結果)。有効パスの解決には既定値
    /// (`~/.claude/projects/`)の解決が要るため、`domain::Settings` からの
    /// 単純な変換では組み立てられず、呼び出し側(`get_settings`)で組み立てる
    /// (`From` 実装は用意しない)。
    pub effective_projects_dir: String,
}

/// `update_settings` の引数。対象はアクティブプロファイル(3項目)+グローバル
/// 項目(`claude_projects_dir`)(issue #72)。スキーマ `version` はフロントが
/// 関知しない(常に現行バージョンとして保存する)ため含めない。プロファイル自体
/// (新規作成・削除・名前変更・切り替え)は別コマンドで扱うため、
/// `domain::Settings` への直接変換(`From`)は用意しない(呼び出し側の
/// `update_settings` コマンドが現在のアクティブプロファイルを書き換える)。
#[derive(Deserialize, Clone)]
pub struct SettingsInputDto {
    pub repository_path: Option<String>,
    pub github_project: Option<GithubProjectDto>,
    pub selected_project_folders: Vec<String>,
    /// `null` は「既定に戻す」を意味する。
    pub claude_projects_dir: Option<String>,
}

/// `get_repository_claude_md`/`get_project_claude_md` の戻り値。両方
/// `null` はファイルが存在しないことを意味する。`modified_at_ms` は保存時に
/// `expected_modified_at_ms` として送り返し、アプリ外での変更との競合検出
/// (楽観ロック)に使う(issue #27)。
#[derive(Serialize, Clone)]
pub struct ClaudeMdDto {
    pub content: Option<String>,
    pub modified_at_ms: Option<u64>,
}

impl From<Option<domain::ClaudeMdFile>> for ClaudeMdDto {
    fn from(file: Option<domain::ClaudeMdFile>) -> Self {
        match file {
            Some(file) => Self {
                content: Some(file.content),
                modified_at_ms: Some(file.modified_at_ms),
            },
            None => Self {
                content: None,
                modified_at_ms: None,
            },
        }
    }
}

/// `get_claude_settings_file` の戻り値。両方 `null` はファイルが存在しない
/// ことを意味する。`modified_at_ms` は保存時に `expected_modified_at_ms`
/// として送り返し、アプリ外での変更との競合検出(楽観ロック)に使う
/// (issue #53)。
#[derive(Serialize, Clone)]
pub struct ClaudeSettingsDto {
    pub content: Option<String>,
    pub modified_at_ms: Option<u64>,
}

impl From<Option<domain::ClaudeSettingsFile>> for ClaudeSettingsDto {
    fn from(file: Option<domain::ClaudeSettingsFile>) -> Self {
        match file {
            Some(file) => Self {
                content: Some(file.content),
                modified_at_ms: Some(file.modified_at_ms),
            },
            None => Self {
                content: None,
                modified_at_ms: None,
            },
        }
    }
}

/// `list_rules` の1件分(Ruleタブの一覧用。issue #61)。
#[derive(Serialize, Clone)]
pub struct RuleSummaryDto {
    pub file_name: String,
    pub modified_at_ms: u64,
}

impl From<domain::RuleSummary> for RuleSummaryDto {
    fn from(summary: domain::RuleSummary) -> Self {
        Self {
            file_name: summary.file_name,
            modified_at_ms: summary.modified_at_ms,
        }
    }
}

/// `get_rule` の戻り値(issue #61)。
#[derive(Serialize, Clone)]
pub struct RuleDto {
    pub content: String,
}

/// `list_skills` の1件分(Skillsタブの一覧用。issue #65)。
#[derive(Serialize, Clone)]
pub struct SkillSummaryDto {
    pub name: String,
    pub modified_at_ms: u64,
}

impl From<domain::SkillSummary> for SkillSummaryDto {
    fn from(summary: domain::SkillSummary) -> Self {
        Self {
            name: summary.name,
            modified_at_ms: summary.modified_at_ms,
        }
    }
}

/// `get_skill` の戻り値(issue #65)。
#[derive(Serialize, Clone)]
pub struct SkillDto {
    pub content: String,
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

/// GitHub Projects(v2) アイテムの種別(ビューアの「GitHub Project」タブ)。
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectItemKindDto {
    Issue,
    PullRequest,
    DraftIssue,
}

impl From<domain::ProjectItemKind> for ProjectItemKindDto {
    fn from(kind: domain::ProjectItemKind) -> Self {
        match kind {
            domain::ProjectItemKind::Issue => ProjectItemKindDto::Issue,
            domain::ProjectItemKind::PullRequest => ProjectItemKindDto::PullRequest,
            domain::ProjectItemKind::DraftIssue => ProjectItemKindDto::DraftIssue,
        }
    }
}

/// GitHub Projects(v2)の1アイテム。`repository`/`number`/`url` は
/// `DraftIssue` には無いため `null`(issue #34)。`id` はStatus変更コマンド
/// (`update_github_project_item_status`)の `itemId` に使う(issue #50)。
#[derive(Serialize, Clone)]
pub struct ProjectItemDto {
    pub id: String,
    pub title: String,
    pub kind: ProjectItemKindDto,
    pub repository: Option<String>,
    pub number: Option<u32>,
    pub assignees: Vec<String>,
    pub status: Option<String>,
    pub url: Option<String>,
}

impl From<domain::ProjectItem> for ProjectItemDto {
    fn from(item: domain::ProjectItem) -> Self {
        Self {
            id: item.id,
            title: item.title,
            kind: item.kind.into(),
            repository: item.repository,
            number: item.number,
            assignees: item.assignees,
            status: item.status,
            url: item.url,
        }
    }
}

/// Statusフィールドの選択肢(かんばんのカラム定義。issue #50)。
#[derive(Serialize, Clone)]
pub struct ProjectStatusOptionDto {
    pub id: String,
    pub name: String,
}

impl From<domain::ProjectStatusOption> for ProjectStatusOptionDto {
    fn from(option: domain::ProjectStatusOption) -> Self {
        Self {
            id: option.id,
            name: option.name,
        }
    }
}

/// `list_github_project_items` の戻り値。`project_id`/`status_field_id` は
/// `update_github_project_item_status` の引数組み立てにフロントが使う
/// (issue #50)。
#[derive(Serialize, Clone)]
pub struct ProjectItemsPageDto {
    pub project_id: String,
    pub status_field_id: Option<String>,
    pub items: Vec<ProjectItemDto>,
    pub next_cursor: Option<String>,
    pub status_options: Vec<ProjectStatusOptionDto>,
}

impl From<domain::ProjectItemsPage> for ProjectItemsPageDto {
    fn from(page: domain::ProjectItemsPage) -> Self {
        Self {
            project_id: page.project_id,
            status_field_id: page.status_field_id,
            items: page.items.into_iter().map(ProjectItemDto::from).collect(),
            next_cursor: page.next_cursor,
            status_options: page
                .status_options
                .into_iter()
                .map(ProjectStatusOptionDto::from)
                .collect(),
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
            app::AppError::GithubScopeInsufficient(message) => {
                ("github_scope_insufficient", message)
            }
            app::AppError::ClaudeMdConflict(message) => ("claude_md_conflict", message),
            app::AppError::FileConflict(message) => ("file_conflict", message),
        };
        Self {
            code: code.to_string(),
            message,
        }
    }
}

/// ウィンドウ内の1タブの表示状態(ハブ化 その1。issue #83)。
/// `report_window_state` の引数と `list_window_states` の戻り値の両方に使う。
#[derive(Serialize, Deserialize, Clone)]
pub struct WindowTabDto {
    pub profile_id: String,
    pub session_id: Option<String>,
    pub session_title: Option<String>,
}

impl From<domain::WindowTab> for WindowTabDto {
    fn from(tab: domain::WindowTab) -> Self {
        Self {
            profile_id: tab.profile_id,
            session_id: tab.session_id,
            session_title: tab.session_title,
        }
    }
}

impl From<WindowTabDto> for domain::WindowTab {
    fn from(tab: WindowTabDto) -> Self {
        Self {
            profile_id: tab.profile_id,
            session_id: tab.session_id,
            session_title: tab.session_title,
        }
    }
}

/// `list_window_states` の1件分(issue #83)。
#[derive(Serialize, Clone)]
pub struct WindowStateDto {
    pub label: String,
    pub tabs: Vec<WindowTabDto>,
    pub active_tab_index: usize,
}

impl From<domain::WindowState> for WindowStateDto {
    fn from(state: domain::WindowState) -> Self {
        Self {
            label: state.label,
            tabs: state.tabs.into_iter().map(WindowTabDto::from).collect(),
            active_tab_index: state.active_tab_index,
        }
    }
}
