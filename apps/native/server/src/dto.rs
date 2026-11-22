//! 応答の DTO。`apps/native/tauri/src/dto.rs` から必要な分だけを写したもの(Tauri 版は凍結)。
//! 形は変えない: フロントの型(`api/types.ts`)がそのまま使えることが前提。

#[allow(unused_imports)]
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
    /// app の起動時に、前回動かしていた実行中セッションを再開するか(issue #459)。
    pub restore_running_sessions: bool,
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
            app::AppError::WorktreeSyncFailed(message) => ("worktree_sync_failed", message),
        };
        Self {
            code: code.to_string(),
            message,
        }
    }
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
    /// app の起動時に、前回動かしていた実行中セッションを再開するか(issue #459)。
    /// 省略(`null`)は「変えない」。設定画面の UI は続きのイシューで足す。
    #[serde(default)]
    pub restore_running_sessions: Option<bool>,
}

/// `settings:corrupted` イベントのペイロード。
#[derive(Serialize, Clone)]
pub struct SettingsCorruptedEventDto {
    pub message: String,
}

/// `app:warning` イベントのペイロード(native.md §3.2)。
#[derive(Serialize, Clone)]
pub struct AppWarningEventDto {
    pub message: String,
}

/// 起動直後に出て取りこぼした警告の控え(`list_pending_warnings`。Tauri 版には無い、
/// サーバ独自の Query)。`kind` はイベント名と同じ(`settings:corrupted` | `app:warning`)。
#[derive(Serialize, Clone)]
pub struct PendingWarningDto {
    pub id: u64,
    pub kind: String,
    pub message: String,
}

/// `check_folder` の戻り値(Tauri 版のフォルダ選択ダイアログの代わり。サーバ独自の Query)。
#[derive(Serialize, Clone)]
pub struct FolderCheckDto {
    /// 確認したパス(解決後の表示用)。
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    /// 直下に `.git`(フォルダまたはファイル)があるか。
    pub is_git_repository: bool,
}

/// 会話ファイルの変更の通知(`session:changed`)。変更があったことだけを知らせ、データ本体は Query で取り直す。
#[derive(Serialize, Clone)]
pub struct SessionChangedEventDto {
    pub project: String,
    pub agent: AgentKindDto,
}
