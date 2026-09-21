use domain::{
    is_valid_claude_dir_path, is_valid_json, is_valid_rule_file_name, is_valid_session_id,
    is_valid_skill_name, order_messages_newest_first, paginate_messages, reconcile_branches,
    reconcile_worktrees, repositories_from_profiles, sort_claude_dir_entries,
    sort_projects_by_recency, sort_sessions_by_recency, Camera, ClaudeDirEntry, ClaudeDirPage,
    ClaudeMdFile, ClaudeSettingsFile, Conversation, GitLedger, GitRepositoryLedger, HubLayout,
    HubTuning, LogLine, NodePosition, ParsedSession, Project, RuleSummary, SessionSummary,
    Settings, SkillSummary, CURRENT_GIT_LEDGER_VERSION, CURRENT_HUB_LAYOUT_VERSION,
    CURRENT_HUB_TUNING_VERSION,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    InvalidInput(String),
    /// 表示中のセッションが、送信直前の時点での最新セッションと一致しない。
    #[error("{0}")]
    SessionStale(String),
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

/// プロジェクト・セッションの読み取り(ports)。Claude Code のログ形式
/// (`~/.claude/projects/` の走査、JSONL解析)に固有の詳細はこの抽象の
/// 向こう側(infra)に閉じ込め、`app` はプロジェクト名・セッションIDなどの
/// 抽象的な値だけを扱う。
pub trait SessionSource {
    fn list_projects(&self) -> Result<Vec<Project>, AppError>;

    /// 指定セッション(ID + 全メッセージ)を返す。
    fn session(&self, project: &str, session_id: &str) -> Result<Conversation, AppError>;

    /// 最新セッションのIDだけを返す(送信前後の一致検証用の軽量な問い合わせ)。
    fn latest_session_id(&self, project: &str) -> Result<String, AppError>;

    /// 最新セッションの作業ディレクトリ(cwd)を返す。`AgentGateway` へ渡す
    /// `SendRequest` を組み立てるために使う。
    fn latest_session_cwd(&self, project: &str) -> Result<PathBuf, AppError>;

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

    /// 指定セッションの会話ファイルを行単位で`LogLine`に変換して返す
    /// (オブジェクトモデル実装 第6弾。issue #208)。`session`(メッセージ抽出。
    /// `Conversation`用)とは別に1回ファイルを読む(呼び出し元
    /// `get_session` commandが同じ操作のついでに呼ぶことで「セッションを
    /// 開いたとき」に組み立てる意図は満たすが、実装としては別読み込みで
    /// ある点に注意。行の変換に失敗した行(uuid/timestamp欠損等)は
    /// 実装側でスキップし、警告ログを出すこと(issue本文の指示)。
    fn session_lines(&self, project: &str, session_id: &str) -> Result<Vec<LogLine>, AppError>;
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

/// 送信対象のセッションをどう扱うか。現時点では既存セッションの継続のみを
/// サポートする(新規セッションを明示的に開始するUIは将来の別イシューで扱う)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Continuation {
    Continue,
}

#[derive(Debug, Clone)]
pub struct SendRequest {
    pub cwd: PathBuf,
    pub text: String,
    pub mode: AgentMode,
    pub continuation: Continuation,
}

/// 送信直後に `SessionSource` から再取得した最新セッションIDが、送信前に
/// 検証した `expected_session_id` と食い違っていた場合の情報。
///
/// 送信前チェックと `AgentGateway::send` の実行の間には別セッションが
/// 割り込む競合窓が原理的に残る(`--continue` は実行時点の最新会話を継続する
/// ため)。この窓で割り込みが起きると、検証を通過したのに表示中とは別の
/// 会話へ追記されてしまう。送信自体は成功しているため `AppError` にはせず、
/// 呼び出し側(tauri層)が警告としてフロントへ伝えるための戻り値として返す。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionMismatch {
    pub expected_session_id: String,
    pub actual_session_id: String,
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
pub fn get_session(
    source: &dyn SessionSource,
    project: &str,
    session_id: &str,
    offset: usize,
    limit: usize,
) -> Result<Conversation, AppError> {
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let mut session = source.session(project, session_id)?;
    order_messages_newest_first(&mut session.messages);
    session.messages = paginate_messages(&session.messages, offset, limit);
    Ok(session)
}

/// 指定セッションの会話ファイルを`LogLine`一覧として読み込む(オブジェクト
/// モデル実装 第6弾。issue #208)。ビューアがセッションを開いたとき
/// (`get_session`と同じ操作の一部)に呼び、結果は呼び出し元
/// (tauri層のAppState)がファイルパスをキーにキャッシュして、以後は
/// 再読み込みしない。
pub fn load_session_lines(
    source: &dyn SessionSource,
    project: &str,
    session_id: &str,
) -> Result<Vec<LogLine>, AppError> {
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    source.session_lines(project, session_id)
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

/// 指定プロジェクトのセッション一覧を、最終更新の新しい順に並べて返す
/// (ビューア左ペイン用。issue #33)。
pub fn list_sessions(
    source: &dyn SessionSource,
    project: &str,
) -> Result<Vec<SessionSummary>, AppError> {
    let mut sessions = source.list_sessions(project)?;
    sort_sessions_by_recency(&mut sessions);
    Ok(sessions)
}

/// `expected_session_id` が実行直前の最新セッションと一致する場合のみ送信する。
///
/// 表示してから送信するまでの間に別のセッションが作られていた場合(例: Claude
/// Desktop側で新しい会話を始めた)、ユーザーが見ていない会話に無言で追記される
/// 事故を防ぐための不変条件。不一致なら送信せず `SessionStale` を返す。
///
/// 送信後、`SessionSource` から改めて最新セッションIDを取得し
/// `expected_session_id` と比較する。送信前チェックと送信実行の間の競合窓
/// (このチェックでは検出できない)で割り込みが起きていた場合、[`SessionMismatch`]
/// を返す。送信自体は成功しているため、これはエラーではなく戻り値としての
/// 警告情報である。
pub fn send_message(
    source: &dyn SessionSource,
    agent: &dyn AgentGateway,
    project: &str,
    expected_session_id: &str,
    text: &str,
    mode: AgentMode,
) -> Result<Option<SessionMismatch>, AppError> {
    if text.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "メッセージを入力してください".to_string(),
        ));
    }

    let actual_session_id = source.latest_session_id(project)?;
    if actual_session_id != expected_session_id {
        return Err(AppError::SessionStale(format!(
            "表示中のセッションが最新ではありません(表示中: {expected_session_id}, 最新: {actual_session_id})"
        )));
    }

    let cwd = source.latest_session_cwd(project)?;
    agent.send(SendRequest {
        cwd,
        text: text.to_string(),
        mode,
        continuation: Continuation::Continue,
    })?;

    let post_send_session_id = source.latest_session_id(project)?;
    if post_send_session_id != expected_session_id {
        return Ok(Some(SessionMismatch {
            expected_session_id: expected_session_id.to_string(),
            actual_session_id: post_send_session_id,
        }));
    }

    Ok(None)
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
    use domain::{AgentKind, Message, Role};

    struct FakeSessionSource {
        projects: Vec<Project>,
        session_id: String,
        /// `Some` の場合、2回目以降の `latest_session_id` 呼び出しでこの値を返す
        /// (送信前チェックと送信後チェックの間にセッションが変わった状況を再現する)。
        post_send_session_id: Option<String>,
        messages: Vec<Message>,
        cwd: PathBuf,
        fail_list_projects: bool,
        latest_session_id_calls: std::cell::Cell<usize>,
        sessions: Vec<SessionSummary>,
        parsed_sessions: HashMap<String, Result<Vec<ParsedSession>, ()>>,
        log_lines: Result<Vec<LogLine>, ()>,
    }

    impl FakeSessionSource {
        fn new(session_id: &str, messages: Vec<Message>) -> Self {
            Self {
                projects: Vec::new(),
                session_id: session_id.to_string(),
                post_send_session_id: None,
                messages,
                cwd: PathBuf::from("/tmp/some-project"),
                fail_list_projects: false,
                latest_session_id_calls: std::cell::Cell::new(0),
                sessions: Vec::new(),
                parsed_sessions: HashMap::new(),
                log_lines: Ok(Vec::new()),
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

        fn session(&self, _project: &str, session_id: &str) -> Result<Conversation, AppError> {
            Ok(Conversation {
                id: session_id.to_string(),
                messages: self.messages.clone(),
                agent: AgentKind::ClaudeCode,
            })
        }

        fn latest_session_id(&self, _project: &str) -> Result<String, AppError> {
            let call = self.latest_session_id_calls.get();
            self.latest_session_id_calls.set(call + 1);
            if call == 0 {
                Ok(self.session_id.clone())
            } else {
                Ok(self
                    .post_send_session_id
                    .clone()
                    .unwrap_or_else(|| self.session_id.clone()))
            }
        }

        fn latest_session_cwd(&self, _project: &str) -> Result<PathBuf, AppError> {
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

        fn session_lines(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<Vec<LogLine>, AppError> {
            self.log_lines
                .clone()
                .map_err(|()| AppError::Io("boom".to_string()))
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
                },
                Message {
                    role: Role::Assistant,
                    text: "second".to_string(),
                    timestamp: "".to_string(),
                },
            ],
        );

        let session =
            get_session(&source, "some-project", "s1", 0, 10).expect("should get session");
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
                })
                .collect(),
        );

        // 記録順は a,b,c,d -> 新しい順は d,c,b,a -> offset 1, limit 2 で c,b
        let session = get_session(&source, "some-project", "s1", 1, 2).expect("should get session");
        let texts: Vec<&str> = session.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["c", "b"]);
    }

    #[test]
    fn get_session_rejects_invalid_session_id_without_calling_source() {
        let source = FakeSessionSource::new("s1", vec![]);

        let error = get_session(&source, "some-project", "../../etc/passwd", 0, 10)
            .expect_err("should reject invalid session id");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn list_sessions_sorts_by_recency_and_marks_latest() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.sessions = vec![
            SessionSummary {
                id: "old".to_string(),
                title: "old".to_string(),
                modified_at_ms: 1,
                is_latest: false,
                cwd: None,
                git_branch: None,
            },
            SessionSummary {
                id: "new".to_string(),
                title: "new".to_string(),
                modified_at_ms: 2,
                is_latest: false,
                cwd: None,
                git_branch: None,
            },
        ];

        let sessions = list_sessions(&source, "some-project").expect("should list sessions");
        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "old"]);
        assert!(sessions[0].is_latest);
        assert!(!sessions[1].is_latest);
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
    fn load_session_lines_delegates_to_source_for_a_valid_session_id() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.log_lines = Ok(vec![sample_log_line("l1")]);

        let lines = load_session_lines(&source, "proj", "s1").expect("should load lines");

        assert_eq!(lines, vec![sample_log_line("l1")]);
    }

    #[test]
    fn load_session_lines_rejects_invalid_session_id_without_calling_source() {
        let source = FakeSessionSource::new("s1", vec![]);

        let error = load_session_lines(&source, "proj", "../etc/passwd")
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
    fn send_message_delegates_to_agent_when_session_matches() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let outcome = send_message(
            &source,
            &agent,
            "some-project",
            "s1",
            "hello",
            AgentMode::Chat,
        )
        .expect("should send message");
        assert_eq!(outcome, None, "no mismatch when session id is unchanged");

        let sent = agent.sent.borrow();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].text, "hello");
        assert_eq!(sent[0].cwd, source.cwd);
        assert_eq!(sent[0].mode, AgentMode::Chat);
        assert_eq!(sent[0].continuation, Continuation::Continue);
    }

    #[test]
    fn send_message_passes_requested_mode_through_to_agent() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        send_message(
            &source,
            &agent,
            "some-project",
            "s1",
            "hello",
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
    fn send_message_returns_mismatch_when_session_changes_during_send() {
        let mut source = FakeSessionSource::new("s1", vec![]);
        source.post_send_session_id = Some("s2".to_string());
        let agent = FakeAgentGateway::default();

        let outcome = send_message(
            &source,
            &agent,
            "some-project",
            "s1",
            "hello",
            AgentMode::Chat,
        )
        .expect("send itself should still succeed");

        assert_eq!(
            outcome,
            Some(SessionMismatch {
                expected_session_id: "s1".to_string(),
                actual_session_id: "s2".to_string(),
            })
        );
        // 送信自体は行われている(警告であってエラーではない)。
        assert_eq!(agent.sent.borrow().len(), 1);
    }

    #[test]
    fn send_message_rejects_blank_text() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let error = send_message(
            &source,
            &agent,
            "some-project",
            "s1",
            "   ",
            AgentMode::Chat,
        )
        .expect_err("should reject");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(agent.sent.borrow().is_empty());
    }

    #[test]
    fn send_message_rejects_stale_session_without_sending() {
        let source = FakeSessionSource::new("latest-id", vec![]);
        let agent = FakeAgentGateway::default();
        let error = send_message(
            &source,
            &agent,
            "some-project",
            "displayed-id",
            "hello",
            AgentMode::Chat,
        )
        .expect_err("should reject stale session");
        assert!(matches!(error, AppError::SessionStale(_)));
        assert!(
            agent.sent.borrow().is_empty(),
            "must not send when session is stale"
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
