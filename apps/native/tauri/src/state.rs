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
    ///
    /// `users[].sessions`(`Session`/`SessionFile`)はここに**常駐**する
    /// (Session常駐化 PoC)。素材の`user_sessions`が変わったとき(走査キュー
    /// 完了・差分再走査)に`app::refresh_user_sessions`で更新され、`get_pc`は
    /// 組み立てをせずこのツリーをDTO化するだけになる。起動直後は空で、
    /// 走査キューが埋める。
    pub pc: Pc,
    /// `GitBranch`/`GitWorktree`台帳(オブジェクトモデル実装 第3弾。
    /// issue #193)。起動直後は`git-ledger.json`から読み込んだだけの値
    /// (前回終了時点の内容。突き合わせ前)で、ウィンドウ表示後の
    /// バックグラウンドタスク(issue #212)が最初の突き合わせを行う。
    /// `pc`と違い、gitサブプロセス実行を伴う突き合わせは高コストなため
    /// クエリのたびには行わず、起動後のバックグラウンドタスクとハブの
    /// 再読み込み操作時(`reconcile_git_state` command)にのみ更新する
    /// (`app::reconcile_git_ledger`のドキュメントコメント参照)。
    pub git_ledger: GitLedger,
    pub git_ledger_path: PathBuf,
    /// 全プロジェクトを走査した`ParsedSession`一覧(オブジェクトモデル実装
    /// 第4〜5弾。issue #197/#208)。起動直後は空(永続化していないため。
    /// issue #212)で、ウィンドウ表示後のバックグラウンドタスクが最初の
    /// 走査結果を書き込む。`git_ledger`と同じ理由(jsonl走査コスト)で、
    /// ファイル走査自体はクエリのたびに再実行せず、起動後のバックグラウンド
    /// タスクとハブ再読み込み時(`reconcile_git_state` command。第3弾と
    /// 合わせて再観測する)にのみ更新する。`Session`/`SessionFile`への
    /// 組み立ては常駐化した(Session常駐化 PoC): この一覧を変更した箇所が
    /// `app::refresh_user_sessions`で`pc`内の保持ツリーへ反映する
    /// (集約(#217)の再計算にファイル単位の値が必要なため、素材である
    /// この一覧は常駐化後も保持し続ける)。
    pub user_sessions: Vec<ParsedSession>,
    /// セッションを開いたとき(`get_session` command)に組み立てた
    /// `LogLine`のキャッシュ(オブジェクトモデル実装 第6弾。issue #208)。
    /// キーは会話ファイルのパス(`Session.conversation_files[].file_path`と
    /// 一致)。`window_states`と同様、設定ファイルには保存しないランタイム
    /// 状態で、起動時は常に空(遅延読み込み。行は読まない)。
    /// Session常駐化 PoC で次の後始末・更新経路が加わった:
    /// 読み込み済みファイルの変更時は差分再走査が行を自動で読み直し、
    /// ファイルの削除時(差分再走査)・列挙から消えたとき(全件キュー完了)は
    /// エントリを取り除く。容量上限は引き続き設けない(無制限膨張の心配は
    /// 小さいという判断のまま)。
    pub loaded_log_lines: HashMap<PathBuf, Vec<LogLine>>,
    /// `git_ledger`/`user_sessions` の読み込みが完了したかどうか
    /// (issue #218)。起動時は`false`で、起動後のバックグラウンドタスク・
    /// ハブの「再読み込み」操作のいずれかが一度でも完了すれば(成否に
    /// かかわらず)`true`になり、以後戻らない。`pc:data_loaded`イベントは
    /// マウント中のハブにしか届かない(#212の既知の制約)ため、`get_pc`の
    /// 応答にもこの値を載せ、マウント時の問い合わせだけで正しい状態が
    /// 分かるようにする(イベント購読と併用。ポーリングはしない)。
    pub pc_data_loaded: bool,
    /// 走査キュー(PoC。`session_scan_queue`)の世代番号。キュー開始のたびに
    /// インクリメントし、走行中のワーカーは適用前に自分の世代と比較する。
    /// 再読み込み・プロファイル切替等でキューが再開始された場合に、旧世代の
    /// 走査結果が新しい`user_sessions`を上書きしないようにするための値。
    pub session_scan_generation: u64,
    /// ファイル監視が検知した会話ファイルの変更の待ち行列(ハブの自動更新。
    /// issue #311。`session_scan_queue::enqueue_changed`)。実行時状態で永続化しない。
    pub session_rescan: app::RescanQueue,
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
    /// へのフォールバックは `FileSettingsStore` 側の責務。
    ///
    /// Git台帳の突き合わせ(git サブプロセス実行)・全プロジェクトのjsonl
    /// 走査(`list_parsed_sessions`)はここでは行わない(issue #212:
    /// 初回表示のラグ解消のため、ウィンドウ表示後のバックグラウンドタスクへ
    /// 遅延させる。`tauri/src/lib.rs`の`start_pc_data_background_load`
    /// 参照)。台帳ファイル自体の読み込み(JSON読み込みのみ。軽い)は
    /// 同期のまま行い、前回終了時点の内容をひとまず見せる
    /// (バックグラウンドタスク完了で最新化される)。`user_sessions`は
    /// 永続化していないため、起動直後は空で始めるほかない。
    pub fn load(save_path: PathBuf, git_ledger_path: PathBuf) -> Result<LoadResult, AppError> {
        let store = FileSettingsStore::new(save_path.clone());
        let loaded = app::load_settings(&store)?;
        let environment_source = WindowsExecutionEnvironmentSource::new();
        let pc = app::current_pc(&environment_source)?;

        let ledger_store = FileGitLedgerStore::new(git_ledger_path.clone());
        let git_ledger = app::load_git_ledger(&ledger_store)?;

        Ok(LoadResult {
            state: AppState {
                settings: loaded.settings,
                save_path,
                github_login: None,
                window_states: app::WindowRegistry::new(),
                pc,
                git_ledger,
                git_ledger_path,
                user_sessions: Vec::new(),
                loaded_log_lines: HashMap::new(),
                pc_data_loaded: false,
                session_scan_generation: 0,
                session_rescan: app::RescanQueue::default(),
            },
            recovered_from_corruption: loaded.recovered_from_corruption,
        })
    }
}
