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

// ============ 実行中セッション(issue #391。Phase 1「1セッションを app から対話する」) ============

/// 画面で選べる権限モード(`app::RunningPermissionMode` の写し。issue #407 で `accept_edits` と
/// `auto` を足した)。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunningPermissionModeDto {
    Plan,
    Default,
    AcceptEdits,
    Auto,
}

impl From<app::RunningPermissionMode> for RunningPermissionModeDto {
    fn from(mode: app::RunningPermissionMode) -> Self {
        match mode {
            app::RunningPermissionMode::Plan => RunningPermissionModeDto::Plan,
            app::RunningPermissionMode::Default => RunningPermissionModeDto::Default,
            app::RunningPermissionMode::AcceptEdits => RunningPermissionModeDto::AcceptEdits,
            app::RunningPermissionMode::Auto => RunningPermissionModeDto::Auto,
        }
    }
}

impl From<RunningPermissionModeDto> for app::RunningPermissionMode {
    fn from(mode: RunningPermissionModeDto) -> Self {
        match mode {
            RunningPermissionModeDto::Plan => app::RunningPermissionMode::Plan,
            RunningPermissionModeDto::Default => app::RunningPermissionMode::Default,
            RunningPermissionModeDto::AcceptEdits => app::RunningPermissionMode::AcceptEdits,
            RunningPermissionModeDto::Auto => app::RunningPermissionMode::Auto,
        }
    }
}

/// 実行中セッション1つの宛先(`app::RunningSessionRef` の写し)。画面が持ち回って、送信・応答・
/// 購読・切り替えの対象を指定する。`started_at` は epoch ms で、JS の数値で安全に扱える範囲。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RunningSessionRefDto {
    pub pid_domain: String,
    pub pid: u32,
    pub started_at: u64,
}

impl From<app::RunningSessionRef> for RunningSessionRefDto {
    fn from(target: app::RunningSessionRef) -> Self {
        Self {
            pid_domain: target.pid_domain,
            pid: target.pid,
            started_at: target.started_at,
        }
    }
}

impl From<RunningSessionRefDto> for app::RunningSessionRef {
    fn from(dto: RunningSessionRefDto) -> Self {
        Self {
            pid_domain: dto.pid_domain,
            pid: dto.pid,
            started_at: dto.started_at,
        }
    }
}

/// 起動の要求(`start_running_session` の引数)。再開と新規で持つ値が違うので、`kind` で区別する
/// (`app::StartRunningSession` と同じ形)。パス(cwd・リポジトリ)は受け取らない: app が会話ファイル・
/// プロファイルから求める(native.md §4)。
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StartRunningSessionDto {
    /// 既存の会話を開く。
    Resume {
        project: String,
        session_id: String,
        mode: RunningPermissionModeDto,
        name: Option<String>,
    },
    /// 新しい会話を始める(ID は app が決める)。
    New {
        mode: RunningPermissionModeDto,
        name: Option<String>,
    },
}

/// 起動中に切り替える設定(`app::RunningSessionSwitch` の写し)。
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunningSessionSwitchDto {
    Model { model: String },
    PermissionMode { mode: RunningPermissionModeDto },
}

impl From<RunningSessionSwitchDto> for app::RunningSessionSwitch {
    fn from(dto: RunningSessionSwitchDto) -> Self {
        match dto {
            RunningSessionSwitchDto::Model { model } => Self::Model(model),
            RunningSessionSwitchDto::PermissionMode { mode } => Self::PermissionMode(mode.into()),
        }
    }
}

/// 途中経過(Channel で流す)。`kind` で区別する。`domain::ProgressEvent` の写し。
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProgressEventDto {
    TextDelta {
        text: String,
    },
    ToolStarted {
        tool_use_id: String,
        tool_name: String,
    },
    ToolResultArrived {
        tool_use_id: String,
        is_error: bool,
    },
    TurnFinished {
        succeeded: bool,
    },
    SentLineConfirmed {
        uuid: String,
    },
}

