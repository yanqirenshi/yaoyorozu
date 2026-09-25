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
    /// 元の jsonl 行の `uuid`(ビューアの「データ」表示用。issue #313)。行に無ければ null。
    pub uuid: Option<String>,
    /// この行に含まれる画像の枚数(issue #349)。画像本体は載せず、押されたときに
    /// `get_session_line_images` でオンデマンドに取る。
    pub image_count: usize,
    /// 送信の失敗に関する見分け(issue #364)。フロントは表示の切り替えにだけ使う。
    pub status: MessageStatusDto,
}

/// `domain::MessageStatus` の DTO(issue #364)。
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum MessageStatusDto {
    Normal,
    FailedQuestion,
    ErrorForQuestion,
    Error,
}

impl From<domain::MessageStatus> for MessageStatusDto {
    fn from(status: domain::MessageStatus) -> Self {
        match status {
            domain::MessageStatus::Normal => Self::Normal,
            domain::MessageStatus::FailedQuestion => Self::FailedQuestion,
            domain::MessageStatus::ErrorForQuestion => Self::ErrorForQuestion,
            domain::MessageStatus::Error => Self::Error,
        }
    }
}

impl From<domain::Message> for MessageDto {
    fn from(message: domain::Message) -> Self {
        Self {
            role: message.role.into(),
            text: message.text,
            timestamp: message.timestamp,
            uuid: message.uuid,
            image_count: message.image_count,
            status: message.status.into(),
        }
    }
}

/// `get_session_line_images` の1枚分(issue #349)。フロントが `data:` URL を組み立てて表示する。
#[derive(Serialize, Clone)]
pub struct MessageImageDto {
    pub media_type: String,
    pub data: String,
}

impl From<domain::MessageImage> for MessageImageDto {
    fn from(image: domain::MessageImage) -> Self {
        Self {
            media_type: image.media_type.as_mime().to_string(),
            data: image.data_base64,
        }
    }
}

/// 表示中の会話(`domain::Conversation`。issue #197で改名。旧`SessionDto`)。
/// `session_id` はフロントが保持し、送信時に渡すことで「表示中の会話 =
/// 追記される会話」の一致検証(送信直前チェック)に使う。
#[derive(Serialize, Clone)]
pub struct ConversationDto {
    pub session_id: String,
    pub messages: Vec<MessageDto>,
    pub agent: AgentKindDto,
}

impl From<domain::Conversation> for ConversationDto {
    fn from(conversation: domain::Conversation) -> Self {
        Self {
            session_id: conversation.id,
            messages: conversation
                .messages
                .into_iter()
                .map(MessageDto::from)
                .collect(),
            agent: conversation.agent.into(),
        }
    }
}

/// セッション一覧(ビューア左ペイン)の1件分。1件 = 1セッション(セッションID =
/// 会話ファイル。issue #369)。
#[derive(Serialize, Clone)]
pub struct SessionSummaryDto {
    pub id: String,
    pub title: String,
    pub modified_at: u64,
    /// セッションの作業ディレクトリ。JSONLに記録が無ければ `null`
    /// (ハブのグラフ階層用。issue #104)。
    pub cwd: Option<String>,
    /// セッションのgitブランチ(セッション中の最後の記録値)。`"HEAD"` は
    /// デタッチ状態、記録が無ければ `null`(ハブのグラフ階層用。issue #104)。
    pub git_branch: Option<String>,
}

impl From<domain::SessionSummary> for SessionSummaryDto {
    fn from(summary: domain::SessionSummary) -> Self {
        Self {
            id: summary.id,
            title: summary.title,
            modified_at: summary.modified_at_ms,
            cwd: summary.cwd,
            git_branch: summary.git_branch,
        }
    }
}

/// ビューアのセッションタブ1件(issue #353)。`get_viewer_tabs` の戻り値にも
/// `save_viewer_tabs` の入力にも使う。
#[derive(Serialize, Deserialize, Clone)]
pub struct ViewerTabDto {
    pub project: String,
    pub session_id: String,
}

impl From<domain::ViewerTab> for ViewerTabDto {
    fn from(tab: domain::ViewerTab) -> Self {
        Self {
            project: tab.project,
            session_id: tab.session_id,
        }
    }
}

