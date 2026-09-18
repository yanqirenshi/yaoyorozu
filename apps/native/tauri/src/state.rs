use app::AppError;
use domain::{effective_projects_dir, GitLedger, LogLine, ParsedSession, Pc, Settings};
use infra::{
    FileGitLedgerStore, FileSettingsStore, FileSystemRepository, SystemGitStateSource,
    WindowsExecutionEnvironmentSource,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// 設定の `claude_projects_dir` と既定値(`~/.claude/projects/`)から、
/// 実際に使うルートディレクトリを求める。`AppState::load`(起動時)・各
/// commandの両方から使う共通処理のため、`tauri/src/lib.rs` ではなくここに
/// 置く(issue #197でセッションモデルの組み立てに必要になり移設した)。
pub fn resolve_effective_projects_dir(settings: &Settings) -> Result<PathBuf, AppError> {
    let default = FileSystemRepository::default_projects_dir()?;
    Ok(effective_projects_dir(
        settings.claude_projects_dir.as_deref(),
        &default,
    ))
}

/// アプリの唯一の真実(SSoT)。`tauri::State<tokio::sync::Mutex<AppState>>` として
/// 管理する(native.md §2)。
pub struct AppState {
    pub settings: Settings,
    pub save_path: PathBuf,
    /// 認証済みGitHubアカウントのログイン名。トークン自体はここには置かず
    /// `TokenStore`(OSキーチェーン)にのみ保管する(native.md §4)。
    /// 起動時は `None` から始まり、既存トークンがあればバックグラウンドで
    /// 検証して設定される(`start_github_session_check`)。
    pub github_login: Option<String>,
    /// 各ウィンドウの表示状態(ハブ化 その1。issue #83)。設定ファイルには
    /// 保存しないランタイム状態で、起動時は常に空。ウィンドウが閉じられると
    /// `on_window_event` の `Destroyed` で自動的に除去される。
    pub window_states: app::WindowRegistry,
    /// 現在のPC・ログインユーザー情報(オブジェクトモデル実装 第1弾。
    /// issue #182)。`window_states` と同様に設定ファイルには保存しない
    /// ランタイム状態で、真実の源はOSであるため起動のたびに組み立て直す。
    pub pc: Pc,
    /// `GitBranch`/`GitWorktree`台帳(オブジェクトモデル実装 第3弾。
    /// issue #193)。`git-ledger.json`から読み込み、起動時に一度突き合わせ
    /// (reconcile)た結果を保持する。`pc`と違い、gitサブプロセス実行を伴う
    /// 突き合わせは高コストなためクエリのたびには行わず、起動時とハブの
    /// 再読み込み操作時(`reconcile_git_state` command)にのみ更新する
    /// (`app::reconcile_git_ledger`のドキュメントコメント参照)。
    pub git_ledger: GitLedger,
    pub git_ledger_path: PathBuf,
    /// 全プロジェクトを走査した`ParsedSession`一覧(オブジェクトモデル実装
    /// 第4〜5弾。issue #197/#208)。`git_ledger`と同じ理由(jsonl走査コスト)
    /// で、ファイル走査自体はクエリのたびに再実行せず、起動時とハブ再読み込み
    /// 時(`reconcile_git_state` command。第3弾と合わせて再観測する)にのみ
    /// 更新する。実際の`Session`/`SessionFile`への組み立て
    /// (`domain::User::load_sessions`)はI/Oを伴わない純粋変換のため、
    /// クエリのたび(`get_pc`)に呼んでも構わない
    /// (`app::pc_with_user_sessions`参照)。
    pub user_sessions: Vec<ParsedSession>,
    /// セッションを開いたとき(`get_session` command)に組み立てた
    /// `LogLine`のキャッシュ(オブジェクトモデル実装 第6弾。issue #208)。
    /// キーは会話ファイルのパス(`Session.conversation_file.file_path`と
    /// 一致)。`window_states`と同様、設定ファイルには保存しないランタイム
    /// 状態で、起動時は常に空(遅延読み込み。行は読まない)。同じファイルを
    /// 再度開いても読み直さないための唯一の目的のキャッシュのため、
    /// エントリを削除する経路は無い(セッション数×平均行数程度で、
    /// アプリの実行中に無制限膨張する心配は小さいという判断。issue本文の
    /// スコープには含まれないため深追いしない)。
    pub loaded_log_lines: HashMap<PathBuf, Vec<LogLine>>,
}

/// エポック秒からのミリ秒。`GitBranch`/`GitWorktree`の
/// `created_at_time`/`deleted_at_time`に使う「アプリが観測した時刻」
/// (issue #193)。他の永続化コード(`FileHubLayoutStore`の
/// `evacuate_corrupt_file`等)と同じく、時刻取得に専用のportは設けず
/// `SystemTime`を直接呼ぶ(native.md に反しない。既存の踏襲)。
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 登録済みプロファイルからGit状態の観測・台帳突き合わせを行い、結果を
/// 保存する(issue #193)。起動時(`AppState::load`)とハブの再読み込み操作
/// (`reconcile_git_state` command)の両方から呼ぶ共通処理。観測に失敗した
/// リポジトリがあれば標準エラー出力へ警告を出す(fail-safeでその
/// リポジトリの台帳は変更しない。`app::reconcile_git_ledger`参照)。
pub fn reconcile_and_save_git_ledger(
    settings: &Settings,
    previous_ledger: &GitLedger,
    git_ledger_path: &Path,
) -> GitLedger {
    let repositories = domain::repositories_from_profiles(&settings.profiles);
    let repository_paths: Vec<PathBuf> = repositories
        .into_iter()
        .map(|r| r.repository_path)
        .collect();
    let source = SystemGitStateSource::new();
    let result = app::reconcile_git_ledger(
        &source,
        previous_ledger,
        &repository_paths,
        now_ms(),
        || uuid::Uuid::new_v4().to_string(),
    );
    for failed_path in &result.failed_repository_paths {
        eprintln!(
            "Git状態の観測に失敗したため、{} の台帳は変更しませんでした",
            failed_path.display()
        );
    }
    let store = FileGitLedgerStore::new(git_ledger_path.to_path_buf());
    if let Err(e) = app::save_git_ledger(&store, &result.ledger) {
        eprintln!("Git台帳の保存に失敗しました: {e}");
    }
    result.ledger
}

/// 全プロジェクトから`ParsedSession`一覧を組み立てる(issue #197/#208)。
/// 起動時(`AppState::load`)とハブの再読み込み操作(`reconcile_git_state`
/// command。第3弾のGit台帳と同じタイミングで呼ぶ)の両方から使う共通処理。
/// プロジェクト単位で読み取りに失敗しても他のプロジェクトの結果は失わない
/// (fail-safe。`app::build_user_sessions`参照)。永続化対象ではない
/// (真実の源は常にjsonlファイル自体であり、`GitLedger`のような独自の
/// 台帳・IDは持たない)ため、ロード/セーブは無い。
pub fn build_and_report_user_sessions(settings: &Settings) -> Result<Vec<ParsedSession>, AppError> {
    let projects_dir = resolve_effective_projects_dir(settings)?;
    let source = FileSystemRepository::new(projects_dir);
    let result = app::build_user_sessions(&source)?;
    for failed_project in &result.failed_projects {
        eprintln!("セッションの読み取りに失敗したため、{failed_project} は含めませんでした");
    }
    Ok(result.parsed)
}

/// [`AppState::load`] の結果。設定ファイルの破損から復旧した場合、呼び出し側
/// (`run()`)が `settings:corrupted` イベントを emit するかどうかの判断に使う。
pub struct LoadResult {
    pub state: AppState,
    pub recovered_from_corruption: bool,
}

impl AppState {
    /// 起動時に設定ファイルを読み込む。存在しない/壊れている場合のデフォルト値
    /// へのフォールバックは `FileSettingsStore` 側の責務。Git台帳の初回突き
    /// 合わせもここで行う(issue #193)。
    pub fn load(save_path: PathBuf, git_ledger_path: PathBuf) -> Result<LoadResult, AppError> {
        let store = FileSettingsStore::new(save_path.clone());
        let loaded = app::load_settings(&store)?;
        let environment_source = WindowsExecutionEnvironmentSource::new();
        let pc = app::current_pc(&environment_source)?;

        let ledger_store = FileGitLedgerStore::new(git_ledger_path.clone());
        let previous_ledger = app::load_git_ledger(&ledger_store)?;
        let git_ledger =
            reconcile_and_save_git_ledger(&loaded.settings, &previous_ledger, &git_ledger_path);
        let user_sessions = build_and_report_user_sessions(&loaded.settings)?;

        Ok(LoadResult {
            state: AppState {
                settings: loaded.settings,
                save_path,
                github_login: None,
                window_states: app::WindowRegistry::new(),
                pc,
                git_ledger,
                git_ledger_path,
                user_sessions,
                loaded_log_lines: HashMap::new(),
            },
            recovered_from_corruption: loaded.recovered_from_corruption,
        })
    }
}
