use domain::{
    extract_message_images, is_valid_claude_dir_path, is_valid_json, is_valid_project_dir_name,
    is_valid_rule_file_name, is_valid_session_id, is_valid_skill_name, mark_failed_questions,
    order_messages_newest_first, paginate_messages, reconcile_branches, reconcile_worktrees,
    repositories_from_profiles, sort_claude_dir_entries, sort_projects_by_recency,
    sort_sessions_newest_first, validate_image_attachment, validate_image_attachments,
    validate_image_count, Camera, ClaudeDirEntry, ClaudeDirPage, ClaudeMdFile, ClaudeSettingsFile,
    Conversation, GitLedger, GitRepositoryLedger, HubLayout, HubTuning, ImageAttachment, LogLine,
    Message, MessageImage, NodePosition, ParsedSession, Project, RuleSummary, SessionSummary,
    Settings, SkillSummary, ViewerTab, ViewerTabs, CURRENT_GIT_LEDGER_VERSION,
    CURRENT_HUB_LAYOUT_VERSION, CURRENT_HUB_TUNING_VERSION, CURRENT_VIEWER_TABS_VERSION,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    InvalidInput(String),
    /// 送信対象のセッションが、既に他のプロセスで実行中(そのプロセスが
    /// 会話ファイルへ書き込み中)である。並行追記による会話の混線を防ぐため
    /// 送信を拒否する(issue #345)。
    #[error("{0}")]
    SessionBusy(String),
    /// `claude` 実行ファイルが見つからない。
    #[error("{0}")]
    CliNotFound(String),
    /// `claude` は起動したが、非ゼロ終了した。
    #[error("{0}")]
    CliFailed(String),
    /// `claude` の実行がタイムアウトした。
    #[error("{0}")]
    Timeout(String),
    /// セッションの作業ディレクトリが存在しない。
    #[error("{0}")]
    CwdMissing(String),
    /// GitHubにログインしていない状態で認証が必要な操作をした。
    #[error("{0}")]
    GithubUnauthenticated(String),
    /// GitHubの認証(デバイスフロー)がタイムアウトしたか、ユーザーが拒否した。
    /// もしくは、既にログイン済みのトークンがGitHub API呼び出し時に
    /// 確定的に拒否された(HTTP 401)。後者は一時的な通信失敗(ネットワーク
    /// 不通・タイムアウト・5xx)とは区別され、`GithubApiFailed` にはならない
    /// (issue #54)。
    #[error("{0}")]
    GithubAuthExpired(String),
    /// GitHub API(GraphQL含む)呼び出しが失敗した。
    #[error("{0}")]
    GithubApiFailed(String),
    /// CLAUDE.md の保存時、`expected_modified_at_ms` が実際のファイルの
    /// 状態と一致しなかった(アプリ外での変更と競合)。
    #[error("{0}")]
    ClaudeMdConflict(String),
    /// GitHubの認証スコープが不足しており、書き込み操作(Status変更等)が
    /// 拒否された。`read:project`(読み取りのみ)スコープの古いトークンで
    /// 書き込みmutationを呼んだ場合に発生する。再ログインでスコープを
    /// 拡張する必要がある(issue #50)。
    #[error("{0}")]
    GithubScopeInsufficient(String),
    /// 汎用のファイル保存競合(楽観ロック)。`expected_modified_at_ms` が
    /// 実際のファイルの状態と一致しなかった。`ClaudeMdConflict` とは別に
    /// 用意し、CLAUDE.md以外の単一ファイル編集機能(settings.json等)で
    /// 使う(issue #53。既存の `ClaudeMdConflict` との統合は将来の課題)。
    #[error("{0}")]
    FileConflict(String),
}

/// 会話ファイルの状態の目印(更新時刻 + サイズ)。解析済みの結果を使い回してよいかの
/// 判定に使う(issue #350)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileFingerprint {
    pub modified_nanos: u128,
    pub len: u64,
}

/// 会話ファイルを1回読んで得た内容(`SessionSource::read_session` の戻り値。issue #350)。
#[derive(Debug, Clone)]
pub struct SessionContent {
    pub fingerprint: FileFingerprint,
    /// 表示用のメッセージ。**記録順**(古い順)。
    pub messages: Vec<Message>,
    pub lines: Vec<LogLine>,
}

/// 解析済みメッセージのキャッシュ(ファイルごと。tauri 層の `AppState` が持つ。issue #350)。
/// ページ送りのたびに巨大な会話ファイルを読み直さないための保存先。
#[derive(Debug, Clone)]
pub struct CachedMessages {
    pub fingerprint: FileFingerprint,
    /// **新しい順**に並べ済み(表示のたびに並べ替え・複製をしない)。
    pub messages: Arc<Vec<Message>>,
}

/// 会話ファイルを読み直して得た、キャッシュへ入れるべき内容(issue #350)。
#[derive(Debug, Clone)]
pub struct ReloadedSession {
    pub messages: CachedMessages,
    pub lines: Vec<LogLine>,
}

/// `open_session` の結果。
#[derive(Debug, Clone)]
pub struct OpenedSession {
    /// 表示する範囲(新しい順)のメッセージ。
    pub conversation: Conversation,
    /// ファイルを読み直した場合だけ `Some`(呼び出し側がキャッシュを差し替える)。
    /// `None` はキャッシュが今のファイルと合っていて、読み直していないことを表す。
    pub reloaded: Option<ReloadedSession>,
}

/// プロジェクト・セッションの読み取り(ports)。Claude Code のログ形式
/// (`~/.claude/projects/` の走査、JSONL解析)に固有の詳細はこの抽象の
/// 向こう側(infra)に閉じ込め、`app` はプロジェクト名・セッションIDなどの
/// 抽象的な値だけを扱う。
pub trait SessionSource {
    fn list_projects(&self) -> Result<Vec<Project>, AppError>;

    /// 指定セッションの会話ファイルを**1回だけ**読み、表示用のメッセージ(記録順)と
    /// `LogLine` 一覧を返す(issue #350)。従来は `session`(メッセージ)と
    /// `session_lines`(LogLine)が別々に全行を読んでいた(同じ巨大ファイルを2回)。
    /// 各行のパースも1行1回にすること。行の変換に失敗した行(uuid/timestamp欠損等)は
    /// 実装側でスキップし、警告ログを出すこと(issue #208 本文の指示)。
    /// 返す `fingerprint` は**読み始める前**のファイルの状態(読んでいる途中で
    /// ファイルが伸びても、次回の照合で「古い」と判定されて読み直される側に倒す)。
    fn read_session(&self, project: &str, session_id: &str) -> Result<SessionContent, AppError>;

    /// 指定セッションの会話ファイルの現在の状態(更新時刻 + サイズ)だけを返す
    /// (中身は読まない)。解析済みのキャッシュが今のファイルと合っているかの照合に使う
    /// (issue #350)。
    fn session_fingerprint(
        &self,
        project: &str,
        session_id: &str,
    ) -> Result<FileFingerprint, AppError>;

    /// 指定セッション自身の作業ディレクトリ(cwd)を返す。`AgentGateway` へ渡す
    /// `SendRequest` を組み立てるために使う(issue #345: `--resume <ID>` は
    /// 対象セッションをIDで直接指定するため、フォルダ内の最新ではなく対象
    /// セッション自身のcwdを使う)。
    fn session_cwd(&self, project: &str, session_id: &str) -> Result<PathBuf, AppError>;

    /// 指定プロジェクトの全セッションを一覧表示用に要約して返す(ビューア
    /// 左ペイン用。issue #33)。
    fn list_sessions(&self, project: &str) -> Result<Vec<SessionSummary>, AppError>;

    /// 指定プロジェクトの全セッションを `ParsedSession`(`User::load_sessions`
    /// への入力。session_id/custom_title/ai_title/mode/slug/last_prompt、
    /// 会話ファイル・サブエージェントファイルのパスを持つ)として返す
    /// (オブジェクトモデル実装 第4〜5弾。issue #197/#208)。`list_sessions`
    /// と同じ走査(jsonlの全行読み)に相乗りし、フルパースをもう1周増やさない
    /// 実装にすること(実装側は `list_sessions` と同じキャッシュを共有して
    /// よい)。行(`LogLine`)自体はここでは読まない(遅延読み込み)。
    ///
    /// issue #197で追加した`list_session_models`(ファイルパスを持たない
    /// 版)は、この`ParsedSession`に統合したため廃止した。
    fn list_parsed_sessions(&self, project: &str) -> Result<Vec<ParsedSession>, AppError>;

    /// 指定セッションの会話ファイルから、`uuid` が一致する行の**生のテキスト**を返す
    /// (ビューアの「データ」表示。issue #313)。読み取りのみ。見つからなければ
    /// `AppError::NotFound`。メッセージ一覧には生の行を載せず、必要なときだけ
    /// この問い合わせで取る(tool 結果などで行が非常に大きいことがあるため)。
    fn session_line_raw(
        &self,
        project: &str,
        session_id: &str,
        uuid: &str,
    ) -> Result<String, AppError>;
}

/// アプリ設定の永続化(port)。実体(ファイル形式・保存先の解決)は infra に
/// 閉じ込める。`app` は `Settings` という抽象的な値だけを扱う。
pub trait SettingsStore {
    fn load(&self) -> Result<LoadedSettings, AppError>;
    fn save(&self, settings: &Settings) -> Result<(), AppError>;
}

/// `CLAUDE.md` の読み書き(port)。`repo_dir` の解決(設定リポジトリ/
/// プロジェクトの作業ディレクトリのどちらから求めるか)は呼び出し側
/// (tauri層)の責務で、`app`/`infra` はディレクトリを受け取るだけ
/// (native.md §4: パス解決はフロントに渡さずRust側で行うが、この境界は
/// tauri層とapp/infra層の間にも適用し、ports は解決済みパスのみを扱う)。
pub trait ClaudeMdStore {
    /// `repo_dir/CLAUDE.md` を読む。ファイルが無ければ `Ok(None)`。
    fn read(&self, repo_dir: &Path) -> Result<Option<ClaudeMdFile>, AppError>;
    /// `repo_dir/CLAUDE.md` へ書く(無ければ新規作成)。
    fn write(&self, repo_dir: &Path, content: &str) -> Result<(), AppError>;
}

/// `~/.claude/settings.json` の読み書き(port)。対象は常に1ファイルに固定
/// されているため、`ClaudeMdStore` と異なりパスを引数に取らない。ホーム
/// ディレクトリの解決は `infra` の責務(issue #53)。
pub trait ClaudeSettingsStore {
    /// ファイルが無ければ `Ok(None)`。
    fn read(&self) -> Result<Option<ClaudeSettingsFile>, AppError>;
    /// 無ければ新規作成する。
    fn write(&self, content: &str) -> Result<(), AppError>;
}

/// `<repo_dir>/.claude/rules/*.md` の読み取り専用アクセス(port)。`repo_dir`
/// の解決は呼び出し側(tauri層)の責務(`ClaudeMdStore` と同じ分担。
/// issue #61)。編集は対象外(表示のみ)。
pub trait RulesStore {
    /// `.md` ファイルをファイル名昇順で返す。ディレクトリが無ければ空。
    fn list(&self, repo_dir: &Path) -> Result<Vec<RuleSummary>, AppError>;
    /// `repo_dir/.claude/rules/<file_name>` の内容を読む。
    fn read(&self, repo_dir: &Path, file_name: &str) -> Result<String, AppError>;
}

/// `<repo_dir>/.claude/skills/<name>/SKILL.md` の読み取り専用アクセス
/// (port)。`RulesStore` と同じ分担だが、一覧の単位はファイルではなく
/// `SKILL.md` を持つディレクトリ名(issue #65)。
pub trait SkillsStore {
    /// `SKILL.md` を持つディレクトリのみ、スキル名昇順で返す。
    /// ディレクトリが無ければ空。
    fn list(&self, repo_dir: &Path) -> Result<Vec<SkillSummary>, AppError>;
    /// `repo_dir/.claude/skills/<name>/SKILL.md` の内容を読む。
    fn read(&self, repo_dir: &Path, name: &str) -> Result<String, AppError>;
}

/// プロジェクトの `.claude/` 配下にある2種類の設定ファイル(issue #70)。
/// フロントからファイル名を自由入力させず、この enum で選ばせることで
/// パスを固定する(native.md §4)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectSettingsFile {
    Settings,
    SettingsLocal,
}

/// `<repo_dir>/.claude/settings.json` / `settings.local.json` の読み書き
/// (port)。`~/.claude/settings.json`(ユーザーレベル)を扱う
/// `ClaudeSettingsStore` とは対象パスが異なるため別に用意する(issue #70)。
pub trait ProjectSettingsStore {
    /// ファイルが無ければ `Ok(None)`。
    fn read(
        &self,
        repo_dir: &Path,
        which: ProjectSettingsFile,
    ) -> Result<Option<ClaudeSettingsFile>, AppError>;
    /// 無ければ新規作成する。
    fn write(
        &self,
        repo_dir: &Path,
        which: ProjectSettingsFile,
        content: &str,
    ) -> Result<(), AppError>;
}

/// 起動時に読み込んだ設定。ファイルが存在しない場合と破損していた場合を
/// 区別しない(どちらもデフォルト値へフォールバックする)が、破損からの
/// 復旧があったかどうかは呼び出し側(tauri層)が `app:warning` を出すか
/// どうかの判断に使うため保持する。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedSettings {
    pub settings: Settings,
    pub recovered_from_corruption: bool,
}

/// ハブグラフのノード位置の永続化(port)。`settings.json` とは別ファイルに
/// 保存する低重要度データであり、`SettingsStore` とは分離する(issue #121。
/// `domain::HubLayout` のドキュメントコメント参照)。
pub trait HubLayoutStore {
    fn load(&self) -> Result<HubLayout, AppError>;
    fn save(&self, layout: &HubLayout) -> Result<(), AppError>;
}

/// ハブグラフの force シミュレーション調整値の永続化(port。issue #249)。
/// `HubLayoutStore` と同じ流儀で、別ファイル(`hub-tuning.json`)に保存する
/// (`domain::HubTuning` のドキュメントコメント参照)。
pub trait HubTuningStore {
    fn load(&self) -> Result<HubTuning, AppError>;
    fn save(&self, tuning: &HubTuning) -> Result<(), AppError>;
}

/// ビューアのセッションタブの並び(`ViewerTabs`。issue #353)の永続化(port)。
/// プロファイルごとに別ファイルへ保存する(実体は infra)。
pub trait ViewerTabsStore {
    /// ファイルが無い・壊れている場合は空(`ViewerTabs::default()`)。
    fn load(&self, profile_id: &str) -> Result<ViewerTabs, AppError>;
    fn save(&self, profile_id: &str, tabs: &ViewerTabs) -> Result<(), AppError>;
}

/// 実行環境(このPC・ログインユーザー)の取得(port)。実体(レジストリ・
/// 環境変数の読み取り)は infra に閉じ込める(issue #182)。
pub trait ExecutionEnvironmentSource {
    fn current_pc(&self) -> Result<domain::Pc, AppError>;
}

/// 1リポジトリのGitの現在状態(ブランチ名一覧・worktree一覧)の観測
/// (port)。実体(`git`コマンドの実行)は infra に閉じ込める
/// (オブジェクトモデル実装 第3弾。issue #193)。既存の`GitWorktreeLister`
/// (issue #129。ローカルAPIサーバの書き込み先パス検証専用)とは目的が
/// 異なる別のportとして新設した — あちらは「このパスはworktreeか」という
/// 真偽判定だけを必要とする狭い用途であり、こちらはブランチ名・worktreeの
/// パスとチェックアウト中ブランチという台帳突き合わせに必要な情報一式を
/// 返す。1つのportに両方の関心を混ぜず分離した(実装時判断)。
pub trait GitStateSource {
    /// `repo_root`(登録済みプロファイルの`repository_path`)の現在状態を
    /// 観測する。gitコマンドの実行失敗やリポジトリ消失などで観測できない
    /// 場合は`Err`を返し、呼び出し元(`reconcile_git_ledger`)はそのリポジトリ
    /// の台帳をこの回は変更しない(fail-safe。issue本文の明示的な要求)。
    fn observe(&self, repo_root: &Path) -> Result<domain::ObservedGitState, AppError>;
}

/// `GitBranch`/`GitWorktree`台帳(`domain::GitLedger`)の永続化(port)。
/// `settings.json`・`hub-layout.json`とは別ファイルに保存する
/// (issue #193)。
pub trait GitLedgerStore {
    fn load(&self) -> Result<domain::GitLedger, AppError>;
    fn save(&self, ledger: &domain::GitLedger) -> Result<(), AppError>;
}

/// GitHub OAuth(デバイスフロー)+ Projects(v2) 取得(port)。実体(HTTP通信)は
/// infra に閉じ込める。将来 GitHub 以外の連携を足す可能性は現状ないため、
/// `AgentGateway` のような抽象化はせず GitHub 固有の port として定義する。
pub trait GithubGateway {
    fn start_device_flow(&self) -> Result<DeviceAuthorization, AppError>;
    fn poll_for_token(&self, device_code: &str) -> Result<PollResult, AppError>;
    fn fetch_viewer(&self, token: &str) -> Result<GithubViewer, AppError>;
    fn list_projects(&self, token: &str) -> Result<Vec<domain::GithubProjectSummary>, AppError>;

    /// 指定プロジェクトのアイテムを1ページ分取得する(ビューアの「GitHub
    /// Project」タブ用。issue #34)。`cursor` は前ページの
    /// `ProjectItemsPage::next_cursor`。`None` は先頭ページ。
    fn list_project_items(
        &self,
        token: &str,
        owner: &str,
        number: u32,
        cursor: Option<&str>,
    ) -> Result<domain::ProjectItemsPage, AppError>;

    /// Projects(v2)アイテムのStatusフィールド値を更新する(かんばんの
    /// ドラッグ&ドロップ用。issue #50)。`option_id` が `None` の場合は
    /// Status を未設定に戻す(`clearProjectV2ItemFieldValue`)。
    /// `project` スコープ(書き込み)が必要で、旧 `read:project` スコープの
    /// トークンでは `AppError::GithubScopeInsufficient` を返す。
    fn update_item_status(
        &self,
        token: &str,
        project_id: &str,
        item_id: &str,
        field_id: &str,
        option_id: Option<&str>,
    ) -> Result<(), AppError>;
}

/// GitHubのアクセストークンの保管(port)。実体(OSキーチェーン)は infra に
/// 閉じ込める。トークンは設定ファイル(JSON)には含めない(native.md §4)。
pub trait TokenStore {
    fn save(&self, token: &str) -> Result<(), AppError>;
    fn load(&self) -> Result<Option<String>, AppError>;
    fn delete(&self) -> Result<(), AppError>;
}

/// デバイスフロー開始時にGitHubから返る値。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceAuthorization {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval_secs: u64,
    pub expires_in_secs: u64,
}

/// トークンポーリング1回の結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PollResult {
    /// ユーザーがまだ認可していない。`interval_secs` 待って再試行する。
    Pending,
    /// ポーリング間隔が短すぎた。間隔を広げて再試行する。
    SlowDown,
    /// 認可完了。
    Token(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubViewer {
    pub login: String,
}

/// エージェントへのメッセージ送信(port)。将来 Gemini / Codex 等の別アダプタを
/// 追加する際、この抽象だけを実装すればよく `app` / `domain` の変更は不要。
pub trait AgentGateway {
    fn send(&self, req: SendRequest) -> Result<(), AppError>;
}

/// 実行中セッションの検出(port)。`--resume <ID>` は追記先をIDで直接指定する
/// ため表示中と別の会話への誤爆は起きないが、同じ会話ファイルへ他プロセス
/// (Claude Desktop本体・別ウィンドウ等)が並行して書き込み中だと追記が
/// 混線しうる。送信前にこれを検出しブロックするために使う(issue #345)。
/// 実体(`~/.claude/sessions/<PID>.json` の読み取りとプロセス生存確認)は
/// infra に閉じ込める。
pub trait RunningSessionSource {
    /// `session_id` が現在、他のプロセスの `claude` によって実行中(とみなせる)なら、
    /// その根拠を返す。実行中でないと確定できる場合だけ `None`。
    ///
    /// 「読めない・分からない」は実行中とみなす側に倒す(会話の混線という害が、
    /// 誤ってブロックする害より大きいため)。台帳の列挙・読み取りができず何も
    /// 判断できないときは `Err`(送信しない)。
    fn find_running(&self, session_id: &str) -> Result<Option<RunningSession>, AppError>;
}

/// 送信先が実行中とみなされた根拠(issue #345)。エラーメッセージに含め、誤って
/// 止められたときにユーザーが原因(台帳ファイル・PID)を見つけて自分で解消できる
/// ようにする(壊れた台帳の PID が別のプロセスに使い回されると、そのフォルダへの
/// 送信が止まり続けうるため)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunningSession {
    /// 根拠になった実行中セッション台帳(`~/.claude/sessions/<PID>.json`)のパス。
    pub ledger_path: PathBuf,
    pub pid: u32,
    pub evidence: RunningEvidence,
}

/// [`RunningSession`] の根拠の強さ。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunningEvidence {
    /// 台帳の `sessionId` が送信先と一致し、そのプロセスが生きている。
    SessionMatched,
    /// 台帳から `sessionId` を取り出せず(読めない・書き込み途中・欠落)送信先と
    /// 照合できないが、そのプロセスが生きているため、安全側で実行中とみなした。
    LedgerUnreadable,
}