impl From<domain::ProgressEvent> for ProgressEventDto {
    fn from(event: domain::ProgressEvent) -> Self {
        match event {
            domain::ProgressEvent::TextDelta { text } => Self::TextDelta { text },
            domain::ProgressEvent::ToolStarted {
                tool_use_id,
                tool_name,
            } => Self::ToolStarted {
                tool_use_id,
                tool_name,
            },
            domain::ProgressEvent::ToolResultArrived {
                tool_use_id,
                is_error,
            } => Self::ToolResultArrived {
                tool_use_id,
                is_error,
            },
            domain::ProgressEvent::TurnFinished { succeeded } => Self::TurnFinished { succeeded },
            domain::ProgressEvent::SentLineConfirmed { uuid } => Self::SentLineConfirmed { uuid },
        }
    }
}

/// プロセスの状態。`domain::ProcessState` の写し。
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStateDto {
    Starting,
    Idle,
    Running,
    AwaitingPermission,
    Exited,
}

impl From<domain::ProcessState> for ProcessStateDto {
    fn from(state: domain::ProcessState) -> Self {
        match state {
            domain::ProcessState::Starting => Self::Starting,
            domain::ProcessState::Idle => Self::Idle,
            domain::ProcessState::Running => Self::Running,
            domain::ProcessState::AwaitingPermission => Self::AwaitingPermission,
            domain::ProcessState::Exited => Self::Exited,
        }
    }
}

/// 権限の問い合わせの種別。`domain::PermissionRequestKind` の写し。
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionRequestKindDto {
    ToolUse,
    AskUserQuestion,
    ExitPlanMode,
}

impl From<domain::PermissionRequestKind> for PermissionRequestKindDto {
    fn from(kind: domain::PermissionRequestKind) -> Self {
        match kind {
            domain::PermissionRequestKind::ToolUse => Self::ToolUse,
            domain::PermissionRequestKind::AskUserQuestion => Self::AskUserQuestion,
            domain::PermissionRequestKind::ExitPlanMode => Self::ExitPlanMode,
        }
    }
}

/// 権限の提案(「今後も許可」に使える更新)。問い合わせで受け取り、許可の応答で選んだものを
/// そのまま返す(`updated_permissions`)ので、`Serialize` と `Deserialize` の両方を持つ。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PermissionSuggestionDto {
    pub suggestion_type: String,
    pub suggestion_destination: String,
    pub suggestion_content: serde_json::Value,
}

impl From<domain::PermissionSuggestion> for PermissionSuggestionDto {
    fn from(suggestion: domain::PermissionSuggestion) -> Self {
        Self {
            suggestion_type: suggestion.suggestion_type,
            suggestion_destination: suggestion.suggestion_destination,
            suggestion_content: suggestion.suggestion_content,
        }
    }
}

impl From<PermissionSuggestionDto> for domain::PermissionSuggestion {
    fn from(dto: PermissionSuggestionDto) -> Self {
        Self {
            suggestion_type: dto.suggestion_type,
            suggestion_destination: dto.suggestion_destination,
            suggestion_content: dto.suggestion_content,
        }
    }
}

/// 答え待ちの権限の問い合わせ。`tool_input` はツールごとに形が違うので JSON のまま通す。
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PermissionRequestDto {
    pub request_id: String,
    pub tool_name: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub tool_use_id: String,
    pub tool_input: serde_json::Value,
    pub blocked_path: Option<String>,
    pub requested_at: u64,
    pub request_kind: PermissionRequestKindDto,
    pub suggestions: Vec<PermissionSuggestionDto>,
}

impl From<domain::PermissionRequest> for PermissionRequestDto {
    fn from(request: domain::PermissionRequest) -> Self {
        let request_kind = request.request_kind().into();
        Self {
            request_id: request.request_id,
            tool_name: request.tool_name,
            display_name: request.display_name,
            description: request.description,
            tool_use_id: request.tool_use_id,
            tool_input: request.tool_input,
            blocked_path: request
                .blocked_path
                .map(|path| path.to_string_lossy().to_string()),
            requested_at: request.requested_at,
            request_kind,
            suggestions: request.suggestions.into_iter().map(Into::into).collect(),
        }
    }
}