impl From<ViewerTabDto> for domain::ViewerTab {
    fn from(dto: ViewerTabDto) -> Self {
        Self {
            project: dto.project,
            session_id: dto.session_id,
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

/// `get_settings` の戻り値。`active_profile_id`/`profiles` はプロファイル
/// 一覧・切り替えUI用、それ以外はアクティブプロファイルの内容(+グローバル
/// 項目の `claude_projects_dir`)をフラットに展開したもの(issue #72。既存
/// フロントの読み替えを最小にするため)。旧 `open_tabs`(メインウィンドウの
/// タブバー復元用)はタブバー廃止(issue #91)で削除した。
#[derive(Serialize, Clone)]
pub struct SettingsDto {
    pub active_profile_id: String,
    pub profiles: Vec<ProfileSummaryDto>,
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

/// `get_project_claude_md`/`get_user_claude_md` の戻り値。両方
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
            app::AppError::SessionBusy(message) => ("session_busy", message),
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

/// ハブグラフのノード1件分の座標(issue #121)。`save_hub_layout` の入力にも
/// `get_hub_layout` の出力にも使う。
#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct NodePositionDto {
    pub x: f64,
    pub y: f64,
}

impl From<domain::NodePosition> for NodePositionDto {
    fn from(position: domain::NodePosition) -> Self {
        Self {
            x: position.x,
            y: position.y,
        }
    }
}

impl From<NodePositionDto> for domain::NodePosition {
    fn from(dto: NodePositionDto) -> Self {
        Self { x: dto.x, y: dto.y }
    }
}

/// ハブグラフの調整値(issue #249)。`get_hub_tuning` の戻り値にも
/// `save_hub_tuning` の入力にも使う。`version` はフロントで使わないため
/// 含めない(保存時は現在のバージョンで書く)。`link_strength` の `None` は
/// d3-force の既定(次数依存)のまま。
#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct HubTuningDto {
    pub link_distance: f64,
    pub link_strength: Option<f64>,
    pub charge_strength: f64,
    pub collide_radius: f64,
}

impl From<domain::HubTuning> for HubTuningDto {
    fn from(tuning: domain::HubTuning) -> Self {
        Self {
            link_distance: tuning.link_distance,
            link_strength: tuning.link_strength,
            charge_strength: tuning.charge_strength,
            collide_radius: tuning.collide_radius,
        }
    }
}

impl From<HubTuningDto> for domain::HubTuning {
    fn from(dto: HubTuningDto) -> Self {
        Self {
            version: domain::CURRENT_HUB_TUNING_VERSION,
            link_distance: dto.link_distance,
            link_strength: dto.link_strength,
            charge_strength: dto.charge_strength,
            collide_radius: dto.collide_radius,
        }
    }
}

/// ハブグラフの視点(パン・ズーム。issue #268)。d3-zoom の transform。
/// `save_hub_layout` の入力にも `get_hub_layout` の出力にも使う。
#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct CameraDto {
    pub x: f64,
    pub y: f64,
    pub k: f64,
}

impl From<domain::Camera> for CameraDto {
    fn from(camera: domain::Camera) -> Self {
        Self {
            x: camera.x,
            y: camera.y,
            k: camera.k,
        }
    }
}

impl From<CameraDto> for domain::Camera {
    fn from(dto: CameraDto) -> Self {
        Self {
            x: dto.x,
            y: dto.y,
            k: dto.k,
        }
    }
}

/// `get_hub_layout` の戻り値。`version` はフロントで使わないため含めない。
#[derive(Serialize, Clone)]
pub struct HubLayoutDto {
    pub positions: std::collections::HashMap<String, NodePositionDto>,
    pub camera: Option<CameraDto>,
}

impl From<domain::HubLayout> for HubLayoutDto {
    fn from(layout: domain::HubLayout) -> Self {
        Self {
            positions: layout
                .positions
                .into_iter()
                .map(|(key, position)| (key, NodePositionDto::from(position)))
                .collect(),
            camera: layout.camera.map(CameraDto::from),
        }
    }
}

/// `~/.claude` 配下のエントリ種別(/claude 画面のExplorerタブ)。
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum ClaudeDirEntryKindDto {
    Directory,
    File,
    Symlink,
}

impl From<domain::ClaudeDirEntryKind> for ClaudeDirEntryKindDto {
    fn from(kind: domain::ClaudeDirEntryKind) -> Self {
        match kind {
            domain::ClaudeDirEntryKind::Directory => ClaudeDirEntryKindDto::Directory,
            domain::ClaudeDirEntryKind::File => ClaudeDirEntryKindDto::File,
            domain::ClaudeDirEntryKind::Symlink => ClaudeDirEntryKindDto::Symlink,
        }
    }
}

/// `list_claude_dir` の1件分。`path` は `~/.claude` からの相対パス(区切りは
/// `/`)で、ディレクトリを展開する際にそのまま `list_claude_dir` の `path`
/// 引数として送り返す。
#[derive(Serialize, Clone)]
pub struct ClaudeDirEntryDto {
    pub name: String,
    pub path: String,
    pub kind: ClaudeDirEntryKindDto,
    pub size_bytes: Option<u64>,
    pub modified_at_ms: u64,
}

impl From<domain::ClaudeDirEntry> for ClaudeDirEntryDto {
    fn from(entry: domain::ClaudeDirEntry) -> Self {
        Self {
            name: entry.name,
            path: entry.path,
            kind: entry.kind.into(),
            size_bytes: entry.size_bytes,
            modified_at_ms: entry.modified_at_ms,
        }
    }
}

/// `list_claude_dir` の戻り値。`total` はページング前の件数(フロントの
/// 「さらに表示」の判定に使う)。
#[derive(Serialize, Clone)]
pub struct ClaudeDirPageDto {
    pub entries: Vec<ClaudeDirEntryDto>,
    pub total: usize,
}

impl From<domain::ClaudeDirPage> for ClaudeDirPageDto {
    fn from(page: domain::ClaudeDirPage) -> Self {
        Self {
            entries: page
                .entries
                .into_iter()
                .map(ClaudeDirEntryDto::from)
                .collect(),
            total: page.total,
        }
    }
}

/// `GitRepository.branches` の1件分(オブジェクトモデル実装 第3弾。
/// issue #193)。削除済み(`deleted_at_time.is_some()`)は`GitRepositoryDto`
/// への変換時点で除外するため、このDTO自体は「現存するブランチ」のみを
/// 表す(`deleted_at_time`フィールドを持たない)。
#[derive(Serialize, Clone)]
pub struct GitBranchDto {
    pub branch_id: String,
    pub branch_name: String,
    pub description: String,
    pub created_at_time: u64,
}

impl From<domain::GitBranch> for GitBranchDto {
    fn from(branch: domain::GitBranch) -> Self {
        Self {
            branch_id: branch.branch_id,
            branch_name: branch.branch_name,
            description: branch.description,
            created_at_time: branch.created_at_time,
        }
    }
}

/// `GitRepository.worktrees` の1件分(issue #193)。`checked_out_branch`は
/// `GitBranch.branch_id`(未解決・detachedなら`null`)。削除済みの扱いは
/// [`GitBranchDto`]と同じ。
#[derive(Serialize, Clone)]
pub struct GitWorktreeDto {
    pub worktree_id: String,
    pub worktree_name: String,
    pub description: String,
    pub worktree_folder_path: String,
    pub worktree_git_file_path: String,
    pub created_at_time: u64,
    pub checked_out_branch: Option<String>,
}

impl From<domain::GitWorktree> for GitWorktreeDto {
    fn from(worktree: domain::GitWorktree) -> Self {
        Self {
            worktree_id: worktree.worktree_id,
            worktree_name: worktree.worktree_name,
            description: worktree.description,
            worktree_folder_path: worktree.worktree_folder_path.display().to_string(),
            worktree_git_file_path: worktree.worktree_git_file_path.display().to_string(),
            created_at_time: worktree.created_at_time,
            checked_out_branch: worktree.checked_out_branch,
        }
    }
}

/// `get_pc` の1ユーザーが所有するリポジトリ1件分(オブジェクトモデル実装
/// 第2弾。issue #189)。`branches`/`worktrees`は第3弾(issue #193)で追加。
/// 削除済み(`deleted_at_time.is_some()`)のレコードは既定でここから除外
/// する(フロントは「今あるもの」だけを表示すればよく、削除イベントの履歴
/// 自体はハブの表示要件に無いため。issue本文の実装時判断)。
#[derive(Serialize, Clone)]
pub struct GitRepositoryDto {
    pub repository_path: String,
    pub repository_name: String,
    pub description: String,
    pub branches: Vec<GitBranchDto>,
    pub worktrees: Vec<GitWorktreeDto>,
}

impl From<domain::GitRepository> for GitRepositoryDto {
    fn from(repository: domain::GitRepository) -> Self {
        Self {
            repository_path: repository.repository_path.display().to_string(),
            repository_name: repository.repository_name,
            description: repository.description,
            branches: repository
                .branches
                .into_iter()
                .filter(|b| b.deleted_at_time.is_none())
                .map(GitBranchDto::from)
                .collect(),
            worktrees: repository
                .worktrees
                .into_iter()
                .filter(|w| w.deleted_at_time.is_none())
                .map(GitWorktreeDto::from)
                .collect(),
        }
    }
}

/// `Session.conversation_files`/`subagent_files` の1件分(オブジェクトモデル
/// 実装 第5弾。issue #208)。`lines_loaded`/`line_count`は`LogLine`が
/// 遅延読み込みであることの可視化用(未読み込みの間は常に`false`/`0`。
/// issue本文の「行の読み込み状態・行数程度」)。
#[derive(Serialize, Clone)]
pub struct SessionFileDto {
    pub file_path: String,
    pub lines_loaded: bool,
    pub line_count: usize,
}

impl From<domain::SessionFile> for SessionFileDto {
    fn from(file: domain::SessionFile) -> Self {
        Self {
            file_path: file.file_path.display().to_string(),
            // `SessionFile`のドキュメントコメントのとおり、空Vecは
            // 「未読み込み」を表す(クラス図の多重度1..*により、読み込み
            // 済みで0行ということはありえない)。
            lines_loaded: !file.lines.is_empty(),
            line_count: file.lines.len(),
        }
    }
}

/// `User.sessions` の1件分(オブジェクトモデル実装 第4弾。issue #197)。
/// 名前が空いた旧`SessionDto`(プロトタイプの`Session`。issue #197で
/// `ConversationDto`に改名済み)を、クラス図の新しい`Session`用に使う。
/// `conversation_files`/`subagent_files`は第5弾(issue #208)で追加。
/// `conversation_files`は issue #217 で単数(`conversation_file`)から
/// 1..*(`Vec`)に変更した(同じsession_idのjsonlがworktree移動により
/// 複数フォルダにできるケースに対応するため)。
///
/// `cwd`/`git_branch`(issue #224)はハブのグラフ(セッション→ブランチの線)
/// 表示用の**表示補助データ**。`domain::Session`は持たない(TMの決定:
/// cwd/git_branchはLogLineの属性でありSessionの属性ではない)ため、
/// `From<domain::Session>`では埋めず(`data_loaded`と同じパターン)、
/// `get_pc` commandが`AppState.user_sessions`(`ParsedSession`)から
/// `app::resolve_session_display_hints`で解決して差し込む。
#[derive(Serialize, Clone)]
pub struct SessionDto {
    pub session_id: String,
    pub custom_title: Option<String>,
    pub ai_title: Option<String>,
    pub mode: Option<String>,
    pub slug: Option<String>,
    pub last_prompt: Option<String>,
    pub conversation_files: Vec<SessionFileDto>,
    pub subagent_files: Vec<SessionFileDto>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
}

impl From<domain::Session> for SessionDto {
    fn from(session: domain::Session) -> Self {
        Self {
            session_id: session.session_id,
            custom_title: session.custom_title,
            ai_title: session.ai_title,
            mode: session.mode,
            slug: session.slug,
            last_prompt: session.last_prompt,
            conversation_files: session
                .conversation_files
                .into_iter()
                .map(SessionFileDto::from)
                .collect(),
            subagent_files: session
                .subagent_files
                .into_iter()
                .map(SessionFileDto::from)
                .collect(),
            // `get_pc` commandが後から差し込む(上のドキュメントコメント参照)。
            cwd: None,
            git_branch: None,
        }
    }
}

/// `get_pc` の1ユーザー分(オブジェクトモデル実装 第1弾。issue #182)。
#[derive(Serialize, Clone)]
pub struct UserDto {
    pub user_id: String,
    pub user_name: String,
    pub home_directory: String,
    pub repositories: Vec<GitRepositoryDto>,
    pub sessions: Vec<SessionDto>,
}

impl From<domain::User> for UserDto {
    fn from(user: domain::User) -> Self {
        Self {
            user_id: user.user_id,
            user_name: user.user_name,
            home_directory: user.home_directory.display().to_string(),
            repositories: user
                .repositories
                .into_iter()
                .map(GitRepositoryDto::from)
                .collect(),
            sessions: user.sessions.into_iter().map(SessionDto::from).collect(),
        }
    }
}

/// `get_pc` の戻り値(issue #182)。`data_loaded`(issue #218)は
/// `domain::Pc`には無い値(`AppState.pc_data_loaded`由来)のため、
/// `From<domain::Pc>`では埋めず呼び出し元(`get_pc` command)が設定する
/// (既定値`false`。「未確認」ではなく「未読み込み」寄りの安全側)。
#[derive(Serialize, Clone)]
pub struct PcDto {
    pub system_uuid: String,
    pub pc_name: String,
    pub description: String,
    pub users: Vec<UserDto>,
    pub data_loaded: bool,
}

impl From<domain::Pc> for PcDto {
    fn from(pc: domain::Pc) -> Self {
        Self {
            system_uuid: pc.system_uuid,
            pc_name: pc.pc_name,
            description: pc.description,
            users: pc.users.into_iter().map(UserDto::from).collect(),
            data_loaded: false,
        }
    }
}