impl RunningSession {
    /// 送信を止めるときにユーザーへ見せる理由。台帳のパスと PID を含める。
    fn block_message(&self) -> String {
        let path = self.ledger_path.display();
        match self.evidence {
            RunningEvidence::SessionMatched => format!(
                "このセッションは他のプロセス(PID {})で実行中です。しばらく待ってから再試行してください(台帳: {path})",
                self.pid
            ),
            RunningEvidence::LedgerUnreadable => format!(
                "実行中のセッションの台帳を読み取れず、このセッションと照合できないため、送信を止めました(台帳: {path}、PID {})。そのプロセスが終了していて台帳が壊れている・古い場合は、この台帳ファイルを削除してから再試行してください",
                self.pid
            ),
        }
    }
}

/// 送信時に許可する権限モード。
/// - `Chat`(既定): ツール実行を伴わない会話のみ
/// - `Read`: 読み取り専用ツールの実行を許可する(plan モード相当)。書き込み系の
///   操作は提案されるのみで実行されない
///
/// フルツール実行(`agent` モード)は、長時間実行の進捗表示・キャンセル・実行前
/// 確認UIが揃うまでスコープ外(issue #8 参照)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AgentMode {
    #[default]
    Chat,
    Read,
}

/// 送信対象の会話をどう継続するか。現時点では既存の会話への `--resume` の
/// みをサポートする(issue #345。新規セッションを明示的に開始するUIは
/// 将来の別イシューで扱う)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Continuation {
    /// この `session_id`(表示中セッション自身のID)へ `--resume` で継続する。
    Resume(String),
}

#[derive(Debug, Clone)]
pub struct SendRequest {
    pub cwd: PathBuf,
    pub text: String,
    /// 検証済みの添付画像(issue #349)。空なら従来どおり本文のみの送信。
    pub images: Vec<ImageAttachment>,
    pub mode: AgentMode,
    pub continuation: Continuation,
}

pub fn list_projects(source: &dyn SessionSource) -> Result<Vec<Project>, AppError> {
    let mut projects = source.list_projects()?;
    sort_projects_by_recency(&mut projects);
    Ok(projects)
}

/// 指定セッションのメッセージを新しい順に並べ、`offset`/`limit` で指定された
/// 範囲だけを返す(1回のIPCで会話全件を返さないため)。`session_id` は
/// フロント入力をそのままファイルパスの構築に使うことになるため、UUID形式
/// (英数字とハイフンのみ)であることを検証してから使う(native.md §4。
/// issue #33)。
///
/// `cached`(このファイルの解析済みキャッシュ)が今のファイルの状態
/// (更新時刻 + サイズ)と合っていれば、ファイルは読まずにそこから範囲を切り出す
/// (ページ送りで巨大な会話ファイルを読み直さない。issue #350)。合っていなければ
/// `read_session` で1回だけ読み直し、キャッシュへ入れるべき内容を `reloaded` で返す。
pub fn open_session(
    source: &dyn SessionSource,
    cached: Option<&CachedMessages>,
    project: &str,
    session_id: &str,
    offset: usize,
    limit: usize,
) -> Result<OpenedSession, AppError> {
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let current = source.session_fingerprint(project, session_id)?;
    if let Some(cached) = cached.filter(|c| c.fingerprint == current) {
        return Ok(OpenedSession {
            conversation: page_of_conversation(session_id, &cached.messages, offset, limit),
            reloaded: None,
        });
    }
    let reloaded = reload_session(source, project, session_id)?;
    Ok(OpenedSession {
        conversation: page_of_conversation(session_id, &reloaded.messages.messages, offset, limit),
        reloaded: Some(reloaded),
    })
}

/// 読み直した内容 `incoming` で、既にあるキャッシュ `existing` を置き換えてよいか
/// (issue #350)。`get_session` と差分再走査は別々のタイミングで同じファイルを読み直し、
/// 終わった順にキャッシュへ書き込むため、遅れて終わった**古い状態の読み**が
/// 新しい状態のキャッシュを上書きしないよう、更新時刻が戻る置き換えは避ける。
pub fn should_replace_cache(existing: Option<&CachedMessages>, incoming: &CachedMessages) -> bool {
    existing.is_none_or(|e| e.fingerprint.modified_nanos <= incoming.fingerprint.modified_nanos)
}

/// 新しい順に並べ済みの `messages` から、表示する範囲の `Conversation` を作る。
fn page_of_conversation(
    session_id: &str,
    messages_newest_first: &[Message],
    offset: usize,
    limit: usize,
) -> Conversation {
    Conversation {
        id: session_id.to_string(),
        messages: paginate_messages(messages_newest_first, offset, limit),
        agent: domain::AgentKind::ClaudeCode,
    }
}

/// 指定セッションの会話ファイルを1回読み、キャッシュへ入れる形(メッセージは新しい順、
/// `LogLine` 一覧つき)で返す(issue #350。旧 `get_session` + `load_session_lines` の
/// 2回読みを置き換えた)。ファイルの変更を検知した差分再走査(tauri 層)が、
/// 読み込み済みのセッションのキャッシュを更新するときにも使う。
pub fn reload_session(
    source: &dyn SessionSource,
    project: &str,
    session_id: &str,
) -> Result<ReloadedSession, AppError> {
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let SessionContent {
        fingerprint,
        mut messages,
        lines,
    } = source.read_session(project, session_id)?;
    // 送信に失敗した質問とエラー行に印を付ける(表示のためだけ。会話ファイルには触らない。
    // issue #364)。記録順のうちに付け、そのあと新しい順に並べる。
    mark_failed_questions(&mut messages);
    order_messages_newest_first(&mut messages);
    Ok(ReloadedSession {
        messages: CachedMessages {
            fingerprint,
            messages: Arc::new(messages),
        },
        lines,
    })
}

/// 指定メッセージ(会話チェーン行の `uuid`)の元の jsonl 行を、生のテキストで
/// 返す(issue #313)。フロントから受け取った値はパスの構築に使うため、ここで
/// 検証する(native.md §4)。
pub fn get_session_line_raw(
    source: &dyn SessionSource,
    project: &str,
    session_id: &str,
    uuid: &str,
) -> Result<String, AppError> {
    if !is_valid_project_dir_name(project) {
        return Err(AppError::InvalidInput(
            "不正なプロジェクト名です".to_string(),
        ));
    }
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    // uuid はファイルパスには使わないが、行の照合キーとして想定外の値
    // (空など)を弾く。形式は session_id と同じ(英数字とハイフン)。
    if !is_valid_session_id(uuid) {
        return Err(AppError::InvalidInput("不正なメッセージIDです".to_string()));
    }
    source.session_line_raw(project, session_id, uuid)
}

/// `pc`の各ユーザーが持つ`Session.conversation_files`/`subagent_files`へ、
/// 読み込み済みの`LogLine`キャッシュ(ファイルパスをキーにする)を差し込む
/// (issue #208)。`load_sessions`が常に空Vecで組み立てた`lines`のうち、
/// 実際に開かれてキャッシュ済みのものだけを埋める(遅延読み込み)。
/// `conversation_files`は issue #217 で1..*になったため、各ファイルを
/// パスで個別に照合する。
pub fn pc_with_loaded_lines(
    mut pc: domain::Pc,
    loaded_lines: &HashMap<PathBuf, Vec<LogLine>>,
) -> domain::Pc {
    for user in &mut pc.users {
        for session in &mut user.sessions {
            for file in &mut session.conversation_files {
                if let Some(lines) = loaded_lines.get(&file.file_path) {
                    file.lines = lines.clone();
                }
            }
        }
    }
    pc
}

/// `Session`の表示補助データ(issue #224)。`domain::Session`には持たせない
/// (TMの決定: cwd/git_branchはLogLineの属性でありSessionの属性ではない)ため、
/// `SessionDto`(tauri側)へ差し込むための中間値として`resolve_session_display_hints`
/// が返す。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionDisplayHint {
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
}

/// `parsed`(`AppState.user_sessions`)から、`session_id`ごとの表示補助データ
/// (cwd/git_branch。issue #224)を解決する。同じ`session_id`の`ParsedSession`が
/// 複数あれば(worktree移動。issue #217の集約と同じケース)、`modified_at_ms`の
/// 古い順に見て値がある(`Some`)方で上書きする(`domain::User::load_sessions`の
/// 属性解決規則と同じ)。呼び出し側(`get_pc` command)が`SessionDto`へ差し込む。
pub fn resolve_session_display_hints(
    parsed: &[ParsedSession],
) -> HashMap<String, SessionDisplayHint> {
    let mut sorted: Vec<&ParsedSession> = parsed.iter().collect();
    sorted.sort_by_key(|p| p.modified_at_ms);

    let mut hints: HashMap<String, SessionDisplayHint> = HashMap::new();
    for p in sorted {
        let hint = hints.entry(p.session_id.clone()).or_default();
        if p.cwd.is_some() {
            hint.cwd = p.cwd.clone();
        }
        if p.git_branch.is_some() {
            hint.git_branch = p.git_branch.clone();
        }
    }
    hints
}

/// 指定プロジェクトのセッション一覧を、最終更新の新しい順に並べて返す(ビューア
/// 左ペイン用。issue #33)。1件 = 1セッション(セッションID = 会話ファイル)で、
/// フォークや圧縮で分かれたファイルもそれぞれ別のセッションとして全件返す
/// (issue #369。#345 の「系列ごとに最新ファイルへ畳む」扱いは廃止した)。
pub fn list_sessions(
    source: &dyn SessionSource,
    project: &str,
) -> Result<Vec<SessionSummary>, AppError> {
    let mut sessions = source.list_sessions(project)?;
    sort_sessions_newest_first(&mut sessions);
    Ok(sessions)
}

/// `session_id`(表示中のセッション)へ `--resume` でメッセージを送信する
/// (issue #345)。
///
/// 継続方式を `--continue`(カレントディレクトリの最新の会話をそのまま
/// 継続)から `--resume <ID>` へ変えたことで、旧実装が必要としていた
/// 「表示中セッションが実際に最新か」の事前検証(`SessionStale`)と、
/// 送信前後の競合窓を検出する事後検証(`SessionMismatch`/`app:warning`)は
/// 撤廃した。どちらも「`--continue` はその時点の最新会話に無言で追記する」
/// という性質に起因する不変条件であり、追記先をIDで直接指定する
/// `--resume` にはそもそも当てはまらない(存在しないIDを渡せば `claude`
/// 自体がエラーになる)。
///
/// 代わりに必要になるのは「対象セッションが今まさに他プロセス
/// (Claude Desktop本体・別ウィンドウ等)で実行中でないか」の確認である。
/// 同じ会話ファイルへの並行書き込みによる混線を防ぐため、送信前に
/// `RunningSessionSource` で確認し、実行中なら `SessionBusy` を返して
/// 送信しない。
///
/// `images`(base64。issue #349)があれば検証して添付する。本文が空でも画像が
/// あれば送れる(画像だけの送信)。画像の有無にかかわらず、上記の実行中ガードは
/// 同じように効く。
// 引数が8個になるが、独立した入力(ports 3つ・対象・本文・画像・モード)で、
// まとめる構造体を作るほどの意味的なまとまりは無いため許容する。
#[allow(clippy::too_many_arguments)]
pub fn send_message(
    source: &dyn SessionSource,
    agent: &dyn AgentGateway,
    running_sessions: &dyn RunningSessionSource,
    project: &str,
    session_id: &str,
    text: &str,
    images: &[String],
    mode: AgentMode,
) -> Result<(), AppError> {
    if text.trim().is_empty() && images.is_empty() {
        return Err(AppError::InvalidInput(
            "メッセージを入力してください".to_string(),
        ));
    }
    let images =
        validate_image_attachments(images).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }

    if let Some(running) = running_sessions.find_running(session_id)? {
        return Err(AppError::SessionBusy(running.block_message()));
    }

    let cwd = source.session_cwd(project, session_id)?;
    agent.send(SendRequest {
        cwd,
        text: text.to_string(),
        images,
        mode,
        continuation: Continuation::Resume(session_id.to_string()),
    })?;

    Ok(())
}

/// 画像を1枚添付しようとしたときの事前検証(ビューアの添付時。issue #349)。
/// `existing_count` は既に添付済みの枚数。形式・サイズ・枚数の判定は送信時
/// ([`send_message`])と同じ domain の関数を通すため、規則の実体は1か所に保たれる
/// (フロントに上限値を持たせない)。
pub fn check_image_attachment(data_base64: &str, existing_count: usize) -> Result<(), AppError> {
    validate_image_count(existing_count.saturating_add(1))
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    validate_image_attachment(data_base64)
        .map(|_| ())
        .map_err(|e| AppError::InvalidInput(e.to_string()))
}

/// 指定メッセージ(会話チェーン行の `uuid`)に含まれる画像を、記録順に返す
/// (ビューアの「画像 n 枚」。issue #349)。`get_session_line_raw`(#313)と同じ
/// オンデマンド取得で、メッセージ一覧には画像本体を載せない。行が見つからなければ
/// `AppError::NotFound`、画像の無い行は空。
pub fn get_session_line_images(
    source: &dyn SessionSource,
    project: &str,
    session_id: &str,
    uuid: &str,
) -> Result<Vec<MessageImage>, AppError> {
    let raw = get_session_line_raw(source, project, session_id, uuid)?;
    Ok(extract_message_images(&raw))
}

/// 起動時、保存済みの設定を読み込む。ファイルが存在しない/壊れている場合の
/// デフォルト値へのフォールバックは `SettingsStore` 実装(infra)側の責務。
pub fn load_settings(store: &dyn SettingsStore) -> Result<LoadedSettings, AppError> {
    store.load()
}

/// ハブグラフのノード位置(ドラッグ固定)を読み込む。ファイルが存在しない/
/// 壊れている場合のデフォルト値へのフォールバックは `HubLayoutStore` 実装
/// (infra)側の責務(issue #121)。
pub fn load_hub_layout(store: &dyn HubLayoutStore) -> Result<HubLayout, AppError> {
    store.load()
}

/// 起動時、実行環境から現在のPC情報(system_uuid・pc_name・ログイン
/// ユーザー)を取得する。個々の項目の取得失敗時のプレースホルダへの
/// フォールバックは `ExecutionEnvironmentSource` 実装(infra)側の責務で、
/// この関数自体はアプリを止めるようなエラーを返さない(issue #182)。
pub fn current_pc(source: &dyn ExecutionEnvironmentSource) -> Result<domain::Pc, AppError> {
    source.current_pc()
}

/// `pc` の各ユーザーに、現在の settings から組み立てた `GitRepository` 一覧を
/// 差し込む(オブジェクトモデル実装 第2弾。issue #189)。
///
/// `GitRepository` の真実の源は settings のプロファイルであり、`AppState` に
/// 保持せず(専用の永続化・同期は持たない)、クエリのたびにここで都度組み立て
/// る設計を選んだ(issue本文の実装時判断(b))。理由: (a) `AppState.pc` に
/// 保持する案は、プロファイルを増減・変更する既存のユースケース
/// (`create_profile`/`delete_profile`/`update_settings` 等)すべてで再構築が
/// 必要になり変更点が広がるのに対し、(b) はこの関数1箇所に閉じるため
/// settings変更への追従(鮮度)を単純に保証できる。
pub fn current_pc_with_repositories(mut pc: domain::Pc, settings: &Settings) -> domain::Pc {
    let repositories = repositories_from_profiles(&settings.profiles);
    for user in &mut pc.users {
        user.repositories = repositories.clone();
    }
    pc
}

/// `GitBranch`/`GitWorktree`台帳を読み込む。ファイルが存在しない/壊れている
/// 場合のデフォルト値へのフォールバックは`GitLedgerStore`実装(infra)側の
/// 責務(issue #193)。
pub fn load_git_ledger(store: &dyn GitLedgerStore) -> Result<GitLedger, AppError> {
    store.load()
}

/// `GitBranch`/`GitWorktree`台帳を保存する(issue #193)。
pub fn save_git_ledger(store: &dyn GitLedgerStore, ledger: &GitLedger) -> Result<(), AppError> {
    store.save(ledger)
}

/// 登録済み全リポジトリについて現在のGit状態を観測し、台帳を突き合わせて
/// 更新する(オブジェクトモデル実装 第3弾。issue #193)。起動時とハブの
/// 再読み込み操作時に呼び出し、結果は`AppState`が保持する
/// (`current_pc_with_repositories`(issue #189)と違いクエリのたびには
/// 実行しない。理由: あちらはメモリ上のsettingsを読むだけだが、こちらは
/// `git`サブプロセスの起動を伴い、`get_pc`のような頻繁な呼び出し元で
/// 毎回実行するには重すぎる)。
///
/// リポジトリ単位で観測が失敗した場合(リポジトリが消えた、gitコマンドが
/// 失敗した等)は、そのリポジトリの台帳をこの回は一切変更せず前回の内容を
/// そのまま引き継ぐ(fail-safe。誤って大量削除扱いにしないため。
/// issue本文の明示的な要求)。ここでは呼び出し元(tauri層)にログ出力を
/// 任せず、失敗したリポジトリパスの一覧を戻り値に含めて呼び出し元が警告を
/// 出せるようにする。
pub struct ReconcileGitLedgerResult {
    pub ledger: GitLedger,
    pub failed_repository_paths: Vec<PathBuf>,
}

pub fn reconcile_git_ledger(
    source: &dyn GitStateSource,
    previous_ledger: &GitLedger,
    repository_paths: &[PathBuf],
    now: u64,
    mut generate_id: impl FnMut() -> String,
) -> ReconcileGitLedgerResult {
    let mut repositories = previous_ledger.repositories.clone();
    let mut failed_repository_paths = Vec::new();

    for repo_path in repository_paths {
        let key = repo_path.display().to_string();
        match source.observe(repo_path) {
            Ok(observed) => {
                let existing = repositories.get(&key).cloned().unwrap_or_default();
                let branches = reconcile_branches(
                    &existing.branches,
                    &observed.branch_names,
                    now,
                    &mut generate_id,
                );
                let branch_id_by_name: HashMap<String, String> = branches
                    .iter()
                    .filter(|b| b.deleted_at_time.is_none())
                    .map(|b| (b.branch_name.clone(), b.branch_id.clone()))
                    .collect();
                let worktrees = reconcile_worktrees(
                    &existing.worktrees,
                    &observed.worktrees,
                    &branch_id_by_name,
                    now,
                    &mut generate_id,
                );
                repositories.insert(
                    key,
                    GitRepositoryLedger {
                        branches,
                        worktrees,
                    },
                );
            }
            Err(_) => {
                failed_repository_paths.push(repo_path.clone());
            }
        }
    }

    ReconcileGitLedgerResult {
        ledger: GitLedger {
            version: CURRENT_GIT_LEDGER_VERSION,
            repositories,
        },
        failed_repository_paths,
    }
}

/// `pc`の各ユーザーが持つ`GitRepository`へ、台帳(`GitLedger`)から該当分の
/// `branches`/`worktrees`を差し込む(issue #193)。`current_pc_with_repositories`
/// (issue #189)の後段として呼ぶ想定。台帳に無いリポジトリ(まだ一度も
/// 突き合わせていない等)は空のままにする。
pub fn pc_with_git_ledger(mut pc: domain::Pc, ledger: &GitLedger) -> domain::Pc {
    for user in &mut pc.users {
        for repository in &mut user.repositories {
            let key = repository.repository_path.display().to_string();
            if let Some(repo_ledger) = ledger.repositories.get(&key) {
                repository.branches = repo_ledger.branches.clone();
                repository.worktrees = repo_ledger.worktrees.clone();
            }
        }
    }
    pc
}

/// [`build_user_sessions`] の結果。プロジェクト単位で読み取りに失敗しても
/// 他のプロジェクトの結果は失わない(fail-safe。`reconcile_git_ledger`と
/// 同じ設計判断。issue #197)。失敗したプロジェクト名は呼び出し元が警告を
/// 出せるように残す。
pub struct BuildUserSessionsResult {
    pub parsed: Vec<ParsedSession>,
    pub failed_projects: Vec<String>,
}

/// 全プロジェクトから `ParsedSession`(`User::load_sessions`への入力。
/// issue #197/#208)の一覧を組み立てる。対象範囲は
/// `SessionSource::list_projects` が返す全プロジェクト(既存の
/// `list_sessions` の呼び出しパターンと同じ範囲。issue本文の指示)。
///
/// ここで行うのはファイル走査(jsonlのメタ情報の読み取り・ファイルパスの
/// 列挙)までで、`Session`/`SessionFile`インスタンスの組み立て自体は
/// `domain::User::load_sessions`(純粋関数)が担う(呼び出し元
/// `pc_with_user_sessions`参照)。gitコマンドほどではないがjsonl走査コストが
/// あるため、`GitLedger`(第3弾)と同じくクエリのたびには実行せず、起動時と
/// ハブ再読み込み時にのみ実行する(`get_pc`では実行しない)。
pub fn build_user_sessions(
    source: &dyn SessionSource,
) -> Result<BuildUserSessionsResult, AppError> {
    let projects = source.list_projects()?;
    let mut parsed = Vec::new();
    let mut failed_projects = Vec::new();
    for project in projects {
        match source.list_parsed_sessions(&project.name) {
            Ok(mut project_sessions) => parsed.append(&mut project_sessions),
            Err(_) => failed_projects.push(project.name),
        }
    }
    Ok(BuildUserSessionsResult {
        parsed,
        failed_projects,
    })
}