/// 宛先を付けた途中経過(Channel で流す。`app::AddressedProgress` の写し。issue #407)。
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct AddressedProgressDto {
    pub target: RunningSessionRefDto,
    pub event: ProgressEventDto,
}

impl From<app::AddressedProgress> for AddressedProgressDto {
    fn from(progress: app::AddressedProgress) -> Self {
        Self {
            target: progress.target.into(),
            event: progress.event.into(),
        }
    }
}

/// app が起動した実行中セッションの現在の状態(`get_running_session` の戻り値)。
/// 台帳の秘匿値(`peer_token`)は載せない。
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RunningSessionDto {
    pub target: RunningSessionRefDto,
    /// 会話ファイルのあるプロジェクトフォルダ名。再開のときだけ(新規は、会話ファイルが
    /// できるまで分からないので `None`)。
    pub project: Option<String>,
    pub session_id: String,
    pub repository_path: String,
    pub cwd: Option<String>,
    /// 起動時に付けた表示名(`--name`)。
    pub name: Option<String>,
    pub process_state: ProcessStateDto,
    pub process_state_at: u64,
    /// いまのモデル(`system/init` か `set_model` の結果。最初のターンまでは `None`)。
    pub current_model: Option<String>,
    /// いまの権限モード(CLI が返す値のまま。`default` / `manual` など、版で名前が変わる)。
    pub current_permission_mode: Option<String>,
    pub permission_requests: Vec<PermissionRequestDto>,
}

impl RunningSessionDto {
    pub fn from_session(project: Option<&str>, session: domain::RunningSessionByApp) -> Self {
        Self {
            target: app::RunningSessionRef::of(&session).into(),
            project: project.map(str::to_string),
            session_id: session.base.session_id,
            repository_path: session.repository_path.to_string_lossy().to_string(),
            cwd: session
                .base
                .cwd
                .map(|path| path.to_string_lossy().to_string()),
            name: session.base.name,
            process_state: session.process_state.into(),
            process_state_at: session.process_state_at,
            current_model: session.current_model,
            current_permission_mode: session.current_permission_mode,
            permission_requests: session
                .permission_requests
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}

/// ハブなどが並べる一覧の1項目(`list_running_sessions` の戻り値。`app::RunningSessionSummary` の写し)。
/// 答え待ちの問い合わせは数だけ(中身は `get_running_session`)。
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RunningSessionSummaryDto {
    pub target: RunningSessionRefDto,
    pub session_id: String,
    pub repository_path: String,
    pub process_state: ProcessStateDto,
    pub pending_permission_count: usize,
    pub current_model: Option<String>,
    pub current_permission_mode: Option<String>,
    pub cwd: Option<String>,
    pub name: Option<String>,
}

impl From<app::RunningSessionSummary> for RunningSessionSummaryDto {
    fn from(summary: app::RunningSessionSummary) -> Self {
        Self {
            target: summary.target.into(),
            session_id: summary.session_id,
            repository_path: summary.repository_path.to_string_lossy().to_string(),
            process_state: summary.process_state.into(),
            pending_permission_count: summary.pending_permission_count,
            current_model: summary.current_model,
            current_permission_mode: summary.current_permission_mode,
            cwd: summary.cwd.map(|path| path.to_string_lossy().to_string()),
            name: summary.name,
        }
    }
}

/// 状態変化・権限の問い合わせ到着を知らせる軽量イベント(`running-session:changed`)の
/// ペイロード(宛先付き)。データ本体は `get_running_session` で取り直す(native.md §3.2)。
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RunningSessionChangedEventDto {
    pub target: RunningSessionRefDto,
    pub session_id: String,
    pub process_state: ProcessStateDto,
    pub pending_permission_count: usize,
    /// 終了したときの終了コード(終了以外は `None`)。
    pub exit_code: Option<i32>,
}

/// 権限の問い合わせへの答えの種別。取り消し(Cancelled)は CLI 側が決めるので選べない。
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionBehaviorDto {
    Allow,
    Deny,
}
