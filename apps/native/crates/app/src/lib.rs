use domain::{
    order_messages_newest_first, paginate_messages, sort_projects_by_recency, ClaudeMdFile,
    Project, Session, Settings,
};
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
    #[error("{0}")]
    GithubAuthExpired(String),
    /// GitHub API(GraphQL含む)呼び出しが失敗した。
    #[error("{0}")]
    GithubApiFailed(String),
    /// CLAUDE.md の保存時、`expected_modified_at_ms` が実際のファイルの
    /// 状態と一致しなかった(アプリ外での変更と競合)。
    #[error("{0}")]
    ClaudeMdConflict(String),
}

/// プロジェクト・セッションの読み取り(ports)。Claude Code のログ形式
/// (`~/.claude/projects/` の走査、JSONL解析)に固有の詳細はこの抽象の
/// 向こう側(infra)に閉じ込め、`app` はプロジェクト名・セッションIDなどの
/// 抽象的な値だけを扱う。
pub trait SessionSource {
    fn list_projects(&self) -> Result<Vec<Project>, AppError>;

    /// 最新セッション(ID + 全メッセージ)を返す。
    fn latest_session(&self, project: &str) -> Result<Session, AppError>;

    /// 最新セッションのIDだけを返す(送信前後の一致検証用の軽量な問い合わせ)。
    fn latest_session_id(&self, project: &str) -> Result<String, AppError>;

    /// 最新セッションの作業ディレクトリ(cwd)を返す。`AgentGateway` へ渡す
    /// `SendRequest` を組み立てるために使う。
    fn latest_session_cwd(&self, project: &str) -> Result<PathBuf, AppError>;
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

/// 起動時に読み込んだ設定。ファイルが存在しない場合と破損していた場合を
/// 区別しない(どちらもデフォルト値へフォールバックする)が、破損からの
/// 復旧があったかどうかは呼び出し側(tauri層)が `app:warning` を出すか
/// どうかの判断に使うため保持する。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedSettings {
    pub settings: Settings,
    pub recovered_from_corruption: bool,
}

/// GitHub OAuth(デバイスフロー)+ Projects(v2) 取得(port)。実体(HTTP通信)は
/// infra に閉じ込める。将来 GitHub 以外の連携を足す可能性は現状ないため、
/// `AgentGateway` のような抽象化はせず GitHub 固有の port として定義する。
pub trait GithubGateway {
    fn start_device_flow(&self) -> Result<DeviceAuthorization, AppError>;
    fn poll_for_token(&self, device_code: &str) -> Result<PollResult, AppError>;
    fn fetch_viewer(&self, token: &str) -> Result<GithubViewer, AppError>;
    fn list_projects(&self, token: &str) -> Result<Vec<domain::GithubProjectSummary>, AppError>;
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

/// 最新セッションのメッセージを新しい順に並べ、`offset`/`limit` で指定された
/// 範囲だけを返す(1回のIPCで会話全件を返さないため)。
pub fn get_latest_session(
    source: &dyn SessionSource,
    project: &str,
    offset: usize,
    limit: usize,
) -> Result<Session, AppError> {
    let mut session = source.latest_session(project)?;
    order_messages_newest_first(&mut session.messages);
    session.messages = paginate_messages(&session.messages, offset, limit);
    Ok(session)
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

/// 設定項目のうち、この時点で検証できる最小限の内容(GitHubプロジェクトの
/// owner が空でないこと)を確認する。GitHubプロジェクトの実在確認等の高度な
/// バリデーションはスコープ外(issue #17)。
pub fn validate_settings(settings: &Settings) -> Result<(), AppError> {
    if let Some(project) = &settings.github_project {
        if !project.is_valid() {
            return Err(AppError::InvalidInput(
                "GitHubプロジェクトのownerを入力してください".to_string(),
            ));
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

pub fn start_github_login(gateway: &dyn GithubGateway) -> Result<DeviceAuthorization, AppError> {
    gateway.start_device_flow()
}

pub fn fetch_github_viewer(
    gateway: &dyn GithubGateway,
    token: &str,
) -> Result<GithubViewer, AppError> {
    gateway.fetch_viewer(token)
}

pub fn list_github_projects(
    gateway: &dyn GithubGateway,
    token: &str,
) -> Result<Vec<domain::GithubProjectSummary>, AppError> {
    gateway.list_projects(token)
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

        fn latest_session(&self, _project: &str) -> Result<Session, AppError> {
            Ok(Session {
                id: self.session_id.clone(),
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
    fn get_latest_session_orders_newest_first() {
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
            get_latest_session(&source, "some-project", 0, 10).expect("should get session");
        assert_eq!(session.id, "s1");
        let texts: Vec<&str> = session.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["second", "first"]);
    }

    #[test]
    fn get_latest_session_applies_offset_and_limit() {
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
        let session =
            get_latest_session(&source, "some-project", 1, 2).expect("should get session");
        let texts: Vec<&str> = session.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["c", "b"]);
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

    #[test]
    fn load_settings_returns_store_result_unchanged() {
        let mut settings = Settings::default();
        settings.selected_project_folders.push("proj1".to_string());
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
        let settings = Settings {
            github_project: Some(domain::GithubProject {
                owner: "".to_string(),
                number: 1,
            }),
            ..Settings::default()
        };

        let error = validate_settings(&settings).expect_err("should reject blank owner");
        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn update_settings_saves_valid_settings_and_returns_them() {
        let store = FakeSettingsStore::new(Settings::default());
        let input = Settings {
            repository_path: Some(PathBuf::from("/tmp/repo")),
            ..Settings::default()
        };

        let saved = update_settings(&store, input.clone()).expect("should update settings");
        assert_eq!(saved, input);
        assert_eq!(store.saved.borrow().as_slice(), [input]);
    }

    #[test]
    fn update_settings_rejects_invalid_settings_without_saving() {
        let store = FakeSettingsStore::new(Settings::default());
        let input = Settings {
            github_project: Some(domain::GithubProject {
                owner: "   ".to_string(),
                number: 1,
            }),
            ..Settings::default()
        };

        let error =
            update_settings(&store, input).expect_err("should reject invalid github project");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(store.saved.borrow().is_empty());
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

    struct FakeGithubGateway {
        device_authorization: DeviceAuthorization,
        poll_responses:
            std::cell::RefCell<std::collections::VecDeque<Result<PollResult, AppError>>>,
        viewer: GithubViewer,
        projects: Vec<domain::GithubProjectSummary>,
    }

    impl FakeGithubGateway {
        fn new(authorization: DeviceAuthorization) -> Self {
            Self {
                device_authorization: authorization,
                poll_responses: std::cell::RefCell::new(std::collections::VecDeque::new()),
                viewer: GithubViewer {
                    login: "yanqirenshi".to_string(),
                },
                projects: Vec::new(),
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
            Ok(self.viewer.clone())
        }

        fn list_projects(
            &self,
            _token: &str,
        ) -> Result<Vec<domain::GithubProjectSummary>, AppError> {
            Ok(self.projects.clone())
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
}