/// `pc`の各ユーザーへ、走査済みの`ParsedSession`一覧から`Session`/
/// `SessionFile`を組み立てて差し込む(issue #197/#208)。組み立て自体
/// (`User::load_sessions`)はI/Oを伴わない純粋な変換のため、ここで
/// (クエリのたびに)呼び出してもファイルの再走査にはならない。
/// `pc_with_git_ledger`と同様、複数ユーザーがいてもクラス図どおり同じ
/// 一覧を全ユーザーに割り当てる(現状のスコープでは常に1ユーザー)。
pub fn pc_with_user_sessions(mut pc: domain::Pc, parsed: Vec<ParsedSession>) -> domain::Pc {
    for user in &mut pc.users {
        user.load_sessions(parsed.clone());
    }
    pc
}

/// 保持中の`Pc`ツリーへ、素材(`ParsedSession`)から`Session`/`SessionFile`を
/// 組み立て直して反映する(Session常駐化 PoC)。
///
/// 従来は`get_pc`のたびに`pc_with_user_sessions`で使い捨てのツリーを組み立てて
/// いたが、常駐化後は**素材が変わったとき**(走査キューの完了・差分再走査)に
/// この関数で保持ツリーを更新し、クエリ時はDTO変換だけにする。
/// 組み立て(`User::load_sessions`)はI/Oを伴わない純粋変換のため、変更のたびに
/// 全ユーザー分を再構築しても走査は発生しない(`session_id`単位の部分再集約は
/// 現状のセッション件数では不要と判断。必要になれば`User`側に部分更新を足す)。
pub fn refresh_user_sessions(pc: &mut domain::Pc, parsed: &[ParsedSession]) {
    for user in &mut pc.users {
        user.load_sessions(parsed.to_vec());
    }
}

/// 走査キュー(セッション一覧の逐次読み込み。PoC)の1件完了を
/// `AppState.user_sessions` へ反映する。キーは会話ファイルパス
/// (同一パスは置換・無ければ追加)。同一 `session_id` の別ファイル
/// (worktree移動。issue #214)は別エントリのまま保持し、`Session` への
/// 集約は従来どおり `User::load_sessions`(issue #217)が行う。
pub fn upsert_parsed_session(sessions: &mut Vec<ParsedSession>, parsed: ParsedSession) {
    if let Some(existing) = sessions
        .iter_mut()
        .find(|p| p.conversation_file_path == parsed.conversation_file_path)
    {
        *existing = parsed;
    } else {
        sessions.push(parsed);
    }
}

/// 走査キュー(PoC)の全件完了時に、今回の列挙に存在しなかった会話ファイルの
/// `ParsedSession` を取り除く(走行中に削除されたファイル・前回走査の残骸の
/// 後始末)。
pub fn retain_enumerated_parsed_sessions(
    sessions: &mut Vec<ParsedSession>,
    enumerated_paths: &std::collections::HashSet<PathBuf>,
) {
    sessions.retain(|p| enumerated_paths.contains(&p.conversation_file_path));
}

/// ビューアのウィンドウの初期タイトル(issue #348)。「<プロファイル名> - <フォルダ名>」で、
/// 対象フォルダが複数のときは「 / 」でつなぎ、無いときはプロファイル名だけ。
/// ウィンドウ生成時(`open_profile_window`)の値で、その後の設定変更への追従は
/// フロント(`Layout.tsx` の `viewerWindowTitle`。同じ規則)が `setTitle` で行う。
pub fn viewer_window_title(profile_name: &str, selected_project_folders: &[String]) -> String {
    if selected_project_folders.is_empty() {
        profile_name.to_string()
    } else {
        format!("{profile_name} - {}", selected_project_folders.join(" / "))
    }
}

/// 削除された会話ファイルの `ParsedSession` を取り除く(ファイル監視による差分
/// 再走査。issue #311)。同一 `session_id` の別ファイル(worktree 移動。#214)は
/// 別エントリのため残り、`Session` としては集約(#217)の結果その別ファイルの
/// ぶんが残る。取り除いたかどうかを返す。
pub fn remove_parsed_session(sessions: &mut Vec<ParsedSession>, file_path: &Path) -> bool {
    let before = sessions.len();
    sessions.retain(|p| p.conversation_file_path != file_path);
    sessions.len() != before
}

/// ファイル監視が検知した会話ファイルの変更を、差分再走査へまとめて渡すための
/// 待ち行列(issue #311)。純粋なデータ構造で、時間(待ち時間)は持たない。
///
/// 書き込み中の jsonl は頻繁に更新されるため、変更のたびに走査すると暴れる。
/// 呼び出し側は「ワーカーは常に高々1つ。動いていなければ起動し、1回の処理が
/// 終わるたびに最短間隔だけ待ってから、溜まった変更をまとめて取り出す」運用に
/// する。同じファイルの変更は集合で1件に畳まれるので、書き込みが頻発しても
/// 1ファイルの走査は「最短間隔+走査時間」に1回に収まる。
#[derive(Debug, Default)]
pub struct RescanQueue {
    pending: std::collections::BTreeSet<PathBuf>,
    worker_running: bool,
}

impl RescanQueue {
    /// 変更を溜める。ワーカーを新たに起動する必要があるとき(動いていなかった
    /// とき)だけ `true` を返し、その場でワーカーを「動いている」状態にする。
    pub fn push(&mut self, paths: impl IntoIterator<Item = PathBuf>) -> bool {
        self.pending.extend(paths);
        if self.pending.is_empty() || self.worker_running {
            return false;
        }
        self.worker_running = true;
        true
    }

    /// 溜まった変更をすべて取り出す。何も無ければワーカーを「止まった」状態に
    /// して `None` を返す(呼び出し側はそのままワーカーを終える)。
    /// 取り出しと停止の判定を1回の呼び出し(=1回のロック)で行うことで、
    /// 「空を確認した直後に変更が来たのに、ワーカーが終わっていて誰も処理しない」
    /// 取りこぼしを防ぐ。
    pub fn take_or_stop(&mut self) -> Option<Vec<PathBuf>> {
        if self.pending.is_empty() {
            self.worker_running = false;
            return None;
        }
        Some(std::mem::take(&mut self.pending).into_iter().collect())
    }
}

/// ビューアのセッションタブの並びを読み込む(issue #353)。プロファイル ID は
/// ファイル名の構築に使うため検証する(native.md §4)。
pub fn load_viewer_tabs(
    store: &dyn ViewerTabsStore,
    profile_id: &str,
) -> Result<ViewerTabs, AppError> {
    validate_profile_id(profile_id)?;
    store.load(profile_id)
}

/// ビューアのセッションタブの並びを保存する(issue #353)。並びは呼び出し側が
/// 持つ全体で丸ごと置き換える。プロジェクト名・セッションIDを検証し、同じキーの
/// 重複は先頭だけを残す。`version` は現在のバージョンで書く。
pub fn save_viewer_tabs(
    store: &dyn ViewerTabsStore,
    profile_id: &str,
    tabs: Vec<ViewerTab>,
) -> Result<(), AppError> {
    validate_profile_id(profile_id)?;
    let mut unique: Vec<ViewerTab> = Vec::with_capacity(tabs.len());
    for tab in tabs {
        if !is_valid_project_dir_name(&tab.project) || !is_valid_session_id(&tab.session_id) {
            return Err(AppError::InvalidInput("不正なタブの指定です".to_string()));
        }
        if !unique.contains(&tab) {
            unique.push(tab);
        }
    }
    store.save(
        profile_id,
        &ViewerTabs {
            version: CURRENT_VIEWER_TABS_VERSION,
            tabs: unique,
        },
    )
}

fn validate_profile_id(profile_id: &str) -> Result<(), AppError> {
    // プロファイル ID は英数字とハイフンのみ(アプリが生成する uuid 等)。
    if is_valid_session_id(profile_id) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "不正なプロファイルIDです".to_string(),
        ))
    }
}

/// ハブグラフの調整値を読み込む。ファイルが存在しない/壊れている場合の
/// デフォルト値へのフォールバックは `HubTuningStore` 実装(infra)側の責務
/// (issue #249)。
pub fn load_hub_tuning(store: &dyn HubTuningStore) -> Result<HubTuning, AppError> {
    store.load()
}

/// ハブグラフの調整値を保存する(issue #249)。`version` は呼び出し側の値に
/// よらず現在のバージョンで書く。
pub fn save_hub_tuning(store: &dyn HubTuningStore, tuning: HubTuning) -> Result<(), AppError> {
    store.save(&HubTuning {
        version: CURRENT_HUB_TUNING_VERSION,
        ..tuning
    })
}

/// ハブグラフのノード位置を丸ごと置き換えて保存する。マージではなく置き換え
/// にすることで、既に存在しないノードの位置が自然に消える(issue #121)。
pub fn save_hub_layout(
    store: &dyn HubLayoutStore,
    positions: HashMap<String, NodePosition>,
    camera: Option<Camera>,
) -> Result<(), AppError> {
    let layout = HubLayout {
        version: CURRENT_HUB_LAYOUT_VERSION,
        positions,
        camera,
    };
    store.save(&layout)
}

/// ローカルAPIサーバ(native.md §7)の既定ポート。ハードコードの散在を防ぐため
/// ここに1箇所だけ定義する(issue #122)。
pub const LOCAL_API_PORT: u16 = 14200;

/// `POST /layout/{diagram}` で受け付ける図名の許可リスト(issue #122)。
/// `apps/web` の `src/data/layout/<diagram>.json` に対応する。
pub const ALLOWED_LAYOUT_DIAGRAMS: [&str; 3] = ["sitemap", "classes", "tm"];

/// レイアウトJSON(`apps/web/src/data/layout/<diagram>.json`)の書き込み
/// (port)。パスの組み立て(`save_layout` 参照)はこの port の外(app層)の
/// 責務で、実装(infra)は解決済みパスへの汎用アトミック書き込みだけを担う
/// (issue #122)。
pub trait LayoutStore {
    fn save(&self, path: &Path, content: &serde_json::Value) -> Result<(), AppError>;
}

/// ローカルAPIサーバの認証トークンの永続化(port)。実体(ファイル形式・
/// 保存先の解決)は infra に閉じ込める(issue #122)。
pub trait LocalApiTokenStore {
    fn save(&self, token: &str) -> Result<(), AppError>;
}

/// 指定リポジトリに属する git worktree の一覧(port)。`repo_root` が
/// 登録済みプロファイルの `repository_path` そのものだけでなく、その
/// worktree(`git worktree add` で作られた作業ツリー)であっても保存を
/// 許可するために使う(issue #129)。実体(`git` コマンドの実行)は infra に
/// 閉じ込める。
pub trait GitWorktreeLister {
    /// `repo_root` で `git worktree list` を実行し、そのリポジトリに属する
    /// 全worktreeの絶対パス(mainのworktree自身を含む)を返す。
    fn list_worktree_paths(&self, repo_root: &Path) -> Result<Vec<PathBuf>, AppError>;
}

/// ローカルAPIサーバの認証トークンを新規生成する。アプリ起動のたびに
/// 呼び出し、前回のトークンは無効化する(native.md §7)。
pub fn generate_local_api_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 生成した認証トークンを永続化する。
pub fn save_local_api_token(store: &dyn LocalApiTokenStore, token: &str) -> Result<(), AppError> {
    store.save(token)
}

/// ローカルAPIサーバ経由のレイアウト保存(issue #122・#129)。`diagram` が
/// 許可リストに無ければ `NotFound`(HTTP層で404)を返す。`repo_root` は
/// 登録済みプロファイルの `repository_path` に完全一致するか、その
/// worktree(`GitWorktreeLister` で判定)である場合のみ許可し、
/// どちらでもなければ `InvalidInput`(HTTP層で403)を返す。CLAUDE.md の
/// 並行作業ルールにより通常の作業は worktree で行われるため、worktree
/// からの保存を拒否すると実運用と噛み合わない(issue #129)。書き込み先
/// パスは `<repo_root>/apps/web/src/data/layout/<diagram>.json` に固定し、
/// クライアントから任意のパスを受け取らない(native.md §4・§7)。
pub fn save_layout(
    store: &dyn LayoutStore,
    worktrees: &dyn GitWorktreeLister,
    settings: &Settings,
    diagram: &str,
    repo_root: &Path,
    overrides: &serde_json::Value,
) -> Result<(), AppError> {
    if !ALLOWED_LAYOUT_DIAGRAMS.contains(&diagram) {
        return Err(AppError::NotFound(format!("未知の図名です: {diagram}")));
    }
    let is_registered = settings.profiles.iter().any(|profile| {
        let Some(registered_path) = profile.repository_path.as_deref() else {
            return false;
        };
        if registered_path == repo_root {
            return true;
        }
        // `git worktree list` の実行に失敗した場合(gitが無い等)は、
        // 許可の根拠が得られないため fail-closed(未登録扱い)にする。
        worktrees
            .list_worktree_paths(registered_path)
            .map(|paths| paths.iter().any(|path| path.as_path() == repo_root))
            .unwrap_or(false)
    });
    if !is_registered {
        return Err(AppError::InvalidInput(
            "登録されていないリポジトリです".to_string(),
        ));
    }
    let path = repo_root
        .join("apps/web/src/data/layout")
        .join(format!("{diagram}.json"));
    store.save(&path, overrides)
}

/// 設定項目のうち、この時点で検証できる最小限の内容(各プロファイルの
/// GitHubプロジェクトの owner が空でないこと)を確認する。GitHubプロジェクトの
/// 実在確認等の高度なバリデーションはスコープ外(issue #17)。
pub fn validate_settings(settings: &Settings) -> Result<(), AppError> {
    for profile in &settings.profiles {
        if let Some(project) = &profile.github_project {
            if !project.is_valid() {
                return Err(AppError::InvalidInput(
                    "GitHubプロジェクトのownerを入力してください".to_string(),
                ));
            }
        }
    }
    Ok(())
}

/// 新しい設定値を検証し、永続化する。保存に成功した設定値をそのまま返す
/// (呼び出し側がメモリ上の状態を更新する際に使う)。
pub fn update_settings(store: &dyn SettingsStore, input: Settings) -> Result<Settings, AppError> {
    validate_settings(&input)?;
    store.save(&input)?;
    Ok(input)
}

/// `profile_id` が指定されていればそのプロファイル、`None` ならアクティブ
/// (既定)プロファイルを返す。存在しないIDは `NotFound`(マルチウィンドウ
/// Phase 1。issue #76)。メインウィンドウは常に `None` を渡すため、この経路
/// では従来どおりアクティブプロファイルが使われる(挙動不変)。
pub fn resolve_profile<'a>(
    settings: &'a Settings,
    profile_id: Option<&str>,
) -> Result<&'a domain::Profile, AppError> {
    match profile_id {
        Some(id) => settings
            .profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| {
                AppError::NotFound("指定されたプロファイルが見つかりません".to_string())
            }),
        None => settings.active_profile().ok_or_else(|| {
            AppError::NotFound("アクティブなプロファイルが見つかりません".to_string())
        }),
    }
}

/// プロファイルの `repository_path`(対象リポジトリ)を解決する(issue #269)。
/// ビューアの CLAUDE.md / Rules / Skills / settings 系ビューは、セッションの
/// project フォルダではなくプロファイルのリポジトリを対象にする。パスは
/// フロントから受け取らず、必ず settings のプロファイルから引く(native.md §4・
/// §7 と同じ安全側の作り)。`profile_id` が `None` ならアクティブプロファイル
/// (`resolve_profile`)。未設定なら `InvalidInput`。
pub fn resolve_repository_dir(
    settings: &Settings,
    profile_id: Option<&str>,
) -> Result<PathBuf, AppError> {
    resolve_profile(settings, profile_id)?
        .repository_path
        .clone()
        .ok_or_else(|| {
            AppError::InvalidInput(
                "リポジトリが設定されていません。設定画面で対象リポジトリを指定してください"
                    .to_string(),
            )
        })
}

/// アクティブプロファイルを切り替える。`profile_id` が存在しなければ
/// `NotFound`(issue #72)。永続化・イベント通知は呼び出し側(tauri層)の
/// 責務(native.md §3.1)。
pub fn switch_profile(settings: &Settings, profile_id: &str) -> Result<Settings, AppError> {
    if !settings.profiles.iter().any(|p| p.id == profile_id) {
        return Err(AppError::NotFound(
            "指定されたプロファイルが見つかりません".to_string(),
        ));
    }
    Ok(Settings {
        active_profile_id: profile_id.to_string(),
        ..settings.clone()
    })
}

/// 空のプロファイルを作成してアクティブにする。`name` が省略・空文字の場合は
/// 「新しいプロファイル」を既定名にする。`id` はここ(app層)でUUIDを払い出す
/// (`Date.now` 系に依存しない安定ID。domainを純粋に保つため生成はdomain側に
/// 置かない。issue #72)。新設定と、作成したプロファイル自体の両方を返す
/// (呼び出し側がDTOの組み立てに使う)。
pub fn create_profile(settings: &Settings, name: Option<String>) -> (Settings, domain::Profile) {
    let name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "新しいプロファイル".to_string());
    let id = uuid::Uuid::new_v4().to_string();
    let profile = domain::Profile::new(id.clone(), name);

    let mut profiles = settings.profiles.clone();
    profiles.push(profile.clone());
    let updated = Settings {
        profiles,
        active_profile_id: id,
        ..settings.clone()
    };
    (updated, profile)
}

/// プロファイルを削除する。最後の1件は削除できない(`InvalidInput`)。
/// 存在しない `profile_id` は `NotFound`。アクティブプロファイルを削除した
/// 場合は残りの先頭をアクティブにする(issue #72)。
pub fn delete_profile(settings: &Settings, profile_id: &str) -> Result<Settings, AppError> {
    if settings.profiles.len() <= 1 {
        return Err(AppError::InvalidInput(
            "最後の1件のプロファイルは削除できません".to_string(),
        ));
    }
    if !settings.profiles.iter().any(|p| p.id == profile_id) {
        return Err(AppError::NotFound(
            "指定されたプロファイルが見つかりません".to_string(),
        ));
    }

    let profiles: Vec<_> = settings
        .profiles
        .iter()
        .filter(|p| p.id != profile_id)
        .cloned()
        .collect();
    let active_profile_id = if settings.active_profile_id == profile_id {
        profiles[0].id.clone()
    } else {
        settings.active_profile_id.clone()
    };

    Ok(Settings {
        profiles,
        active_profile_id,
        ..settings.clone()
    })
}

/// プロファイルの表示名を変更する。空文字(トリム後)は `InvalidInput` で拒否。
/// 存在しない `profile_id` は `NotFound`(issue #72)。
pub fn rename_profile(
    settings: &Settings,
    profile_id: &str,
    name: &str,
) -> Result<Settings, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "プロファイル名を入力してください".to_string(),
        ));
    }
    if !settings.profiles.iter().any(|p| p.id == profile_id) {
        return Err(AppError::NotFound(
            "指定されたプロファイルが見つかりません".to_string(),
        ));
    }

    let profiles = settings
        .profiles
        .iter()
        .map(|p| {
            if p.id == profile_id {
                domain::Profile {
                    name: trimmed.to_string(),
                    ..p.clone()
                }
            } else {
                p.clone()
            }
        })
        .collect();

    Ok(Settings {
        profiles,
        ..settings.clone()
    })
}

/// ウィンドウレジストリ(ハブ化 その1。issue #83)。設定ファイルには保存
/// しないランタイム状態(`AppState.window_states`)を表す。キーはウィンドウの
/// ラベル。
pub type WindowRegistry = std::collections::HashMap<String, domain::WindowState>;

/// ウィンドウの表示状態を登録・更新する(`report_window_state` コマンドの
/// 委譲先)。同じラベルが既にあれば置き換える(issue #83)。
pub fn report_window_state(
    registry: &WindowRegistry,
    label: String,
    tabs: Vec<domain::WindowTab>,
    active_tab_index: usize,
) -> WindowRegistry {
    let mut updated = registry.clone();
    updated.insert(
        label.clone(),
        domain::WindowState {
            label,
            tabs,
            active_tab_index,
        },
    );
    updated
}

/// ウィンドウが閉じられたときにレジストリから除去する(issue #83)。
/// 登録されていないラベルを指定しても何も起きない。
pub fn remove_window_state(registry: &WindowRegistry, label: &str) -> WindowRegistry {
    let mut updated = registry.clone();
    updated.remove(label);
    updated
}

/// レジストリの内容を一覧として返す。表示順を安定させるためラベル順に
/// ソートする(issue #83)。
pub fn list_window_states(registry: &WindowRegistry) -> Vec<domain::WindowState> {
    let mut states: Vec<_> = registry.values().cloned().collect();
    states.sort_by(|a, b| a.label.cmp(&b.label));
    states
}

/// `CLAUDE.md` を読む(存在しなければ `None`)。
pub fn read_claude_md(
    store: &dyn ClaudeMdStore,
    repo_dir: &Path,
) -> Result<Option<ClaudeMdFile>, AppError> {
    store.read(repo_dir)
}

