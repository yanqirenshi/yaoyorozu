use app::AppError;
use domain::{GitLedger, Pc, Settings};
use infra::{
    FileGitLedgerStore, FileSettingsStore, SystemGitStateSource, WindowsExecutionEnvironmentSource,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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

        Ok(LoadResult {
            state: AppState {
                settings: loaded.settings,
                save_path,
                github_login: None,
                window_states: app::WindowRegistry::new(),
                pc,
                git_ledger,
                git_ledger_path,
            },
            recovered_from_corruption: loaded.recovered_from_corruption,
        })
    }
}