/// `CLAUDE.md` を保存する。`expected_modified_at_ms` が実際の状態
/// (ファイル無し = `None`、有り = その `modified_at_ms`)と一致する場合
/// のみ書き込む。不一致はアプリ外での変更との競合とみなし、書き込まずに
/// `ClaudeMdConflict` を返す(楽観ロック。issue #27)。
pub fn save_claude_md(
    store: &dyn ClaudeMdStore,
    repo_dir: &Path,
    content: &str,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppError> {
    let current_modified_at_ms = store.read(repo_dir)?.map(|f| f.modified_at_ms);
    if current_modified_at_ms != expected_modified_at_ms {
        return Err(AppError::ClaudeMdConflict(
            "CLAUDE.mdがアプリ外で変更されています。再読み込みしてください".to_string(),
        ));
    }
    store.write(repo_dir, content)
}

/// `~/.claude/settings.json` を読む(存在しなければ `None`)。
pub fn read_claude_settings(
    store: &dyn ClaudeSettingsStore,
) -> Result<Option<ClaudeSettingsFile>, AppError> {
    store.read()
}

/// `~/.claude/settings.json` を保存する。壊れたJSONは書き込まず
/// `InvalidInput` を返す(Claude Code本体が起動不能になる事故の防止。
/// 整形はしない)。`expected_modified_at_ms` が実際の状態と一致しない場合は
/// `save_claude_md` と同様に楽観ロックで弾き、`FileConflict` を返す
/// (issue #53)。
pub fn save_claude_settings(
    store: &dyn ClaudeSettingsStore,
    content: &str,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppError> {
    if !is_valid_json(content) {
        return Err(AppError::InvalidInput(
            "JSONの形式が正しくありません".to_string(),
        ));
    }
    let current_modified_at_ms = store.read()?.map(|f| f.modified_at_ms);
    if current_modified_at_ms != expected_modified_at_ms {
        return Err(AppError::FileConflict(
            "settings.jsonがアプリ外で変更されています。再読み込みしてください".to_string(),
        ));
    }
    store.write(content)
}

/// プロジェクトの `.claude/settings.json` / `settings.local.json` を読む
/// (issue #70)。
pub fn read_project_settings_file(
    store: &dyn ProjectSettingsStore,
    repo_dir: &Path,
    which: ProjectSettingsFile,
) -> Result<Option<ClaudeSettingsFile>, AppError> {
    store.read(repo_dir, which)
}

/// プロジェクトの `.claude/settings.json` / `settings.local.json` を保存する。
/// `save_claude_settings`(ユーザーレベル)と同じ流儀: 壊れたJSONは書き込まず
/// `InvalidInput`、楽観ロック不一致は `FileConflict`(issue #70)。
pub fn save_project_settings_file(
    store: &dyn ProjectSettingsStore,
    repo_dir: &Path,
    which: ProjectSettingsFile,
    content: &str,
    expected_modified_at_ms: Option<u64>,
) -> Result<(), AppError> {
    if !is_valid_json(content) {
        return Err(AppError::InvalidInput(
            "JSONの形式が正しくありません".to_string(),
        ));
    }
    let current_modified_at_ms = store.read(repo_dir, which)?.map(|f| f.modified_at_ms);
    if current_modified_at_ms != expected_modified_at_ms {
        return Err(AppError::FileConflict(
            "ファイルがアプリ外で変更されています。再読み込みしてください".to_string(),
        ));
    }
    store.write(repo_dir, which, content)
}

/// `.claude/rules/*.md` の一覧を返す(issue #61)。
pub fn list_rules(store: &dyn RulesStore, repo_dir: &Path) -> Result<Vec<RuleSummary>, AppError> {
    store.list(repo_dir)
}

/// ルールファイルの内容を読む。`file_name` はフロントから受け取った値を
/// そのままパスに使うため、保存先ディレクトリ配下に収まることが保証できる
/// 形式かを先に検証する(native.md §4。issue #61)。
pub fn get_rule(
    store: &dyn RulesStore,
    repo_dir: &Path,
    file_name: &str,
) -> Result<String, AppError> {
    if !is_valid_rule_file_name(file_name) {
        return Err(AppError::InvalidInput("不正なファイル名です".to_string()));
    }
    store.read(repo_dir, file_name)
}

/// `.claude/skills/` 配下の(`SKILL.md` を持つ)スキル一覧を返す(issue #65)。
pub fn list_skills(
    store: &dyn SkillsStore,
    repo_dir: &Path,
) -> Result<Vec<SkillSummary>, AppError> {
    store.list(repo_dir)
}

/// スキルの `SKILL.md` の内容を読む。`name` はフロントから受け取った値を
/// そのままパスに使うため、保存先ディレクトリ配下に収まることが保証できる
/// 形式かを先に検証する(native.md §4。issue #65)。
pub fn get_skill(store: &dyn SkillsStore, repo_dir: &Path, name: &str) -> Result<String, AppError> {
    if !is_valid_skill_name(name) {
        return Err(AppError::InvalidInput("不正なスキル名です".to_string()));
    }
    store.read(repo_dir, name)
}

pub fn start_github_login(gateway: &dyn GithubGateway) -> Result<DeviceAuthorization, AppError> {
    gateway.start_device_flow()
}

pub fn fetch_github_viewer(
    gateway: &dyn GithubGateway,
    token: &str,
) -> Result<GithubViewer, AppError> {
    gateway.fetch_viewer(token)
}

/// `resolve_github_login_with_retry` の結果(issue #54)。
#[derive(Debug, PartialEq, Eq)]
pub enum ViewerCheckOutcome {
    /// ログイン名を解決できた。
    Resolved(GithubViewer),
    /// 確定的な認証失効(401)。呼び出し側でトークン削除等の後始末をする。
    /// 中身は失効時のエラーメッセージ(HTTP ステータス・GitHub の error
    /// message を含む。認証診断ログ用。issue #261)。
    TokenExpired(String),
    /// `backoff_secs` を使い切っても一時的な失敗が続いた。トークン自体は
    /// 無効と確定していないため、呼び出し側は何もせずログイン名未確定の
    /// ままにしてよい(次の機会に再試行される)。
    GaveUp,
}

/// ログイン名の解決(`fetch_viewer`)を試み、一時的な失敗(ネットワーク不通・
/// タイムアウト・5xxなど。`GithubAuthExpired` 以外の全エラー)の場合は
/// `backoff_secs` の各要素だけ `sleep` してから再試行する。確定的な失効
/// (`GithubAuthExpired`)を受けたら再試行せず即座に打ち切る(issue #54)。
/// `backoff_secs` が空なら1回だけ試す(タブを開いた際の受動的な再取得等、
/// 長時間ブロックしたくない呼び出しに使う)。
pub fn resolve_github_login_with_retry(
    gateway: &dyn GithubGateway,
    token: &str,
    backoff_secs: &[u64],
    sleep: impl Fn(u64),
) -> ViewerCheckOutcome {
    match gateway.fetch_viewer(token) {
        Ok(viewer) => return ViewerCheckOutcome::Resolved(viewer),
        Err(AppError::GithubAuthExpired(message)) => {
            return ViewerCheckOutcome::TokenExpired(message)
        }
        Err(_) => {}
    }

    for &secs in backoff_secs {
        sleep(secs);
        match gateway.fetch_viewer(token) {
            Ok(viewer) => return ViewerCheckOutcome::Resolved(viewer),
            Err(AppError::GithubAuthExpired(message)) => {
                return ViewerCheckOutcome::TokenExpired(message)
            }
            Err(_) => {}
        }
    }

    ViewerCheckOutcome::GaveUp
}

pub fn list_github_projects(
    gateway: &dyn GithubGateway,
    token: &str,
) -> Result<Vec<domain::GithubProjectSummary>, AppError> {
    gateway.list_projects(token)
}

/// 設定済みプロジェクトのアイテムを1ページ分取得する(issue #34)。
pub fn list_github_project_items(
    gateway: &dyn GithubGateway,
    token: &str,
    owner: &str,
    number: u32,
    cursor: Option<&str>,
) -> Result<domain::ProjectItemsPage, AppError> {
    gateway.list_project_items(token, owner, number, cursor)
}

/// かんばんのドラッグ&ドロップでアイテムのStatusを変更する(issue #50)。
pub fn update_github_project_item_status(
    gateway: &dyn GithubGateway,
    token: &str,
    project_id: &str,
    item_id: &str,
    field_id: &str,
    option_id: Option<&str>,
) -> Result<(), AppError> {
    gateway.update_item_status(token, project_id, item_id, field_id, option_id)
}

/// デバイスフローのトークンをポーリングで取得し、`TokenStore` へ保存する。
///
/// `authorization.expires_in_secs` を超えて未認可のままなら `GithubAuthExpired`
/// で打ち切る(GitHub側が `expired_token`/`access_denied` を返した場合は
/// `poll_for_token` がそのまま `AppError` を返すため、`?` でここに伝播する)。
/// `slow_down` を受けたらポーリング間隔を広げる。
/// 実際の待機は `sleep` に注入する(テストで実時間を使わないため)。
pub fn poll_and_store_token(
    gateway: &dyn GithubGateway,
    store: &dyn TokenStore,
    authorization: &DeviceAuthorization,
    sleep: impl Fn(u64),
) -> Result<String, AppError> {
    let mut interval = authorization.interval_secs;
    let mut elapsed = 0u64;

    loop {
        if elapsed >= authorization.expires_in_secs {
            return Err(AppError::GithubAuthExpired(
                "GitHub認証がタイムアウトしました。再度ログインしてください".to_string(),
            ));
        }

        match gateway.poll_for_token(&authorization.device_code)? {
            PollResult::Token(token) => {
                store.save(&token)?;
                return Ok(token);
            }
            PollResult::Pending => {
                sleep(interval);
                elapsed += interval;
            }
            PollResult::SlowDown => {
                interval += 5;
                sleep(interval);
                elapsed += interval;
            }
        }
    }
}

/// `~/.claude` 配下のディレクトリ一覧(読み取り専用。port)。`~/.claude`
/// 自身の解決は infra の責務(`ClaudeSettingsStore` と同じ分担)。/claude
/// 画面のExplorerタブ用で、ファイルの内容を読む経路は持たない
/// (`domain::ClaudeDirEntry` 参照)。
pub trait ClaudeDirStore {
    /// `relative_path`(`list_claude_dir` で検証済み)直下のエントリを返す。
    /// 順序は問わない(並べ替えは `list_claude_dir` が行う)。
    fn list(&self, relative_path: &str) -> Result<Vec<ClaudeDirEntry>, AppError>;
}

/// `list_claude_dir` の1回あたりの取得件数の上限。
pub const MAX_CLAUDE_DIR_PAGE_LIMIT: usize = 500;

/// `~/.claude` 配下の `relative_path` 直下の一覧を、表示順(ディレクトリ優先・
/// 名前順)に並べてページングして返す。`relative_path` はフロントから受け
/// 取った値のため、`~/.claude` 配下に収まる形式かを先に検証する(native.md §4)。
pub fn list_claude_dir(
    store: &dyn ClaudeDirStore,
    relative_path: &str,
    offset: usize,
    limit: usize,
) -> Result<ClaudeDirPage, AppError> {
    if !is_valid_claude_dir_path(relative_path) {
        return Err(AppError::InvalidInput("不正なパスです".to_string()));
    }
    if limit == 0 || limit > MAX_CLAUDE_DIR_PAGE_LIMIT {
        return Err(AppError::InvalidInput(format!(
            "取得件数は1〜{MAX_CLAUDE_DIR_PAGE_LIMIT}件で指定してください"
        )));
    }
    let mut entries = store.list(relative_path)?;
    sort_claude_dir_entries(&mut entries);
    let total = entries.len();
    let entries = entries.into_iter().skip(offset).take(limit).collect();
    Ok(ClaudeDirPage { entries, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{AgentKind, Message, MessageStatus, Role};

    struct FakeSessionSource {
        projects: Vec<Project>,
        messages: Vec<Message>,
        cwd: PathBuf,
        fail_list_projects: bool,
        sessions: Vec<SessionSummary>,
        parsed_sessions: HashMap<String, Result<Vec<ParsedSession>, ()>>,
        log_lines: Result<Vec<LogLine>, ()>,
        /// `session_line_raw` が返す生の行。`None` は見つからない(`NotFound`)。
        raw_line: Option<String>,
        /// `session_fingerprint` / `read_session` が返すファイルの状態(テストが書き換える)。
        fingerprint: std::cell::Cell<FileFingerprint>,
        /// `read_session` が呼ばれた回数(キャッシュで読み直しを省けたかの確認用)。
        reads: std::cell::Cell<usize>,
    }

    impl FakeSessionSource {
        /// `_session_id` は呼び出し側のテストが「どのセッションを表す
        /// フェイクか」を読み取れるようにするための引数(旧`latest_session_id`
        /// 撤廃(issue #345)後は保持しない。`session()`/`session_cwd()`は常に
        /// 呼び出し時に渡された引数をそのまま使う)。
        fn new(_session_id: &str, messages: Vec<Message>) -> Self {
            Self {
                projects: Vec::new(),
                messages,
                cwd: PathBuf::from("/tmp/some-project"),
                fail_list_projects: false,
                sessions: Vec::new(),
                parsed_sessions: HashMap::new(),
                log_lines: Ok(Vec::new()),
                raw_line: None,
                fingerprint: std::cell::Cell::new(FileFingerprint {
                    modified_nanos: 1,
                    len: 1,
                }),
                reads: std::cell::Cell::new(0),
            }
        }
    }

    impl SessionSource for FakeSessionSource {
        fn list_projects(&self) -> Result<Vec<Project>, AppError> {
            if self.fail_list_projects {
                return Err(AppError::Io("boom".to_string()));
            }
            Ok(self.projects.clone())
        }

        fn read_session(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<SessionContent, AppError> {
            self.reads.set(self.reads.get() + 1);
            Ok(SessionContent {
                fingerprint: self.fingerprint.get(),
                messages: self.messages.clone(),
                lines: self
                    .log_lines
                    .clone()
                    .map_err(|()| AppError::Io("boom".to_string()))?,
            })
        }

        fn session_fingerprint(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<FileFingerprint, AppError> {
            Ok(self.fingerprint.get())
        }

        fn session_cwd(&self, _project: &str, _session_id: &str) -> Result<PathBuf, AppError> {
            Ok(self.cwd.clone())
        }

        fn list_sessions(&self, _project: &str) -> Result<Vec<SessionSummary>, AppError> {
            Ok(self.sessions.clone())
        }

        fn list_parsed_sessions(&self, project: &str) -> Result<Vec<ParsedSession>, AppError> {
            match self.parsed_sessions.get(project) {
                Some(Ok(models)) => Ok(models.clone()),
                Some(Err(())) => Err(AppError::Io("boom".to_string())),
                None => Ok(Vec::new()),
            }
        }

        fn session_line_raw(
            &self,
            _project: &str,
            _session_id: &str,
            _uuid: &str,
        ) -> Result<String, AppError> {
            self.raw_line
                .clone()
                .ok_or_else(|| AppError::NotFound("該当する行が見つかりませんでした".to_string()))
        }
    }

    #[derive(Default)]
    struct FakeAgentGateway {
        sent: std::cell::RefCell<Vec<SendRequest>>,
        fail: bool,
    }

    impl AgentGateway for FakeAgentGateway {
        fn send(&self, req: SendRequest) -> Result<(), AppError> {
            if self.fail {
                return Err(AppError::CliFailed("boom".to_string()));
            }
            self.sent.borrow_mut().push(req);
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeRunningSessionSource {
        running: Option<RunningSession>,
    }

    impl FakeRunningSessionSource {
        fn running() -> Self {
            Self {
                running: Some(RunningSession {
                    ledger_path: PathBuf::from("/home/u/.claude/sessions/123.json"),
                    pid: 123,
                    evidence: RunningEvidence::SessionMatched,
                }),
            }
        }
    }

    impl RunningSessionSource for FakeRunningSessionSource {
        fn find_running(&self, _session_id: &str) -> Result<Option<RunningSession>, AppError> {
            Ok(self.running.clone())
        }
    }

    #[test]
    fn list_projects_sorts_by_recency() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.projects = vec![
            Project {
                name: "old".to_string(),
                updated_at_ms: 1,
                agent: AgentKind::ClaudeCode,
            },
            Project {
                name: "new".to_string(),
                updated_at_ms: 2,
                agent: AgentKind::ClaudeCode,
            },
        ];

        let projects = list_projects(&source).expect("should list projects");
        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["new", "old"]);
    }

    #[test]
    fn list_projects_propagates_repository_error() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.fail_list_projects = true;
        let error = list_projects(&source).expect_err("should propagate error");
        assert!(matches!(error, AppError::Io(message) if message == "boom"));
    }

    #[test]
    fn get_session_orders_newest_first() {
        let source = FakeSessionSource::new(
            "s1",
            vec![
                Message {
                    role: Role::User,
                    text: "first".to_string(),
                    timestamp: "".to_string(),
                    uuid: None,
                    image_count: 0,
                    status: MessageStatus::Normal,
                },
                Message {
                    role: Role::Assistant,
                    text: "second".to_string(),
                    timestamp: "".to_string(),
                    uuid: None,
                    image_count: 0,
                    status: MessageStatus::Normal,
                },
            ],
        );

        let session = open_session(&source, None, "some-project", "s1", 0, 10)
            .expect("should get session")
            .conversation;
        assert_eq!(session.id, "s1");
        let texts: Vec<&str> = session.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["second", "first"]);
    }

    #[test]
    fn get_session_applies_offset_and_limit() {
        let source = FakeSessionSource::new(
            "s1",
            ["a", "b", "c", "d"]
                .into_iter()
                .map(|text| Message {
                    role: Role::User,
                    text: text.to_string(),
                    timestamp: "".to_string(),
                    uuid: None,
                    image_count: 0,
                    status: MessageStatus::Normal,
                })
                .collect(),
        );

        // 記録順は a,b,c,d -> 新しい順は d,c,b,a -> offset 1, limit 2 で c,b
        let session = open_session(&source, None, "some-project", "s1", 1, 2)
            .expect("should get session")
            .conversation;
        let texts: Vec<&str> = session.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["c", "b"]);
    }

    fn texts_of(conversation: &Conversation) -> Vec<&str> {
        conversation
            .messages
            .iter()
            .map(|m| m.text.as_str())
            .collect()
    }

    fn user_message(text: &str) -> Message {
        Message {
            role: Role::User,
            text: text.to_string(),
            timestamp: "".to_string(),
            uuid: None,
            image_count: 0,
            status: MessageStatus::Normal,
        }
    }

    #[test]
    fn open_session_reads_the_file_once_and_returns_content_to_cache() {
        let mut source = FakeSessionSource::new("s1", vec![user_message("a"), user_message("b")]);
        source.log_lines = Ok(vec![sample_log_line("l1")]);

        let opened = open_session(&source, None, "p", "s1", 0, 10).expect("should open");

        assert_eq!(
            source.reads.get(),
            1,
            "メッセージとLogLineを1回の読みで得る"
        );
        let reloaded = opened.reloaded.expect("初回は読み直した内容が返る");
        assert_eq!(reloaded.lines, vec![sample_log_line("l1")]);
        // キャッシュへ入れるメッセージは新しい順に並べ済み。
        let cached: Vec<&str> = reloaded
            .messages
            .messages
            .iter()
            .map(|m| m.text.as_str())
            .collect();
        assert_eq!(cached, vec!["b", "a"]);
        assert_eq!(reloaded.messages.fingerprint, source.fingerprint.get());
    }

    #[test]
    fn reload_session_marks_failed_questions_before_ordering_newest_first() {
        // 記録順: 質問1 → 答え1 → 質問2(失敗)→ エラー行
        let mut error = user_message("err");
        error.role = Role::Assistant;
        error.status = MessageStatus::Error;
        let mut answer = user_message("a1");
        answer.role = Role::Assistant;
        let source = FakeSessionSource::new(
            "s1",
            vec![user_message("q1"), answer, user_message("q2"), error],
        );

        let reloaded = reload_session(&source, "p", "s1").expect("should reload");

        // 新しい順: エラー行、失敗した質問、答え、質問1
        let got: Vec<(&str, MessageStatus)> = reloaded
            .messages
            .messages
            .iter()
            .map(|m| (m.text.as_str(), m.status))
            .collect();
        assert_eq!(
            got,
            vec![
                ("err", MessageStatus::ErrorForQuestion),
                ("q2", MessageStatus::FailedQuestion),
                ("a1", MessageStatus::Normal),
                ("q1", MessageStatus::Normal),
            ]
        );
    }

    #[test]
    fn open_session_uses_cache_without_reading_when_the_file_is_unchanged() {
        let source = FakeSessionSource::new("s1", ["a", "b", "c", "d"].map(user_message).to_vec());
        let first = open_session(&source, None, "p", "s1", 0, 2).expect("should open");
        let cache = first.reloaded.expect("初回は読む").messages;
        assert_eq!(source.reads.get(), 1);

        // ページ送り(offset を進める)。ファイルは変わっていないので読み直さない。
        let second = open_session(&source, Some(&cache), "p", "s1", 2, 2).expect("should open");

        assert_eq!(
            source.reads.get(),
            1,
            "キャッシュが合っていれば読み直さない"
        );
        assert!(second.reloaded.is_none());
        assert_eq!(texts_of(&second.conversation), vec!["b", "a"]);
    }

    #[test]
    fn should_replace_cache_refuses_to_overwrite_a_newer_state_with_an_older_read() {
        let cached = |modified_nanos| CachedMessages {
            fingerprint: FileFingerprint {
                modified_nanos,
                len: 1,
            },
            messages: Arc::new(Vec::new()),
        };

        assert!(should_replace_cache(None, &cached(5)), "空なら入れる");
        assert!(
            should_replace_cache(Some(&cached(5)), &cached(6)),
            "新しければ置き換える"
        );
        assert!(
            should_replace_cache(Some(&cached(5)), &cached(5)),
            "同じ時刻なら置き換える"
        );
        assert!(
            !should_replace_cache(Some(&cached(6)), &cached(5)),
            "古い読みは捨てる"
        );
    }

    #[test]
    fn open_session_rereads_when_modified_time_or_size_changed() {
        let source = FakeSessionSource::new("s1", vec![user_message("a")]);
        let cache = open_session(&source, None, "p", "s1", 0, 10)
            .unwrap()
            .reloaded
            .unwrap()
            .messages;

        // サイズだけ変わった(同じ更新時刻)。
        source.fingerprint.set(FileFingerprint {
            modified_nanos: 1,
            len: 2,
        });
        let opened = open_session(&source, Some(&cache), "p", "s1", 0, 10).unwrap();
        assert_eq!(source.reads.get(), 2);
        assert!(opened.reloaded.is_some());

        // 更新時刻だけ変わった(同じサイズ)。
        let cache = opened.reloaded.unwrap().messages;
        source.fingerprint.set(FileFingerprint {
            modified_nanos: 2,
            len: 2,
        });
        let opened = open_session(&source, Some(&cache), "p", "s1", 0, 10).unwrap();
        assert_eq!(source.reads.get(), 3);
        assert!(opened.reloaded.is_some());
    }

    #[test]
    fn get_session_rejects_invalid_session_id_without_calling_source() {
        let source = FakeSessionSource::new("s1", vec![]);

        let error = open_session(&source, None, "some-project", "../../etc/passwd", 0, 10)
            .expect_err("should reject invalid session id");

        assert!(matches!(error, AppError::InvalidInput(_)));
        assert_eq!(source.reads.get(), 0);
    }

    fn sample_session_summary(id: &str, modified_at_ms: u64) -> SessionSummary {
        SessionSummary {
            id: id.to_string(),
            title: id.to_string(),
            modified_at_ms,
            cwd: None,
            git_branch: None,
        }
    }

    #[test]
    fn list_sessions_sorts_by_recency() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.sessions = vec![
            sample_session_summary("old", 1),
            sample_session_summary("new", 2),
        ];

        let sessions = list_sessions(&source, "some-project").expect("should list sessions");
        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "old"]);
    }

    #[test]
    fn list_sessions_returns_every_session_even_when_forked_files_look_alike() {
        // issue #369: フォークや圧縮で分かれたファイルも、セッションごとに全件返す。
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.sessions = vec![
            sample_session_summary("fork-1", 1),
            sample_session_summary("fork-2", 2),
        ];

        let sessions = list_sessions(&source, "some-project").expect("should list sessions");
        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["fork-2", "fork-1"]);
    }

    fn sample_parsed_session(session_id: &str) -> ParsedSession {
        ParsedSession {
            session_id: session_id.to_string(),
            custom_title: Some("タイトル".to_string()),
            ai_title: None,
            mode: None,
            slug: None,
            last_prompt: None,
            conversation_file_path: PathBuf::from(format!("/tmp/{session_id}.jsonl")),
            subagent_file_paths: Vec::new(),
            modified_at_ms: 0,
            cwd: None,
            git_branch: None,
        }
    }

    #[test]
    fn refresh_user_sessions_populates_and_replaces_held_sessions() {
        let mut pc = domain::Pc {
            system_uuid: "uuid".to_string(),
            pc_name: "pc".to_string(),
            description: String::new(),
            users: vec![domain::User {
                user_id: "yanqi".to_string(),
                user_name: "yanqi".to_string(),
                home_directory: PathBuf::from("C:/Users/yanqi"),
                repositories: Vec::new(),
                sessions: Vec::new(),
            }],
        };

        refresh_user_sessions(&mut pc, &[sample_parsed_session("a")]);
        assert_eq!(pc.users[0].sessions.len(), 1);
        assert_eq!(pc.users[0].sessions[0].session_id, "a");

        // 素材の変化で保持ツリーが置き換わる(古いセッションは残らない)
        refresh_user_sessions(&mut pc, &[sample_parsed_session("b")]);
        assert_eq!(pc.users[0].sessions.len(), 1);
        assert_eq!(pc.users[0].sessions[0].session_id, "b");
    }

    #[test]
    fn upsert_parsed_session_replaces_same_path_and_appends_new_path() {
        let mut sessions = vec![sample_parsed_session("a")];

        // 同じパス(sample のパスは session_id から決まる)は置換される
        let mut updated_a = sample_parsed_session("a");
        updated_a.custom_title = Some("新タイトル".to_string());
        upsert_parsed_session(&mut sessions, updated_a);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].custom_title.as_deref(), Some("新タイトル"));

        // 別のパスは追加される
        upsert_parsed_session(&mut sessions, sample_parsed_session("b"));
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn get_session_line_raw_returns_raw_text_and_maps_not_found() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.raw_line = Some(r#"{"uuid":"u-1"}"#.to_string());
        assert_eq!(
            get_session_line_raw(&source, "proj", "s1", "u-1").unwrap(),
            r#"{"uuid":"u-1"}"#
        );

        source.raw_line = None;
        assert!(matches!(
            get_session_line_raw(&source, "proj", "s1", "u-1"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn get_session_line_raw_rejects_unsafe_inputs_before_touching_the_source() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.raw_line = Some("x".to_string());
        for (project, session_id, uuid) in [
            ("..", "s1", "u-1"),
            ("a/b", "s1", "u-1"),
            ("", "s1", "u-1"),
            ("proj", "../s1", "u-1"),
            ("proj", "s1", ""),
            ("proj", "s1", "u 1"),
        ] {
            assert!(
                matches!(
                    get_session_line_raw(&source, project, session_id, uuid),
                    Err(AppError::InvalidInput(_))
                ),
                "should reject ({project:?}, {session_id:?}, {uuid:?})"
            );
        }
    }

    struct FakeViewerTabsStore {
        saved: std::cell::RefCell<Vec<(String, ViewerTabs)>>,
    }

    impl ViewerTabsStore for FakeViewerTabsStore {
        fn load(&self, _profile_id: &str) -> Result<ViewerTabs, AppError> {
            Ok(ViewerTabs::default())
        }
        fn save(&self, profile_id: &str, tabs: &ViewerTabs) -> Result<(), AppError> {
            self.saved
                .borrow_mut()
                .push((profile_id.to_string(), tabs.clone()));
            Ok(())
        }
    }

    fn viewer_tab(project: &str, key: &str) -> ViewerTab {
        ViewerTab {
            project: project.to_string(),
            session_id: key.to_string(),
        }
    }

    #[test]
    fn save_viewer_tabs_dedupes_keeping_order_and_writes_current_version() {
        let store = FakeViewerTabsStore {
            saved: Default::default(),
        };
        save_viewer_tabs(
            &store,
            "p1",
            vec![
                viewer_tab("a", "k1"),
                viewer_tab("b", "k2"),
                viewer_tab("a", "k1"),
            ],
        )
        .unwrap();
        let saved = store.saved.borrow();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].0, "p1");
        assert_eq!(saved[0].1.version, CURRENT_VIEWER_TABS_VERSION);
        assert_eq!(
            saved[0].1.tabs,
            vec![viewer_tab("a", "k1"), viewer_tab("b", "k2")]
        );
    }

    #[test]
    fn viewer_tabs_commands_reject_unsafe_inputs() {
        let store = FakeViewerTabsStore {
            saved: Default::default(),
        };
        assert!(matches!(
            load_viewer_tabs(&store, "../x"),
            Err(AppError::InvalidInput(_))
        ));
        for bad in ["", "../x", "a/b"] {
            assert!(matches!(
                save_viewer_tabs(&store, bad, vec![]),
                Err(AppError::InvalidInput(_))
            ));
        }
        for tab in [
            viewer_tab("..", "k"),
            viewer_tab("a/b", "k"),
            viewer_tab("a", " "),
        ] {
            assert!(matches!(
                save_viewer_tabs(&store, "p1", vec![tab]),
                Err(AppError::InvalidInput(_))
            ));
        }
        assert!(store.saved.borrow().is_empty());
    }

    #[test]
    fn viewer_window_title_joins_profile_name_and_folders() {
        assert_eq!(viewer_window_title("yaoyorozu", &[]), "yaoyorozu");
        assert_eq!(
            viewer_window_title("yaoyorozu", &["C--Users-yanqi-prj-yaoyorozu".to_string()]),
            "yaoyorozu - C--Users-yanqi-prj-yaoyorozu"
        );
        assert_eq!(
            viewer_window_title("p", &["a".to_string(), "b".to_string()]),
            "p - a / b"
        );
    }

    #[test]
    fn remove_parsed_session_drops_only_the_given_path() {
        let mut sessions = vec![sample_parsed_session("a"), sample_parsed_session("b")];

        assert!(remove_parsed_session(
            &mut sessions,
            Path::new("/tmp/a.jsonl")
        ));
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "b");

        // 既に無いパスは何もせず false
        assert!(!remove_parsed_session(
            &mut sessions,
            Path::new("/tmp/a.jsonl")
        ));
        assert_eq!(sessions.len(), 1);
    }

    #[test]
    fn rescan_queue_starts_one_worker_and_coalesces_changes() {
        let mut queue = RescanQueue::default();

        // 最初の変更でワーカーを起動する。動いている間の変更では起動しない
        assert!(queue.push([PathBuf::from("/a.jsonl")]));
        assert!(!queue.push([PathBuf::from("/b.jsonl"), PathBuf::from("/a.jsonl")]));

        // 同じファイルの変更は1件に畳まれてまとめて取り出される
        let batch = queue.take_or_stop().expect("pending changes");
        assert_eq!(
            batch,
            vec![PathBuf::from("/a.jsonl"), PathBuf::from("/b.jsonl")]
        );

        // 処理中に届いた変更は次の取り出しで拾われ、その間もワーカーは1つのまま
        assert!(!queue.push([PathBuf::from("/a.jsonl")]));
        assert_eq!(queue.take_or_stop(), Some(vec![PathBuf::from("/a.jsonl")]));

        // 空になったらワーカーは止まり、次の変更でまた起動する
        assert_eq!(queue.take_or_stop(), None);
        assert!(queue.push([PathBuf::from("/c.jsonl")]));
    }

    #[test]
    fn rescan_queue_does_not_start_worker_for_empty_push() {
        let mut queue = RescanQueue::default();
        assert!(!queue.push(Vec::<PathBuf>::new()));
        assert_eq!(queue.take_or_stop(), None);
        // 空の push の後でも、次の実変更でワーカーが起動する
        assert!(queue.push([PathBuf::from("/a.jsonl")]));
    }

    #[test]
    fn retain_enumerated_parsed_sessions_drops_paths_missing_from_enumeration() {
        let mut sessions = vec![sample_parsed_session("a"), sample_parsed_session("b")];
        let enumerated = std::collections::HashSet::from([PathBuf::from("/tmp/a.jsonl")]);

        retain_enumerated_parsed_sessions(&mut sessions, &enumerated);

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "a");
    }

    #[test]
    fn build_user_sessions_flattens_sessions_from_all_projects() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.projects = vec![
            Project {
                name: "proj1".to_string(),
                updated_at_ms: 1,
                agent: AgentKind::ClaudeCode,
            },
            Project {
                name: "proj2".to_string(),
                updated_at_ms: 2,
                agent: AgentKind::ClaudeCode,
            },
        ];
        source.parsed_sessions = HashMap::from([
            ("proj1".to_string(), Ok(vec![sample_parsed_session("a")])),
            ("proj2".to_string(), Ok(vec![sample_parsed_session("b")])),
        ]);

        let result = build_user_sessions(&source).expect("should build");

        let ids: Vec<&str> = result
            .parsed
            .iter()
            .map(|s| s.session_id.as_str())
            .collect();
        assert_eq!(ids, vec!["a", "b"]);
        assert!(result.failed_projects.is_empty());
    }

    #[test]
    fn build_user_sessions_keeps_other_projects_when_one_fails() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.projects = vec![
            Project {
                name: "ok".to_string(),
                updated_at_ms: 1,
                agent: AgentKind::ClaudeCode,
            },
            Project {
                name: "broken".to_string(),
                updated_at_ms: 2,
                agent: AgentKind::ClaudeCode,
            },
        ];
        source.parsed_sessions = HashMap::from([
            ("ok".to_string(), Ok(vec![sample_parsed_session("a")])),
            ("broken".to_string(), Err(())),
        ]);

        let result = build_user_sessions(&source).expect("should not fail overall");

        assert_eq!(result.parsed.len(), 1);
        assert_eq!(result.parsed[0].session_id, "a");
        assert_eq!(result.failed_projects, vec!["broken".to_string()]);
    }

    #[test]
    fn pc_with_user_sessions_assigns_sessions_to_every_user() {
        let pc = pc_with_one_user("yanqi");
        let parsed = vec![sample_parsed_session("a")];

        let result = pc_with_user_sessions(pc, parsed);

        assert_eq!(result.users[0].sessions.len(), 1);
        assert_eq!(result.users[0].sessions[0].session_id, "a");
        assert_eq!(result.users[0].sessions[0].conversation_files.len(), 1);
        assert_eq!(
            result.users[0].sessions[0].conversation_files[0].file_path,
            PathBuf::from("/tmp/a.jsonl")
        );
        assert!(result.users[0].sessions[0].conversation_files[0]
            .lines
            .is_empty());
    }

    fn sample_log_line(uuid: &str) -> LogLine {
        LogLine::User(domain::UserLogLine {
            base: domain::LogLineBase {
                uuid: uuid.to_string(),
                parent_uuid: None,
                logical_parent_uuid: None,
                timestamp: 1,
                cwd: None,
                entrypoint: None,
                version: None,
                git_branch: None,
                is_sidechain: None,
                user_type: None,
            },
            prompt_id: None,
            permission_mode: None,
        })
    }

    #[test]
    fn reload_session_delegates_to_source_for_a_valid_session_id() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.log_lines = Ok(vec![sample_log_line("l1")]);

        let reloaded = reload_session(&source, "proj", "s1").expect("should reload");

        assert_eq!(reloaded.lines, vec![sample_log_line("l1")]);
    }

    #[test]
    fn reload_session_rejects_invalid_session_id_without_calling_source() {
        let source = FakeSessionSource::new("s1", vec![]);

        let error = reload_session(&source, "proj", "../etc/passwd")
            .expect_err("should reject invalid session id");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn pc_with_loaded_lines_fills_matching_conversation_file_by_path() {
        let pc = pc_with_user_sessions(pc_with_one_user("yanqi"), vec![sample_parsed_session("a")]);
        let mut loaded_lines = HashMap::new();
        loaded_lines.insert(PathBuf::from("/tmp/a.jsonl"), vec![sample_log_line("l1")]);

        let result = pc_with_loaded_lines(pc, &loaded_lines);

        assert_eq!(
            result.users[0].sessions[0].conversation_files[0].lines,
            vec![sample_log_line("l1")]
        );
    }

    #[test]
    fn pc_with_loaded_lines_leaves_conversation_file_empty_when_not_yet_cached() {
        let pc = pc_with_user_sessions(pc_with_one_user("yanqi"), vec![sample_parsed_session("a")]);

        let result = pc_with_loaded_lines(pc, &HashMap::new());

        assert!(result.users[0].sessions[0].conversation_files[0]
            .lines
            .is_empty());
    }

    #[test]
    fn resolve_session_display_hints_reads_the_matching_parsed_session() {
        let mut p = sample_parsed_session("a");
        p.cwd = Some("/repo".to_string());
        p.git_branch = Some("main".to_string());

        let hints = resolve_session_display_hints(&[p]);

        let hint = hints.get("a").expect("hint for session a");
        assert_eq!(hint.cwd.as_deref(), Some("/repo"));
        assert_eq!(hint.git_branch.as_deref(), Some("main"));
    }

    #[test]
    fn resolve_session_display_hints_overwrites_with_newer_some_values_only() {
        let mut older = sample_parsed_session("a");
        older.modified_at_ms = 100;
        older.cwd = Some("/repo".to_string());
        older.git_branch = Some("old-branch".to_string());
        let mut newer = sample_parsed_session("a");
        newer.modified_at_ms = 200;
        newer.cwd = None;
        newer.git_branch = Some("new-branch".to_string());

        let hints = resolve_session_display_hints(&[newer, older]);

        let hint = hints.get("a").expect("hint for session a");
        assert_eq!(
            hint.cwd.as_deref(),
            Some("/repo"),
            "新しい方がNoneなら古い方の値で補完される"
        );
        assert_eq!(
            hint.git_branch.as_deref(),
            Some("new-branch"),
            "新しい方にSomeがあれば上書きされる"
        );
    }

    #[test]
    fn send_message_resumes_the_given_session_id() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::default();
        send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "s1",
            "hello",
            &[],
            AgentMode::Chat,
        )
        .expect("should send message");

        let sent = agent.sent.borrow();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].text, "hello");
        assert_eq!(sent[0].cwd, source.cwd);
        assert_eq!(sent[0].mode, AgentMode::Chat);
        assert_eq!(sent[0].continuation, Continuation::Resume("s1".to_string()));
    }

    #[test]
    fn send_message_passes_requested_mode_through_to_agent() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::default();
        send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "s1",
            "hello",
            &[],
            AgentMode::Read,
        )
        .expect("should send message");

        let sent = agent.sent.borrow();
        assert_eq!(sent[0].mode, AgentMode::Read);
    }

    #[test]
    fn agent_mode_defaults_to_chat() {
        assert_eq!(AgentMode::default(), AgentMode::Chat);
    }

    #[test]
    fn send_message_rejects_blank_text() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::default();
        let error = send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "s1",
            "   ",
            &[],
            AgentMode::Chat,
        )
        .expect_err("should reject");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(agent.sent.borrow().is_empty());
    }

    #[test]
    fn send_message_rejects_invalid_session_id_without_sending() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::default();
        let error = send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "../etc/passwd",
            "hello",
            &[],
            AgentMode::Chat,
        )
        .expect_err("should reject invalid session id");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(agent.sent.borrow().is_empty());
    }

    /// PNGのマジックナンバー(8バイト)+ダミー4バイトのbase64。形式判定だけを通す最小データ。
    const PNG_BASE64: &str = "iVBORw0KGgoAAAAA";

    #[test]
    fn send_message_passes_validated_images_to_the_agent() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::default();
        send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "s1",
            "見て",
            &[PNG_BASE64.to_string()],
            AgentMode::Chat,
        )
        .expect("should send with an image");

        let sent = agent.sent.borrow();
        assert_eq!(sent[0].images.len(), 1);
        assert_eq!(sent[0].images[0].data_base64, PNG_BASE64);
        assert_eq!(sent[0].text, "見て");
    }

    #[test]
    fn send_message_allows_an_image_without_text() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::default();
        send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "s1",
            "  ",
            &[PNG_BASE64.to_string()],
            AgentMode::Chat,
        )
        .expect("image-only send is allowed");
        assert_eq!(agent.sent.borrow().len(), 1);
    }

    #[test]
    fn send_message_rejects_invalid_images_without_sending() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::default();
        // 形式違い(テキスト)・枚数超過のどちらも、送らずに理由つきで弾く。
        for images in [
            vec!["aGVsbG8gd29ybGQh".to_string()],
            vec![PNG_BASE64.to_string(); domain::MAX_IMAGES_PER_MESSAGE + 1],
        ] {
            let error = send_message(
                &source,
                &agent,
                &running_sessions,
                "some-project",
                "s1",
                "hello",
                &images,
                AgentMode::Chat,
            )
            .expect_err("should reject");
            assert!(matches!(error, AppError::InvalidInput(_)), "{error:?}");
        }
        assert!(agent.sent.borrow().is_empty());
    }

    #[test]
    fn send_message_blocks_images_too_when_session_is_running_elsewhere() {
        // issue #349: 実行中セッションのガード(#346)は画像付き送信にも効く。
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::running();
        let error = send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "s1",
            "見て",
            &[PNG_BASE64.to_string()],
            AgentMode::Chat,
        )
        .expect_err("should be blocked");
        assert!(matches!(error, AppError::SessionBusy(_)));
        assert!(agent.sent.borrow().is_empty());
    }

    #[test]
    fn check_image_attachment_validates_format_size_and_count() {
        assert!(check_image_attachment(PNG_BASE64, 0).is_ok());
        assert!(check_image_attachment(PNG_BASE64, domain::MAX_IMAGES_PER_MESSAGE - 1).is_ok());
        // 追加すると上限を超える。
        assert!(matches!(
            check_image_attachment(PNG_BASE64, domain::MAX_IMAGES_PER_MESSAGE),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            check_image_attachment("aGVsbG8gd29ybGQh", 0),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn get_session_line_images_extracts_images_from_the_raw_line() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.raw_line = Some(
            r#"{"type":"user","uuid":"u1","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}},{"type":"text","text":"見て"}]}}"#
                .to_string(),
        );

        let images = get_session_line_images(&source, "some-project", "s1", "u1")
            .expect("should extract images");

        assert_eq!(images.len(), 1);
        assert_eq!(images[0].data_base64, "AAAA");
        assert_eq!(images[0].media_type.as_mime(), "image/png");
    }

    #[test]
    fn get_session_line_images_rejects_invalid_ids_and_reports_missing_line() {
        let source = FakeSessionSource::new("s1", vec![]);
        assert!(matches!(
            get_session_line_images(&source, "some-project", "../x", "u1"),
            Err(AppError::InvalidInput(_))
        ));
        // 行が見つからない(FakeSessionSource の既定)は NotFound。
        assert!(matches!(
            get_session_line_images(&source, "some-project", "s1", "u1"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn send_message_block_message_names_the_ledger_file_and_pid_so_the_user_can_resolve_it() {
        // issue #345 の後続: 台帳が壊れて PID が使い回されると止まり続けうるため、
        // 止めた理由に原因の台帳のパスと PID を含める(どちらの根拠でも)。
        for evidence in [
            RunningEvidence::SessionMatched,
            RunningEvidence::LedgerUnreadable,
        ] {
            let source = FakeSessionSource::new("s1", vec![]);
            let agent = FakeAgentGateway::default();
            let running_sessions = FakeRunningSessionSource {
                running: Some(RunningSession {
                    ledger_path: PathBuf::from("/home/u/.claude/sessions/19104.json"),
                    pid: 19104,
                    evidence,
                }),
            };

            let error = send_message(
                &source,
                &agent,
                &running_sessions,
                "some-project",
                "s1",
                "hello",
                &[],
                AgentMode::Chat,
            )
            .expect_err("should reject");

            let AppError::SessionBusy(message) = error else {
                panic!("expected SessionBusy");
            };
            assert!(
                message.contains("19104.json") && message.contains("19104"),
                "{evidence:?}: {message}"
            );
        }
    }

    #[test]
    fn send_message_rejects_when_session_is_running_elsewhere() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let running_sessions = FakeRunningSessionSource::running();
        let error = send_message(
            &source,
            &agent,
            &running_sessions,
            "some-project",
            "s1",
            "hello",
            &[],
            AgentMode::Chat,
        )
        .expect_err("should reject when session is busy");
        assert!(matches!(error, AppError::SessionBusy(_)));
        assert!(
            agent.sent.borrow().is_empty(),
            "must not send when the session is running elsewhere"
        );
    }

    struct FakeSettingsStore {
        loaded: LoadedSettings,
        saved: std::cell::RefCell<Vec<Settings>>,
        fail_save: bool,
    }

    impl FakeSettingsStore {
        fn new(settings: Settings) -> Self {
            Self {
                loaded: LoadedSettings {
                    settings,
                    recovered_from_corruption: false,
                },
                saved: std::cell::RefCell::new(Vec::new()),
                fail_save: false,
            }
        }
    }

    impl SettingsStore for FakeSettingsStore {
        fn load(&self) -> Result<LoadedSettings, AppError> {
            Ok(self.loaded.clone())
        }

        fn save(&self, settings: &Settings) -> Result<(), AppError> {
            if self.fail_save {
                return Err(AppError::Io("boom".to_string()));
            }
            self.saved.borrow_mut().push(settings.clone());
            Ok(())
        }
    }

    fn settings_with_profile(profile: domain::Profile) -> Settings {
        Settings {
            active_profile_id: profile.id.clone(),
            profiles: vec![profile],
            ..Settings::default()
        }
    }

    #[test]
    fn load_settings_returns_store_result_unchanged() {
        let mut profile = domain::Profile::new("p1".to_string(), "p1".to_string());
        profile.selected_project_folders.push("proj1".to_string());
        let settings = settings_with_profile(profile);
        let store = FakeSettingsStore::new(settings.clone());

        let loaded = load_settings(&store).expect("should load settings");
        assert_eq!(loaded.settings, settings);
        assert!(!loaded.recovered_from_corruption);
    }

    #[test]
    fn validate_settings_accepts_none_github_project() {
        let settings = Settings::default();
        assert!(validate_settings(&settings).is_ok());
    }

    #[test]
    fn validate_settings_rejects_blank_github_project_owner() {
        let mut profile = domain::Profile::new("p1".to_string(), "p1".to_string());
        profile.github_project = Some(domain::GithubProject {
            owner: "".to_string(),
            number: 1,
        });
        let settings = settings_with_profile(profile);

        let error = validate_settings(&settings).expect_err("should reject blank owner");
        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn update_settings_saves_valid_settings_and_returns_them() {
        let store = FakeSettingsStore::new(Settings::default());
        let mut profile = domain::Profile::new("p1".to_string(), "p1".to_string());
        profile.repository_path = Some(PathBuf::from("/tmp/repo"));
        let input = settings_with_profile(profile);

        let saved = update_settings(&store, input.clone()).expect("should update settings");
        assert_eq!(saved, input);
        assert_eq!(store.saved.borrow().as_slice(), [input]);
    }

    #[test]
    fn update_settings_rejects_invalid_settings_without_saving() {
        let store = FakeSettingsStore::new(Settings::default());
        let mut profile = domain::Profile::new("p1".to_string(), "p1".to_string());
        profile.github_project = Some(domain::GithubProject {
            owner: "   ".to_string(),
            number: 1,
        });
        let input = settings_with_profile(profile);

        let error =
            update_settings(&store, input).expect_err("should reject invalid github project");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.saved.borrow().is_empty());
    }

    fn two_profile_settings() -> Settings {
        let a = domain::Profile::new("a".to_string(), "profile-a".to_string());
        let b = domain::Profile::new("b".to_string(), "profile-b".to_string());
        Settings {
            active_profile_id: a.id.clone(),
            profiles: vec![a, b],
            ..Settings::default()
        }
    }

    #[test]
    fn resolve_profile_returns_the_specified_profile_when_id_given() {
        let settings = two_profile_settings();
        let profile = resolve_profile(&settings, Some("b")).expect("should resolve");
        assert_eq!(profile.id, "b");
    }

    #[test]
    fn resolve_profile_returns_active_profile_when_id_omitted() {
        let settings = two_profile_settings();
        let profile = resolve_profile(&settings, None).expect("should resolve");
        assert_eq!(profile.id, settings.active_profile_id);
    }

    #[test]
    fn resolve_profile_rejects_unknown_profile_id() {
        let settings = two_profile_settings();
        let error = resolve_profile(&settings, Some("missing")).expect_err("should reject");
        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn switch_profile_switches_active_id_when_profile_exists() {
        let settings = two_profile_settings();
        let updated = switch_profile(&settings, "b").expect("should switch");
        assert_eq!(updated.active_profile_id, "b");
        assert_eq!(
            updated.profiles, settings.profiles,
            "profiles themselves are unchanged"
        );
    }

    #[test]
    fn switch_profile_rejects_unknown_profile_id() {
        let settings = two_profile_settings();
        let error = switch_profile(&settings, "missing").expect_err("should reject");
        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn create_profile_appends_new_profile_and_activates_it() {
        let settings = two_profile_settings();
        let (updated, created) = create_profile(&settings, Some("new one".to_string()));
        assert_eq!(updated.profiles.len(), 3);
        assert_eq!(updated.active_profile_id, created.id);
        assert_eq!(created.name, "new one");
        assert!(created.repository_path.is_none());
        assert!(created.selected_project_folders.is_empty());
    }

    #[test]
    fn create_profile_uses_default_name_when_omitted() {
        let settings = Settings::default();
        let (_, created) = create_profile(&settings, None);
        assert_eq!(created.name, "新しいプロファイル");
    }

    #[test]
    fn create_profile_falls_back_to_default_name_when_blank() {
        let settings = Settings::default();
        let (_, created) = create_profile(&settings, Some("   ".to_string()));
        assert_eq!(created.name, "新しいプロファイル");
    }

    #[test]
    fn delete_profile_removes_profile_and_keeps_other_active_when_not_active() {
        let settings = two_profile_settings();
        let updated = delete_profile(&settings, "b").expect("should delete");
        assert_eq!(updated.profiles.len(), 1);
        assert_eq!(updated.profiles[0].id, "a");
        assert_eq!(updated.active_profile_id, "a", "active id is unaffected");
    }

    #[test]
    fn delete_profile_promotes_first_remaining_profile_when_deleting_active() {
        let settings = two_profile_settings();
        let updated = delete_profile(&settings, "a").expect("should delete");
        assert_eq!(updated.profiles.len(), 1);
        assert_eq!(
            updated.active_profile_id, "b",
            "promoted to the remaining profile"
        );
    }

    #[test]
    fn delete_profile_rejects_when_only_one_profile_remains() {
        let settings = Settings::default();
        let only_id = settings.profiles[0].id.clone();
        let error = delete_profile(&settings, &only_id).expect_err("should reject");
        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn delete_profile_rejects_unknown_profile_id() {
        let settings = two_profile_settings();
        let error = delete_profile(&settings, "missing").expect_err("should reject");
        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn rename_profile_updates_name_of_matching_profile_only() {
        let settings = two_profile_settings();
        let updated = rename_profile(&settings, "a", "renamed").expect("should rename");
        assert_eq!(updated.profiles[0].name, "renamed");
        assert_eq!(updated.profiles[1].name, "profile-b");
    }

    #[test]
    fn rename_profile_trims_whitespace() {
        let settings = two_profile_settings();
        let updated = rename_profile(&settings, "a", "  renamed  ").expect("should rename");
        assert_eq!(updated.profiles[0].name, "renamed");
    }

    #[test]
    fn rename_profile_rejects_blank_name() {
        let settings = two_profile_settings();
        let error = rename_profile(&settings, "a", "   ").expect_err("should reject");
        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn rename_profile_rejects_unknown_profile_id() {
        let settings = two_profile_settings();
        let error = rename_profile(&settings, "missing", "renamed").expect_err("should reject");
        assert!(matches!(error, AppError::NotFound(_)));
    }

    fn window_tab(profile_id: &str) -> domain::WindowTab {
        domain::WindowTab {
            profile_id: profile_id.to_string(),
            session_id: None,
            session_title: None,
        }
    }

    #[test]
    fn report_window_state_registers_a_new_window() {
        let registry = WindowRegistry::new();
        let updated = report_window_state(&registry, "main".to_string(), vec![window_tab("a")], 0);
        assert_eq!(updated.len(), 1);
        let state = updated.get("main").expect("should be registered");
        assert_eq!(state.label, "main");
        assert_eq!(state.tabs, vec![window_tab("a")]);
        assert_eq!(state.active_tab_index, 0);
    }

    #[test]
    fn report_window_state_replaces_the_existing_entry_for_the_same_label() {
        let mut registry = WindowRegistry::new();
        registry.insert(
            "main".to_string(),
            domain::WindowState {
                label: "main".to_string(),
                tabs: vec![window_tab("a")],
                active_tab_index: 0,
            },
        );
        let updated = report_window_state(
            &registry,
            "main".to_string(),
            vec![window_tab("a"), window_tab("b")],
            1,
        );
        assert_eq!(updated.len(), 1, "same label should replace, not add");
        let state = updated.get("main").unwrap();
        assert_eq!(state.tabs, vec![window_tab("a"), window_tab("b")]);
        assert_eq!(state.active_tab_index, 1);
    }

    #[test]
    fn report_window_state_does_not_mutate_other_windows() {
        let mut registry = WindowRegistry::new();
        registry.insert(
            "profile-1".to_string(),
            domain::WindowState {
                label: "profile-1".to_string(),
                tabs: vec![window_tab("a")],
                active_tab_index: 0,
            },
        );
        let updated = report_window_state(&registry, "main".to_string(), vec![window_tab("b")], 0);
        assert_eq!(updated.len(), 2);
        assert!(updated.contains_key("profile-1"));
        assert!(updated.contains_key("main"));
    }

    #[test]
    fn remove_window_state_removes_the_matching_label() {
        let mut registry = WindowRegistry::new();
        registry.insert(
            "main".to_string(),
            domain::WindowState {
                label: "main".to_string(),
                tabs: vec![window_tab("a")],
                active_tab_index: 0,
            },
        );
        let updated = remove_window_state(&registry, "main");
        assert!(updated.is_empty());
    }

    #[test]
    fn remove_window_state_is_a_noop_for_unknown_label() {
        let registry = WindowRegistry::new();
        let updated = remove_window_state(&registry, "missing");
        assert!(updated.is_empty());
    }

    #[test]
    fn list_window_states_returns_entries_sorted_by_label() {
        let mut registry = WindowRegistry::new();
        registry.insert(
            "profile-2".to_string(),
            domain::WindowState {
                label: "profile-2".to_string(),
                tabs: vec![],
                active_tab_index: 0,
            },
        );
        registry.insert(
            "main".to_string(),
            domain::WindowState {
                label: "main".to_string(),
                tabs: vec![],
                active_tab_index: 0,
            },
        );
        let states = list_window_states(&registry);
        let labels: Vec<&str> = states.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, vec!["main", "profile-2"]);
    }

    #[test]
    fn list_window_states_returns_empty_for_empty_registry() {
        let registry = WindowRegistry::new();
        assert!(list_window_states(&registry).is_empty());
    }

    #[derive(Default)]
    struct FakeClaudeMdStore {
        file: std::cell::RefCell<Option<ClaudeMdFile>>,
        written: std::cell::RefCell<Vec<(PathBuf, String)>>,
    }

    impl FakeClaudeMdStore {
        fn with_file(content: &str, modified_at_ms: u64) -> Self {
            Self {
                file: std::cell::RefCell::new(Some(ClaudeMdFile {
                    content: content.to_string(),
                    modified_at_ms,
                })),
                written: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl ClaudeMdStore for FakeClaudeMdStore {
        fn read(&self, _repo_dir: &Path) -> Result<Option<ClaudeMdFile>, AppError> {
            Ok(self.file.borrow().clone())
        }

        fn write(&self, repo_dir: &Path, content: &str) -> Result<(), AppError> {
            self.written
                .borrow_mut()
                .push((repo_dir.to_path_buf(), content.to_string()));
            Ok(())
        }
    }

    #[test]
    fn read_claude_md_returns_none_when_absent() {
        let store = FakeClaudeMdStore::default();
        let result = read_claude_md(&store, Path::new("/tmp/repo")).expect("should read");
        assert_eq!(result, None);
    }

    #[test]
    fn read_claude_md_returns_file_when_present() {
        let store = FakeClaudeMdStore::with_file("hello", 100);
        let result = read_claude_md(&store, Path::new("/tmp/repo")).expect("should read");
        assert_eq!(
            result,
            Some(ClaudeMdFile {
                content: "hello".to_string(),
                modified_at_ms: 100,
            })
        );
    }

    #[test]
    fn save_claude_md_creates_new_file_when_none_expected_and_none_exists() {
        let store = FakeClaudeMdStore::default();
        save_claude_md(&store, Path::new("/tmp/repo"), "new content", None)
            .expect("should save new file");
        assert_eq!(
            store.written.borrow().as_slice(),
            [(PathBuf::from("/tmp/repo"), "new content".to_string())]
        );
    }

    #[test]
    fn save_claude_md_writes_when_expected_matches_current() {
        let store = FakeClaudeMdStore::with_file("old", 100);
        save_claude_md(&store, Path::new("/tmp/repo"), "new", Some(100)).expect("should save");
        assert_eq!(
            store.written.borrow().as_slice(),
            [(PathBuf::from("/tmp/repo"), "new".to_string())]
        );
    }

    #[test]
    fn save_claude_md_rejects_when_expected_none_but_file_exists() {
        let store = FakeClaudeMdStore::with_file("existing", 100);
        let error = save_claude_md(&store, Path::new("/tmp/repo"), "new", None)
            .expect_err("should reject as conflict");
        assert!(matches!(error, AppError::ClaudeMdConflict(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[test]
    fn save_claude_md_rejects_when_expected_mtime_is_stale() {
        let store = FakeClaudeMdStore::with_file("current", 200);
        let error = save_claude_md(&store, Path::new("/tmp/repo"), "new", Some(100))
            .expect_err("should reject as conflict");
        assert!(matches!(error, AppError::ClaudeMdConflict(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[derive(Default)]
    struct FakeClaudeSettingsStore {
        file: std::cell::RefCell<Option<ClaudeSettingsFile>>,
        written: std::cell::RefCell<Vec<String>>,
    }

    impl FakeClaudeSettingsStore {
        fn with_file(content: &str, modified_at_ms: u64) -> Self {
            Self {
                file: std::cell::RefCell::new(Some(ClaudeSettingsFile {
                    content: content.to_string(),
                    modified_at_ms,
                })),
                written: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl ClaudeSettingsStore for FakeClaudeSettingsStore {
        fn read(&self) -> Result<Option<ClaudeSettingsFile>, AppError> {
            Ok(self.file.borrow().clone())
        }

        fn write(&self, content: &str) -> Result<(), AppError> {
            self.written.borrow_mut().push(content.to_string());
            Ok(())
        }
    }

    #[test]
    fn read_claude_settings_returns_none_when_absent() {
        let store = FakeClaudeSettingsStore::default();
        let result = read_claude_settings(&store).expect("should read");
        assert_eq!(result, None);
    }

    #[test]
    fn read_claude_settings_returns_file_when_present() {
        let store = FakeClaudeSettingsStore::with_file(r#"{"a":1}"#, 100);
        let result = read_claude_settings(&store).expect("should read");
        assert_eq!(
            result,
            Some(ClaudeSettingsFile {
                content: r#"{"a":1}"#.to_string(),
                modified_at_ms: 100,
            })
        );
    }

    #[test]
    fn save_claude_settings_creates_new_file_when_none_expected_and_none_exists() {
        let store = FakeClaudeSettingsStore::default();
        save_claude_settings(&store, "{}", None).expect("should save new file");
        assert_eq!(store.written.borrow().as_slice(), ["{}".to_string()]);
    }

    #[test]
    fn save_claude_settings_writes_when_expected_matches_current() {
        let store = FakeClaudeSettingsStore::with_file("{}", 100);
        save_claude_settings(&store, r#"{"a":1}"#, Some(100)).expect("should save");
        assert_eq!(
            store.written.borrow().as_slice(),
            [r#"{"a":1}"#.to_string()]
        );
    }

    #[test]
    fn save_claude_settings_rejects_when_expected_none_but_file_exists() {
        let store = FakeClaudeSettingsStore::with_file("{}", 100);
        let error = save_claude_settings(&store, r#"{"a":1}"#, None)
            .expect_err("should reject as conflict");
        assert!(matches!(error, AppError::FileConflict(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[test]
    fn save_claude_settings_rejects_when_expected_mtime_is_stale() {
        let store = FakeClaudeSettingsStore::with_file("{}", 200);
        let error = save_claude_settings(&store, r#"{"a":1}"#, Some(100))
            .expect_err("should reject as conflict");
        assert!(matches!(error, AppError::FileConflict(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[test]
    fn save_claude_settings_rejects_invalid_json_without_reading_current_state() {
        let store = FakeClaudeSettingsStore::default();
        let error =
            save_claude_settings(&store, "{invalid", None).expect_err("should reject bad json");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[derive(Default)]
    struct FakeProjectSettingsStore {
        settings: std::cell::RefCell<Option<ClaudeSettingsFile>>,
        settings_local: std::cell::RefCell<Option<ClaudeSettingsFile>>,
        written: std::cell::RefCell<Vec<(ProjectSettingsFile, String)>>,
    }

    impl FakeProjectSettingsStore {
        fn with_file(which: ProjectSettingsFile, content: &str, modified_at_ms: u64) -> Self {
            let store = Self::default();
            let file = Some(ClaudeSettingsFile {
                content: content.to_string(),
                modified_at_ms,
            });
            match which {
                ProjectSettingsFile::Settings => *store.settings.borrow_mut() = file,
                ProjectSettingsFile::SettingsLocal => *store.settings_local.borrow_mut() = file,
            }
            store
        }
    }

    impl ProjectSettingsStore for FakeProjectSettingsStore {
        fn read(
            &self,
            _repo_dir: &Path,
            which: ProjectSettingsFile,
        ) -> Result<Option<ClaudeSettingsFile>, AppError> {
            Ok(match which {
                ProjectSettingsFile::Settings => self.settings.borrow().clone(),
                ProjectSettingsFile::SettingsLocal => self.settings_local.borrow().clone(),
            })
        }

        fn write(
            &self,
            _repo_dir: &Path,
            which: ProjectSettingsFile,
            content: &str,
        ) -> Result<(), AppError> {
            self.written.borrow_mut().push((which, content.to_string()));
            Ok(())
        }
    }

    #[test]
    fn read_project_settings_file_returns_none_when_absent() {
        let store = FakeProjectSettingsStore::default();
        let result = read_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::Settings,
        )
        .expect("should read");
        assert_eq!(result, None);
    }

    #[test]
    fn read_project_settings_file_returns_file_when_present() {
        let store = FakeProjectSettingsStore::with_file(ProjectSettingsFile::Settings, "{}", 100);
        let result = read_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::Settings,
        )
        .expect("should read");
        assert_eq!(
            result,
            Some(ClaudeSettingsFile {
                content: "{}".to_string(),
                modified_at_ms: 100,
            })
        );
    }

    #[test]
    fn read_project_settings_file_keeps_settings_and_settings_local_independent() {
        let store = FakeProjectSettingsStore::with_file(ProjectSettingsFile::Settings, "{}", 100);
        let result = read_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::SettingsLocal,
        )
        .expect("should read");
        assert_eq!(result, None);
    }

    #[test]
    fn save_project_settings_file_creates_new_file_when_none_expected_and_none_exists() {
        let store = FakeProjectSettingsStore::default();
        save_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::SettingsLocal,
            "{}",
            None,
        )
        .expect("should save new file");
        assert_eq!(
            store.written.borrow().as_slice(),
            [(ProjectSettingsFile::SettingsLocal, "{}".to_string())]
        );
    }

    #[test]
    fn save_project_settings_file_writes_when_expected_matches_current() {
        let store = FakeProjectSettingsStore::with_file(ProjectSettingsFile::Settings, "{}", 100);
        save_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::Settings,
            r#"{"a":1}"#,
            Some(100),
        )
        .expect("should save");
        assert_eq!(
            store.written.borrow().as_slice(),
            [(ProjectSettingsFile::Settings, r#"{"a":1}"#.to_string())]
        );
    }

    #[test]
    fn save_project_settings_file_rejects_when_expected_none_but_file_exists() {
        let store = FakeProjectSettingsStore::with_file(ProjectSettingsFile::Settings, "{}", 100);
        let error = save_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::Settings,
            r#"{"a":1}"#,
            None,
        )
        .expect_err("should reject as conflict");
        assert!(matches!(error, AppError::FileConflict(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[test]
    fn save_project_settings_file_rejects_when_expected_mtime_is_stale() {
        let store = FakeProjectSettingsStore::with_file(ProjectSettingsFile::Settings, "{}", 200);
        let error = save_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::Settings,
            r#"{"a":1}"#,
            Some(100),
        )
        .expect_err("should reject as conflict");
        assert!(matches!(error, AppError::FileConflict(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[test]
    fn save_project_settings_file_rejects_invalid_json_without_reading_current_state() {
        let store = FakeProjectSettingsStore::default();
        let error = save_project_settings_file(
            &store,
            Path::new("/tmp/repo"),
            ProjectSettingsFile::Settings,
            "{invalid",
            None,
        )
        .expect_err("should reject bad json");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.written.borrow().is_empty());
    }

    #[derive(Default)]
    struct FakeRulesStore {
        summaries: Vec<RuleSummary>,
        contents: std::collections::HashMap<String, String>,
        read_calls: std::cell::RefCell<Vec<String>>,
    }

    impl RulesStore for FakeRulesStore {
        fn list(&self, _repo_dir: &Path) -> Result<Vec<RuleSummary>, AppError> {
            Ok(self.summaries.clone())
        }

        fn read(&self, _repo_dir: &Path, file_name: &str) -> Result<String, AppError> {
            self.read_calls.borrow_mut().push(file_name.to_string());
            self.contents
                .get(file_name)
                .cloned()
                .ok_or_else(|| AppError::NotFound("ルールが見つかりません".to_string()))
        }
    }

    #[test]
    fn list_rules_delegates_to_store() {
        let store = FakeRulesStore {
            summaries: vec![RuleSummary {
                file_name: "native.md".to_string(),
                modified_at_ms: 100,
            }],
            ..Default::default()
        };

        let rules = list_rules(&store, Path::new("/tmp/repo")).expect("should list");

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].file_name, "native.md");
    }

    #[test]
    fn get_rule_delegates_to_store_for_valid_file_name() {
        let mut contents = std::collections::HashMap::new();
        contents.insert("native.md".to_string(), "# ルール".to_string());
        let store = FakeRulesStore {
            contents,
            ..Default::default()
        };

        let content = get_rule(&store, Path::new("/tmp/repo"), "native.md").expect("should read");

        assert_eq!(content, "# ルール");
        assert_eq!(store.read_calls.borrow().as_slice(), ["native.md"]);
    }

    #[test]
    fn get_rule_rejects_path_traversal_without_calling_store() {
        let store = FakeRulesStore::default();

        let error = get_rule(&store, Path::new("/tmp/repo"), "../../etc/passwd.md")
            .expect_err("should reject");

        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.read_calls.borrow().is_empty());
    }

    #[derive(Default)]
    struct FakeSkillsStore {
        summaries: Vec<SkillSummary>,
        contents: std::collections::HashMap<String, String>,
        read_calls: std::cell::RefCell<Vec<String>>,
    }

    impl SkillsStore for FakeSkillsStore {
        fn list(&self, _repo_dir: &Path) -> Result<Vec<SkillSummary>, AppError> {
            Ok(self.summaries.clone())
        }

        fn read(&self, _repo_dir: &Path, name: &str) -> Result<String, AppError> {
            self.read_calls.borrow_mut().push(name.to_string());
            self.contents
                .get(name)
                .cloned()
                .ok_or_else(|| AppError::NotFound("スキルが見つかりません".to_string()))
        }
    }

    #[test]
    fn list_skills_delegates_to_store() {
        let store = FakeSkillsStore {
            summaries: vec![SkillSummary {
                name: "release".to_string(),
                modified_at_ms: 100,
            }],
            ..Default::default()
        };

        let skills = list_skills(&store, Path::new("/tmp/repo")).expect("should list");

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "release");
    }

    #[test]
    fn get_skill_delegates_to_store_for_valid_name() {
        let mut contents = std::collections::HashMap::new();
        contents.insert("release".to_string(), "# release".to_string());
        let store = FakeSkillsStore {
            contents,
            ..Default::default()
        };

        let content = get_skill(&store, Path::new("/tmp/repo"), "release").expect("should read");

        assert_eq!(content, "# release");
        assert_eq!(store.read_calls.borrow().as_slice(), ["release"]);
    }

    #[test]
    fn get_skill_rejects_path_traversal_without_calling_store() {
        let store = FakeSkillsStore::default();

        let error =
            get_skill(&store, Path::new("/tmp/repo"), "../../etc").expect_err("should reject");

        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.read_calls.borrow().is_empty());
    }

    // (project_id, item_id, status_field_id, option_id) の呼び出し履歴。
    // clippy::type_complexity 対策(このテスト用struct専用の型なので、
    // 意味付けは呼び出し側のフィールド名で十分)。
    type UpdateItemStatusCall = (String, String, String, Option<String>);

    struct FakeGithubGateway {
        device_authorization: DeviceAuthorization,
        poll_responses:
            std::cell::RefCell<std::collections::VecDeque<Result<PollResult, AppError>>>,
        viewer: GithubViewer,
        // 空なら常に `viewer` を返す(`fetch_viewer` の既定の成功挙動)。
        // 積んであれば先頭から1つずつ消費する(issue #54: 再試行のテスト用)。
        viewer_responses:
            std::cell::RefCell<std::collections::VecDeque<Result<GithubViewer, AppError>>>,
        projects: Vec<domain::GithubProjectSummary>,
        project_items: domain::ProjectItemsPage,
        fail_update_item_status_with_scope_insufficient: bool,
        update_item_status_calls: std::cell::RefCell<Vec<UpdateItemStatusCall>>,
    }

    impl FakeGithubGateway {
        fn new(authorization: DeviceAuthorization) -> Self {
            Self {
                device_authorization: authorization,
                poll_responses: std::cell::RefCell::new(std::collections::VecDeque::new()),
                viewer: GithubViewer {
                    login: "yanqirenshi".to_string(),
                },
                viewer_responses: std::cell::RefCell::new(std::collections::VecDeque::new()),
                projects: Vec::new(),
                project_items: domain::ProjectItemsPage {
                    project_id: "PVT_1".to_string(),
                    status_field_id: Some("PVTSSF_1".to_string()),
                    items: Vec::new(),
                    next_cursor: None,
                    status_options: Vec::new(),
                },
                fail_update_item_status_with_scope_insufficient: false,
                update_item_status_calls: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl GithubGateway for FakeGithubGateway {
        fn start_device_flow(&self) -> Result<DeviceAuthorization, AppError> {
            Ok(self.device_authorization.clone())
        }

        fn poll_for_token(&self, _device_code: &str) -> Result<PollResult, AppError> {
            self.poll_responses
                .borrow_mut()
                .pop_front()
                .unwrap_or(Ok(PollResult::Pending))
        }

        fn fetch_viewer(&self, _token: &str) -> Result<GithubViewer, AppError> {
            if let Some(result) = self.viewer_responses.borrow_mut().pop_front() {
                return result;
            }
            Ok(self.viewer.clone())
        }

        fn list_projects(
            &self,
            _token: &str,
        ) -> Result<Vec<domain::GithubProjectSummary>, AppError> {
            Ok(self.projects.clone())
        }

        fn list_project_items(
            &self,
            _token: &str,
            _owner: &str,
            _number: u32,
            _cursor: Option<&str>,
        ) -> Result<domain::ProjectItemsPage, AppError> {
            Ok(self.project_items.clone())
        }

        fn update_item_status(
            &self,
            _token: &str,
            project_id: &str,
            item_id: &str,
            field_id: &str,
            option_id: Option<&str>,
        ) -> Result<(), AppError> {
            self.update_item_status_calls.borrow_mut().push((
                project_id.to_string(),
                item_id.to_string(),
                field_id.to_string(),
                option_id.map(String::from),
            ));
            if self.fail_update_item_status_with_scope_insufficient {
                return Err(AppError::GithubScopeInsufficient(
                    "権限が不足しています".to_string(),
                ));
            }
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeTokenStore {
        saved: std::cell::RefCell<Option<String>>,
    }

    impl TokenStore for FakeTokenStore {
        fn save(&self, token: &str) -> Result<(), AppError> {
            *self.saved.borrow_mut() = Some(token.to_string());
            Ok(())
        }

        fn load(&self) -> Result<Option<String>, AppError> {
            Ok(self.saved.borrow().clone())
        }

        fn delete(&self) -> Result<(), AppError> {
            *self.saved.borrow_mut() = None;
            Ok(())
        }
    }

    fn test_authorization(interval_secs: u64, expires_in_secs: u64) -> DeviceAuthorization {
        DeviceAuthorization {
            device_code: "device-code".to_string(),
            user_code: "USER-CODE".to_string(),
            verification_uri: "https://github.com/login/device".to_string(),
            interval_secs,
            expires_in_secs,
        }
    }

    #[test]
    fn poll_and_store_token_returns_token_after_pending_responses() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway.poll_responses.borrow_mut().extend([
            Ok(PollResult::Pending),
            Ok(PollResult::Pending),
            Ok(PollResult::Token("abc".to_string())),
        ]);
        let store = FakeTokenStore::default();
        let sleeps = std::cell::RefCell::new(Vec::new());

        let token = poll_and_store_token(&gateway, &store, &gateway.device_authorization, |secs| {
            sleeps.borrow_mut().push(secs);
        })
        .expect("should eventually get a token");

        assert_eq!(token, "abc");
        assert_eq!(store.saved.borrow().as_deref(), Some("abc"));
        assert_eq!(sleeps.borrow().as_slice(), [5, 5]);
    }

    #[test]
    fn poll_and_store_token_increases_interval_on_slow_down() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway.poll_responses.borrow_mut().extend([
            Ok(PollResult::SlowDown),
            Ok(PollResult::Token("abc".to_string())),
        ]);
        let store = FakeTokenStore::default();
        let sleeps = std::cell::RefCell::new(Vec::new());

        poll_and_store_token(&gateway, &store, &gateway.device_authorization, |secs| {
            sleeps.borrow_mut().push(secs);
        })
        .expect("should eventually get a token");

        assert_eq!(
            sleeps.borrow().as_slice(),
            [10],
            "interval should widen by 5 on slow_down"
        );
    }

    #[test]
    fn poll_and_store_token_times_out_when_expires_in_exceeded() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 5));
        gateway.poll_responses.borrow_mut().extend([
            Ok(PollResult::Pending),
            Ok(PollResult::Pending),
            Ok(PollResult::Pending),
        ]);
        let store = FakeTokenStore::default();

        let error = poll_and_store_token(&gateway, &store, &gateway.device_authorization, |_| {})
            .expect_err("should time out");

        assert!(matches!(error, AppError::GithubAuthExpired(_)));
        assert!(store.saved.borrow().is_none());
    }

    #[test]
    fn poll_and_store_token_propagates_gateway_error() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway
            .poll_responses
            .borrow_mut()
            .push_back(Err(AppError::GithubApiFailed("boom".to_string())));
        let store = FakeTokenStore::default();

        let error = poll_and_store_token(&gateway, &store, &gateway.device_authorization, |_| {})
            .expect_err("should propagate gateway error");

        assert!(matches!(error, AppError::GithubApiFailed(_)));
    }

    #[test]
    fn start_github_login_delegates_to_gateway() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        let authorization = start_github_login(&gateway).expect("should start device flow");
        assert_eq!(authorization.user_code, "USER-CODE");
    }

    #[test]
    fn fetch_github_viewer_delegates_to_gateway() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        let viewer = fetch_github_viewer(&gateway, "token").expect("should fetch viewer");
        assert_eq!(viewer.login, "yanqirenshi");
    }

    #[test]
    fn resolve_github_login_with_retry_returns_resolved_immediately_on_success() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        let sleeps = std::cell::RefCell::new(Vec::new());

        let outcome = resolve_github_login_with_retry(&gateway, "token", &[10, 60], |secs| {
            sleeps.borrow_mut().push(secs);
        });

        assert_eq!(
            outcome,
            ViewerCheckOutcome::Resolved(GithubViewer {
                login: "yanqirenshi".to_string(),
            })
        );
        assert!(sleeps.borrow().is_empty());
    }

    #[test]
    fn resolve_github_login_with_retry_stops_immediately_on_token_expired_without_retry() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway
            .viewer_responses
            .borrow_mut()
            .push_back(Err(AppError::GithubAuthExpired("失効".to_string())));
        let sleeps = std::cell::RefCell::new(Vec::new());

        let outcome = resolve_github_login_with_retry(&gateway, "token", &[10, 60], |secs| {
            sleeps.borrow_mut().push(secs);
        });

        assert_eq!(
            outcome,
            ViewerCheckOutcome::TokenExpired("失効".to_string())
        );
        assert!(sleeps.borrow().is_empty());
    }

    #[test]
    fn resolve_github_login_with_retry_retries_transient_errors_and_eventually_resolves() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway.viewer_responses.borrow_mut().extend([
            Err(AppError::GithubApiFailed("一時的な失敗".to_string())),
            Err(AppError::GithubApiFailed("一時的な失敗".to_string())),
        ]);
        let sleeps = std::cell::RefCell::new(Vec::new());

        let outcome = resolve_github_login_with_retry(&gateway, "token", &[10, 60, 300], |secs| {
            sleeps.borrow_mut().push(secs);
        });

        assert_eq!(
            outcome,
            ViewerCheckOutcome::Resolved(GithubViewer {
                login: "yanqirenshi".to_string(),
            })
        );
        assert_eq!(sleeps.borrow().as_slice(), [10, 60]);
    }

    #[test]
    fn resolve_github_login_with_retry_gives_up_after_exhausting_backoff() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway.viewer_responses.borrow_mut().extend([
            Err(AppError::GithubApiFailed("一時的な失敗".to_string())),
            Err(AppError::GithubApiFailed("一時的な失敗".to_string())),
            Err(AppError::GithubApiFailed("一時的な失敗".to_string())),
        ]);
        let sleeps = std::cell::RefCell::new(Vec::new());

        let outcome = resolve_github_login_with_retry(&gateway, "token", &[10, 60], |secs| {
            sleeps.borrow_mut().push(secs);
        });

        assert_eq!(outcome, ViewerCheckOutcome::GaveUp);
        assert_eq!(sleeps.borrow().as_slice(), [10, 60]);
    }

    #[test]
    fn resolve_github_login_with_retry_tries_once_when_backoff_is_empty() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway
            .viewer_responses
            .borrow_mut()
            .push_back(Err(AppError::GithubApiFailed("一時的な失敗".to_string())));
        let sleeps = std::cell::RefCell::new(Vec::new());

        let outcome = resolve_github_login_with_retry(&gateway, "token", &[], |secs| {
            sleeps.borrow_mut().push(secs);
        });

        assert_eq!(outcome, ViewerCheckOutcome::GaveUp);
        assert!(sleeps.borrow().is_empty());
    }

    #[test]
    fn list_github_projects_delegates_to_gateway() {
        let mut gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway.projects = vec![domain::GithubProjectSummary {
            number: 51,
            title: "yaoyorozu".to_string(),
            closed: false,
        }];

        let projects = list_github_projects(&gateway, "token").expect("should list projects");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].number, 51);
    }

    #[test]
    fn list_github_project_items_delegates_to_gateway() {
        let mut gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway.project_items = domain::ProjectItemsPage {
            project_id: "PVT_1".to_string(),
            status_field_id: Some("PVTSSF_1".to_string()),
            items: vec![domain::ProjectItem {
                id: "PVTI_1".to_string(),
                title: "テスト課題".to_string(),
                kind: domain::ProjectItemKind::Issue,
                repository: Some("yaoyorozu".to_string()),
                number: Some(33),
                assignees: vec!["yanqirenshi".to_string()],
                status: Some("In progress".to_string()),
                url: Some("https://github.com/yanqirenshi/yaoyorozu/issues/33".to_string()),
            }],
            next_cursor: Some("cursor-1".to_string()),
            status_options: vec![
                domain::ProjectStatusOption {
                    id: "opt-backlog".to_string(),
                    name: "Backlog".to_string(),
                },
                domain::ProjectStatusOption {
                    id: "opt-in-progress".to_string(),
                    name: "In progress".to_string(),
                },
            ],
        };

        let page = list_github_project_items(&gateway, "token", "yanqirenshi", 51, None)
            .expect("should list project items");
        assert_eq!(page.project_id, "PVT_1");
        assert_eq!(page.status_field_id.as_deref(), Some("PVTSSF_1"));
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "PVTI_1");
        assert_eq!(page.items[0].number, Some(33));
        assert_eq!(page.next_cursor.as_deref(), Some("cursor-1"));
        assert_eq!(
            page.status_options
                .iter()
                .map(|o| o.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Backlog", "In progress"]
        );
    }

    #[test]
    fn update_github_project_item_status_delegates_to_gateway() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));

        update_github_project_item_status(
            &gateway,
            "token",
            "PVT_1",
            "PVTI_1",
            "PVTSSF_1",
            Some("opt-in-progress"),
        )
        .expect("should update item status");

        let calls = gateway.update_item_status_calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            (
                "PVT_1".to_string(),
                "PVTI_1".to_string(),
                "PVTSSF_1".to_string(),
                Some("opt-in-progress".to_string()),
            )
        );
    }

    #[test]
    fn update_github_project_item_status_passes_none_option_id_to_clear_status() {
        let gateway = FakeGithubGateway::new(test_authorization(5, 900));

        update_github_project_item_status(&gateway, "token", "PVT_1", "PVTI_1", "PVTSSF_1", None)
            .expect("should update item status");

        let calls = gateway.update_item_status_calls.borrow();
        assert_eq!(calls[0].3, None);
    }

    #[test]
    fn update_github_project_item_status_propagates_scope_insufficient_error() {
        let mut gateway = FakeGithubGateway::new(test_authorization(5, 900));
        gateway.fail_update_item_status_with_scope_insufficient = true;

        let error = update_github_project_item_status(
            &gateway,
            "token",
            "PVT_1",
            "PVTI_1",
            "PVTSSF_1",
            Some("opt-in-progress"),
        )
        .expect_err("should propagate scope insufficient error");

        assert!(matches!(error, AppError::GithubScopeInsufficient(_)));
    }

    struct FakeHubLayoutStore {
        loaded: HubLayout,
        saved: std::cell::RefCell<Vec<HubLayout>>,
    }

    impl FakeHubLayoutStore {
        fn new(loaded: HubLayout) -> Self {
            Self {
                loaded,
                saved: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl HubLayoutStore for FakeHubLayoutStore {
        fn load(&self) -> Result<HubLayout, AppError> {
            Ok(self.loaded.clone())
        }

        fn save(&self, layout: &HubLayout) -> Result<(), AppError> {
            self.saved.borrow_mut().push(layout.clone());
            Ok(())
        }
    }

    struct FakeHubTuningStore {
        loaded: HubTuning,
        saved: std::cell::RefCell<Vec<HubTuning>>,
    }

    impl HubTuningStore for FakeHubTuningStore {
        fn load(&self) -> Result<HubTuning, AppError> {
            Ok(self.loaded.clone())
        }

        fn save(&self, tuning: &HubTuning) -> Result<(), AppError> {
            self.saved.borrow_mut().push(tuning.clone());
            Ok(())
        }
    }

    #[test]
    fn load_hub_tuning_returns_store_result_unchanged() {
        let tuning = HubTuning {
            link_strength: Some(0.4),
            ..HubTuning::default()
        };
        let store = FakeHubTuningStore {
            loaded: tuning.clone(),
            saved: std::cell::RefCell::new(Vec::new()),
        };

        assert_eq!(load_hub_tuning(&store).expect("should load"), tuning);
    }

    #[test]
    fn save_hub_tuning_writes_current_version_and_keeps_none_link_strength() {
        let store = FakeHubTuningStore {
            loaded: HubTuning::default(),
            saved: std::cell::RefCell::new(Vec::new()),
        };
        let tuning = HubTuning {
            version: 999,
            link_distance: 120.0,
            link_strength: None,
            charge_strength: -200.0,
            collide_radius: 40.0,
        };

        save_hub_tuning(&store, tuning).expect("should save");

        let saved = store.saved.borrow();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].version, CURRENT_HUB_TUNING_VERSION);
        assert_eq!(saved[0].link_distance, 120.0);
        assert_eq!(
            saved[0].link_strength, None,
            "「既定」は None のまま保存する"
        );
        assert_eq!(saved[0].charge_strength, -200.0);
        assert_eq!(saved[0].collide_radius, 40.0);
    }

    #[test]
    fn load_hub_layout_returns_store_result_unchanged() {
        let mut positions = HashMap::new();
        positions.insert("cwd:proj1".to_string(), NodePosition { x: 1.0, y: 2.0 });
        let layout = HubLayout {
            version: CURRENT_HUB_LAYOUT_VERSION,
            positions,
            camera: None,
        };
        let store = FakeHubLayoutStore::new(layout.clone());

        let loaded = load_hub_layout(&store).expect("should load hub layout");
        assert_eq!(loaded, layout);
    }

    fn settings_with_repositories(
        active: (&str, Option<&str>),
        other: (&str, Option<&str>),
    ) -> Settings {
        let mut settings = Settings::default();
        let mut first = domain::Profile::new(active.0.to_string(), active.0.to_string());
        first.repository_path = active.1.map(PathBuf::from);
        let mut second = domain::Profile::new(other.0.to_string(), other.0.to_string());
        second.repository_path = other.1.map(PathBuf::from);
        settings.active_profile_id = first.id.clone();
        settings.profiles = vec![first, second];
        settings
    }

    #[test]
    fn resolve_repository_dir_uses_the_given_profiles_repository_path() {
        let settings = settings_with_repositories(("a", Some("/repo/a")), ("b", Some("/repo/b")));

        assert_eq!(
            resolve_repository_dir(&settings, Some("b")).expect("should resolve"),
            PathBuf::from("/repo/b")
        );
    }

    #[test]
    fn resolve_repository_dir_falls_back_to_the_active_profile() {
        let settings = settings_with_repositories(("a", Some("/repo/a")), ("b", Some("/repo/b")));

        assert_eq!(
            resolve_repository_dir(&settings, None).expect("should resolve"),
            PathBuf::from("/repo/a")
        );
    }

    #[test]
    fn resolve_repository_dir_rejects_a_profile_without_a_repository_path() {
        let settings = settings_with_repositories(("a", Some("/repo/a")), ("b", None));

        let error = resolve_repository_dir(&settings, Some("b")).expect_err("should reject");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn resolve_repository_dir_rejects_an_unknown_profile() {
        let settings = settings_with_repositories(("a", Some("/repo/a")), ("b", None));

        let error = resolve_repository_dir(&settings, Some("nope")).expect_err("should reject");

        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn save_hub_layout_writes_the_camera_with_the_current_version() {
        let store = FakeHubLayoutStore::new(HubLayout::default());
        let camera = Camera {
            x: 10.0,
            y: -20.0,
            k: 2.0,
        };

        save_hub_layout(&store, HashMap::new(), Some(camera)).expect("should save hub layout");

        let saved = store.saved.borrow();
        assert_eq!(saved[0].version, CURRENT_HUB_LAYOUT_VERSION);
        assert_eq!(saved[0].camera, Some(camera));
    }

    #[test]
    fn save_hub_layout_replaces_positions_wholesale_instead_of_merging() {
        let mut initial_positions = HashMap::new();
        initial_positions.insert("cwd:stale".to_string(), NodePosition { x: 1.0, y: 1.0 });
        let store = FakeHubLayoutStore::new(HubLayout {
            version: CURRENT_HUB_LAYOUT_VERSION,
            positions: initial_positions,
            camera: None,
        });

        let mut new_positions = HashMap::new();
        new_positions.insert("cwd:fresh".to_string(), NodePosition { x: 9.0, y: 9.0 });
        save_hub_layout(&store, new_positions.clone(), None).expect("should save hub layout");

        let saved = store.saved.borrow();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].version, CURRENT_HUB_LAYOUT_VERSION);
        assert_eq!(saved[0].positions, new_positions);
    }

    struct FakeLayoutStore {
        fail: bool,
        saved: std::cell::RefCell<Vec<(PathBuf, serde_json::Value)>>,
    }

    impl FakeLayoutStore {
        fn new() -> Self {
            Self {
                fail: false,
                saved: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl LayoutStore for FakeLayoutStore {
        fn save(&self, path: &Path, content: &serde_json::Value) -> Result<(), AppError> {
            if self.fail {
                return Err(AppError::Io("boom".to_string()));
            }
            self.saved
                .borrow_mut()
                .push((path.to_path_buf(), content.clone()));
            Ok(())
        }
    }

    fn registered_profile_settings(repository_path: PathBuf) -> Settings {
        let mut profile = domain::Profile::new("p1".to_string(), "p1".to_string());
        profile.repository_path = Some(repository_path);
        settings_with_profile(profile)
    }

    struct FakeGitWorktreeLister {
        // repo_root -> そのリポジトリに属するworktreeパス一覧。
        worktrees_by_repo: std::collections::HashMap<PathBuf, Vec<PathBuf>>,
        fail: bool,
    }

    impl FakeGitWorktreeLister {
        fn new() -> Self {
            Self {
                worktrees_by_repo: std::collections::HashMap::new(),
                fail: false,
            }
        }

        fn with_worktree(mut self, repo_root: PathBuf, worktree: PathBuf) -> Self {
            self.worktrees_by_repo
                .entry(repo_root)
                .or_default()
                .push(worktree);
            self
        }

        fn failing() -> Self {
            Self {
                worktrees_by_repo: std::collections::HashMap::new(),
                fail: true,
            }
        }
    }

    impl GitWorktreeLister for FakeGitWorktreeLister {
        fn list_worktree_paths(&self, repo_root: &Path) -> Result<Vec<PathBuf>, AppError> {
            if self.fail {
                return Err(AppError::Io("git worktree list に失敗しました".to_string()));
            }
            // `git worktree list` はmainのworktree自身も含めて返す。
            let mut paths = vec![repo_root.to_path_buf()];
            if let Some(extra) = self.worktrees_by_repo.get(repo_root) {
                paths.extend(extra.iter().cloned());
            }
            Ok(paths)
        }
    }

    #[test]
    fn save_layout_rejects_unknown_diagram() {
        let store = FakeLayoutStore::new();
        let worktrees = FakeGitWorktreeLister::new();
        let settings = registered_profile_settings(PathBuf::from(r"C:\repo"));

        let error = save_layout(
            &store,
            &worktrees,
            &settings,
            "unknown",
            Path::new(r"C:\repo"),
            &serde_json::json!({}),
        )
        .expect_err("should reject unknown diagram");

        assert!(matches!(error, AppError::NotFound(_)));
        assert!(store.saved.borrow().is_empty());
    }

    #[test]
    fn save_layout_rejects_repo_root_not_matching_any_registered_profile_or_its_worktrees() {
        let store = FakeLayoutStore::new();
        let worktrees = FakeGitWorktreeLister::new().with_worktree(
            PathBuf::from(r"C:\repo"),
            PathBuf::from(r"C:\repo\.claude\worktrees\some-other-worktree"),
        );
        let settings = registered_profile_settings(PathBuf::from(r"C:\repo"));

        let error = save_layout(
            &store,
            &worktrees,
            &settings,
            "sitemap",
            Path::new(r"C:\other"),
            &serde_json::json!({}),
        )
        .expect_err("should reject unregistered repo_root");

        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.saved.borrow().is_empty());
    }

    #[test]
    fn save_layout_writes_to_apps_web_data_layout_path_for_registered_repo_root() {
        let store = FakeLayoutStore::new();
        let worktrees = FakeGitWorktreeLister::new();
        let settings = registered_profile_settings(PathBuf::from(r"C:\repo"));
        let overrides = serde_json::json!({ "nodeA": { "x": 1, "y": 2 } });

        save_layout(
            &store,
            &worktrees,
            &settings,
            "sitemap",
            Path::new(r"C:\repo"),
            &overrides,
        )
        .expect("should save layout");

        let saved = store.saved.borrow();
        assert_eq!(saved.len(), 1);
        assert_eq!(
            saved[0].0,
            PathBuf::from(r"C:\repo\apps\web\src\data\layout\sitemap.json")
        );
        assert_eq!(saved[0].1, overrides);
    }

    #[test]
    fn save_layout_allows_repo_root_that_is_a_worktree_of_a_registered_profile() {
        let store = FakeLayoutStore::new();
        let registered = PathBuf::from(r"C:\repo");
        let worktree = PathBuf::from(r"C:\repo\.claude\worktrees\feature-x");
        let worktrees =
            FakeGitWorktreeLister::new().with_worktree(registered.clone(), worktree.clone());
        let settings = registered_profile_settings(registered);
        let overrides = serde_json::json!({ "nodeA": { "x": 1, "y": 2 } });

        save_layout(&store, &worktrees, &settings, "tm", &worktree, &overrides)
            .expect("should allow saving from a registered repo's worktree");

        let saved = store.saved.borrow();
        assert_eq!(saved.len(), 1);
        assert_eq!(
            saved[0].0,
            worktree.join("apps/web/src/data/layout/tm.json")
        );
    }

    #[test]
    fn save_layout_rejects_repo_root_when_worktree_lister_fails() {
        let store = FakeLayoutStore::new();
        let worktrees = FakeGitWorktreeLister::failing();
        let settings = registered_profile_settings(PathBuf::from(r"C:\repo"));
        let worktree = PathBuf::from(r"C:\repo\.claude\worktrees\feature-x");

        let error = save_layout(
            &store,
            &worktrees,
            &settings,
            "tm",
            &worktree,
            &serde_json::json!({}),
        )
        .expect_err("should fail closed when git worktree list fails");

        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.saved.borrow().is_empty());
    }

    struct FakeClaudeDirStore {
        entries: Vec<ClaudeDirEntry>,
        listed: std::cell::RefCell<Vec<String>>,
    }

    impl FakeClaudeDirStore {
        fn with_entries(entries: &[(&str, domain::ClaudeDirEntryKind)]) -> Self {
            Self {
                entries: entries
                    .iter()
                    .map(|(name, kind)| ClaudeDirEntry {
                        name: name.to_string(),
                        path: name.to_string(),
                        kind: *kind,
                        size_bytes: None,
                        modified_at_ms: 0,
                    })
                    .collect(),
                listed: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl ClaudeDirStore for FakeClaudeDirStore {
        fn list(&self, relative_path: &str) -> Result<Vec<ClaudeDirEntry>, AppError> {
            self.listed.borrow_mut().push(relative_path.to_string());
            Ok(self.entries.clone())
        }
    }

    fn sample_claude_dir_store() -> FakeClaudeDirStore {
        use domain::ClaudeDirEntryKind::{Directory, File};
        FakeClaudeDirStore::with_entries(&[
            ("b.json", File),
            ("Zeta", Directory),
            ("a.md", File),
            ("alpha", Directory),
        ])
    }

    #[test]
    fn list_claude_dir_sorts_directories_first_and_pages() {
        let store = sample_claude_dir_store();

        let page = list_claude_dir(&store, "projects", 1, 2).expect("should list");

        assert_eq!(page.total, 4);
        let names: Vec<&str> = page.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Zeta", "a.md"]);
        assert_eq!(*store.listed.borrow(), vec!["projects".to_string()]);
    }

    #[test]
    fn list_claude_dir_returns_empty_page_when_offset_exceeds_total() {
        let store = sample_claude_dir_store();

        let page = list_claude_dir(&store, "", 10, 2).expect("should list");

        assert!(page.entries.is_empty());
        assert_eq!(page.total, 4);
    }

    #[test]
    fn list_claude_dir_rejects_invalid_path_without_touching_store() {
        let store = sample_claude_dir_store();

        for path in ["..", "../x", "/etc", "C:/Windows", "a\\b"] {
            let error = list_claude_dir(&store, path, 0, 10).expect_err("should reject");
            assert!(matches!(error, AppError::InvalidInput(_)), "{path:?}");
        }
        assert!(store.listed.borrow().is_empty());
    }

    #[test]
    fn list_claude_dir_rejects_zero_or_excessive_limit() {
        let store = sample_claude_dir_store();

        for limit in [0, MAX_CLAUDE_DIR_PAGE_LIMIT + 1] {
            let error = list_claude_dir(&store, "", 0, limit).expect_err("should reject");
            assert!(matches!(error, AppError::InvalidInput(_)), "{limit}");
        }
        assert!(store.listed.borrow().is_empty());
    }

    struct FakeExecutionEnvironmentSource {
        pc: domain::Pc,
    }

    impl ExecutionEnvironmentSource for FakeExecutionEnvironmentSource {
        fn current_pc(&self) -> Result<domain::Pc, AppError> {
            Ok(self.pc.clone())
        }
    }

    #[test]
    fn current_pc_returns_source_result_unchanged_on_success() {
        let pc = domain::Pc {
            system_uuid: "11111111-2222-3333-4444-555555555555".to_string(),
            pc_name: "MY-PC".to_string(),
            description: String::new(),
            users: vec![domain::User {
                user_id: "yanqi".to_string(),
                user_name: "yanqi".to_string(),
                home_directory: PathBuf::from(r"C:\Users\yanqi"),
                repositories: Vec::new(),
                sessions: Vec::new(),
            }],
        };
        let source = FakeExecutionEnvironmentSource { pc: pc.clone() };

        let result = current_pc(&source).expect("should return pc");

        assert_eq!(result, pc);
    }

    #[test]
    fn current_pc_returns_placeholder_pc_produced_by_source_without_erroring() {
        // 個々の項目の取得失敗時、infra実装はエラーではなくプレースホルダ入りの
        // Pcを返す(issue #182)。app層はそれをそのまま透過するだけでよい。
        let placeholder_pc = domain::Pc {
            system_uuid: "unknown".to_string(),
            pc_name: "unknown".to_string(),
            description: String::new(),
            users: vec![],
        };
        let source = FakeExecutionEnvironmentSource {
            pc: placeholder_pc.clone(),
        };

        let result = current_pc(&source).expect("should not error even with placeholders");

        assert_eq!(result, placeholder_pc);
    }

    fn pc_with_one_user(user_id: &str) -> domain::Pc {
        domain::Pc {
            system_uuid: "uuid".to_string(),
            pc_name: "pc".to_string(),
            description: String::new(),
            users: vec![domain::User {
                user_id: user_id.to_string(),
                user_name: user_id.to_string(),
                home_directory: PathBuf::from(r"C:\Users\yanqi"),
                repositories: Vec::new(),
                sessions: Vec::new(),
            }],
        }
    }

    #[test]
    fn current_pc_with_repositories_fills_repositories_from_settings_profiles() {
        let pc = pc_with_one_user("yanqi");
        let mut profile = domain::Profile::new("p1".to_string(), "p1".to_string());
        profile.repository_path = Some(PathBuf::from(r"C:\repo\a"));
        let settings = settings_with_profile(profile);

        let result = current_pc_with_repositories(pc, &settings);

        assert_eq!(result.users.len(), 1);
        assert_eq!(result.users[0].repositories.len(), 1);
        assert_eq!(
            result.users[0].repositories[0].repository_path,
            PathBuf::from(r"C:\repo\a")
        );
    }

    #[test]
    fn current_pc_with_repositories_leaves_other_pc_fields_unchanged() {
        let pc = pc_with_one_user("yanqi");
        let settings = Settings::default();

        let result = current_pc_with_repositories(pc.clone(), &settings);

        assert_eq!(result.system_uuid, pc.system_uuid);
        assert_eq!(result.pc_name, pc.pc_name);
        assert_eq!(result.users[0].user_id, pc.users[0].user_id);
    }

    #[test]
    fn current_pc_with_repositories_gives_no_repositories_when_no_profile_has_a_path() {
        let pc = pc_with_one_user("yanqi");
        let settings = Settings::default();

        let result = current_pc_with_repositories(pc, &settings);

        assert!(result.users[0].repositories.is_empty());
    }

    struct FakeGitLedgerStore {
        loaded: GitLedger,
        saved: std::cell::RefCell<Vec<GitLedger>>,
    }

    impl FakeGitLedgerStore {
        fn new(loaded: GitLedger) -> Self {
            Self {
                loaded,
                saved: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl GitLedgerStore for FakeGitLedgerStore {
        fn load(&self) -> Result<GitLedger, AppError> {
            Ok(self.loaded.clone())
        }

        fn save(&self, ledger: &GitLedger) -> Result<(), AppError> {
            self.saved.borrow_mut().push(ledger.clone());
            Ok(())
        }
    }

    #[test]
    fn load_git_ledger_returns_store_result_unchanged() {
        let ledger = GitLedger {
            version: CURRENT_GIT_LEDGER_VERSION,
            repositories: HashMap::new(),
        };
        let store = FakeGitLedgerStore::new(ledger.clone());

        let loaded = load_git_ledger(&store).expect("should load git ledger");
        assert_eq!(loaded, ledger);
    }

    #[test]
    fn save_git_ledger_delegates_to_store() {
        let store = FakeGitLedgerStore::new(GitLedger::default());
        let ledger = GitLedger {
            version: CURRENT_GIT_LEDGER_VERSION,
            repositories: HashMap::from([(
                "C:\\repo\\a".to_string(),
                GitRepositoryLedger::default(),
            )]),
        };

        save_git_ledger(&store, &ledger).expect("should save git ledger");

        assert_eq!(store.saved.borrow().as_slice(), &[ledger]);
    }

    struct FakeGitStateSource {
        observations: HashMap<PathBuf, Result<domain::ObservedGitState, ()>>,
    }

    impl FakeGitStateSource {
        fn new() -> Self {
            Self {
                observations: HashMap::new(),
            }
        }

        fn with_observation(mut self, repo_root: &str, state: domain::ObservedGitState) -> Self {
            self.observations
                .insert(PathBuf::from(repo_root), Ok(state));
            self
        }

        fn with_failure(mut self, repo_root: &str) -> Self {
            self.observations.insert(PathBuf::from(repo_root), Err(()));
            self
        }
    }

    impl GitStateSource for FakeGitStateSource {
        fn observe(&self, repo_root: &Path) -> Result<domain::ObservedGitState, AppError> {
            match self.observations.get(repo_root) {
                Some(Ok(state)) => Ok(state.clone()),
                Some(Err(())) => Err(AppError::Io("観測に失敗しました".to_string())),
                None => Ok(domain::ObservedGitState::default()),
            }
        }
    }

    fn sequential_id_generator(prefix: &'static str) -> impl FnMut() -> String {
        let mut counter = 0u32;
        move || {
            counter += 1;
            format!("{prefix}-{counter}")
        }
    }

    #[test]
    fn reconcile_git_ledger_creates_new_branch_entries_for_a_fresh_repository() {
        let source = FakeGitStateSource::new().with_observation(
            r"C:\repo\a",
            domain::ObservedGitState {
                branch_names: vec!["main".to_string()],
                worktrees: Vec::new(),
            },
        );

        let result = reconcile_git_ledger(
            &source,
            &GitLedger::default(),
            &[PathBuf::from(r"C:\repo\a")],
            100,
            sequential_id_generator("id"),
        );

        assert!(result.failed_repository_paths.is_empty());
        let repo_ledger = result
            .ledger
            .repositories
            .get(r"C:\repo\a")
            .expect("repository should be present");
        assert_eq!(repo_ledger.branches.len(), 1);
        assert_eq!(repo_ledger.branches[0].branch_name, "main");
        assert_eq!(repo_ledger.branches[0].created_at_time, 100);
    }

    #[test]
    fn reconcile_git_ledger_resolves_checked_out_branch_id_from_freshly_reconciled_branches() {
        let source = FakeGitStateSource::new().with_observation(
            r"C:\repo\a",
            domain::ObservedGitState {
                branch_names: vec!["feature-x".to_string()],
                worktrees: vec![domain::ObservedWorktree {
                    folder_path: PathBuf::from(r"C:\repo\worktrees\feature-x"),
                    git_file_path: PathBuf::from(r"C:\repo\worktrees\feature-x\.git"),
                    checked_out_branch_name: Some("feature-x".to_string()),
                }],
            },
        );

        let result = reconcile_git_ledger(
            &source,
            &GitLedger::default(),
            &[PathBuf::from(r"C:\repo\a")],
            100,
            sequential_id_generator("id"),
        );

        let repo_ledger = &result.ledger.repositories[r"C:\repo\a"];
        let branch_id = repo_ledger.branches[0].branch_id.clone();
        assert_eq!(repo_ledger.worktrees.len(), 1);
        assert_eq!(repo_ledger.worktrees[0].checked_out_branch, Some(branch_id));
    }

    #[test]
    fn reconcile_git_ledger_leaves_ledger_of_failed_repository_completely_unchanged() {
        let mut previous_repositories = HashMap::new();
        previous_repositories.insert(
            r"C:\repo\a".to_string(),
            GitRepositoryLedger {
                branches: vec![domain::GitBranch {
                    branch_id: "id-1".to_string(),
                    branch_name: "main".to_string(),
                    description: String::new(),
                    created_at_time: 1,
                    deleted_at_time: None,
                }],
                worktrees: Vec::new(),
            },
        );
        let previous_ledger = GitLedger {
            version: CURRENT_GIT_LEDGER_VERSION,
            repositories: previous_repositories,
        };
        let source = FakeGitStateSource::new().with_failure(r"C:\repo\a");

        let result = reconcile_git_ledger(
            &source,
            &previous_ledger,
            &[PathBuf::from(r"C:\repo\a")],
            999,
            sequential_id_generator("id"),
        );

        assert_eq!(
            result.failed_repository_paths,
            vec![PathBuf::from(r"C:\repo\a")]
        );
        assert_eq!(
            result.ledger.repositories[r"C:\repo\a"],
            previous_ledger.repositories[r"C:\repo\a"]
        );
    }

    #[test]
    fn pc_with_git_ledger_fills_matching_repository_by_path() {
        let mut pc = pc_with_one_user("yanqi");
        pc.users[0].repositories.push(domain::GitRepository {
            repository_path: PathBuf::from(r"C:\repo\a"),
            repository_name: "a".to_string(),
            description: String::new(),
            branches: Vec::new(),
            worktrees: Vec::new(),
        });
        let mut repositories = HashMap::new();
        repositories.insert(
            r"C:\repo\a".to_string(),
            GitRepositoryLedger {
                branches: vec![domain::GitBranch {
                    branch_id: "id-1".to_string(),
                    branch_name: "main".to_string(),
                    description: String::new(),
                    created_at_time: 1,
                    deleted_at_time: None,
                }],
                worktrees: Vec::new(),
            },
        );
        let ledger = GitLedger {
            version: CURRENT_GIT_LEDGER_VERSION,
            repositories,
        };

        let result = pc_with_git_ledger(pc, &ledger);

        assert_eq!(result.users[0].repositories[0].branches.len(), 1);
        assert_eq!(
            result.users[0].repositories[0].branches[0].branch_name,
            "main"
        );
    }

    #[test]
    fn pc_with_git_ledger_leaves_repository_empty_when_not_yet_in_ledger() {
        let mut pc = pc_with_one_user("yanqi");
        pc.users[0].repositories.push(domain::GitRepository {
            repository_path: PathBuf::from(r"C:\repo\unregistered"),
            repository_name: "unregistered".to_string(),
            description: String::new(),
            branches: Vec::new(),
            worktrees: Vec::new(),
        });

        let result = pc_with_git_ledger(pc, &GitLedger::default());

        assert!(result.users[0].repositories[0].branches.is_empty());
        assert!(result.users[0].repositories[0].worktrees.is_empty());
    }
}
