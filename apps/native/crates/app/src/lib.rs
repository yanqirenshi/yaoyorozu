use domain::{
    order_messages_newest_first, paginate_messages, sort_projects_by_recency, Project, Session,
};
use std::path::PathBuf;

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

/// エージェントへのメッセージ送信(port)。将来 Gemini / Codex 等の別アダプタを
/// 追加する際、この抽象だけを実装すればよく `app` / `domain` の変更は不要。
pub trait AgentGateway {
    fn send(&self, req: SendRequest) -> Result<(), AppError>;
}

/// 送信時に許可する権限モード。現時点ではツール実行を伴わない会話のみ。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentMode {
    Chat,
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
pub fn send_message(
    source: &dyn SessionSource,
    agent: &dyn AgentGateway,
    project: &str,
    expected_session_id: &str,
    text: &str,
) -> Result<(), AppError> {
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
        mode: AgentMode::Chat,
        continuation: Continuation::Continue,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{AgentKind, Message, Role};

    struct FakeSessionSource {
        projects: Vec<Project>,
        session_id: String,
        messages: Vec<Message>,
        cwd: PathBuf,
        fail_list_projects: bool,
    }

    impl FakeSessionSource {
        fn new(session_id: &str, messages: Vec<Message>) -> Self {
            Self {
                projects: Vec::new(),
                session_id: session_id.to_string(),
                messages,
                cwd: PathBuf::from("/tmp/some-project"),
                fail_list_projects: false,
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
            Ok(self.session_id.clone())
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
        send_message(&source, &agent, "some-project", "s1", "hello").expect("should send message");

        let sent = agent.sent.borrow();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].text, "hello");
        assert_eq!(sent[0].cwd, source.cwd);
        assert_eq!(sent[0].mode, AgentMode::Chat);
        assert_eq!(sent[0].continuation, Continuation::Continue);
    }

    #[test]
    fn send_message_rejects_blank_text() {
        let source = FakeSessionSource::new("s1", vec![]);
        let agent = FakeAgentGateway::default();
        let error =
            send_message(&source, &agent, "some-project", "s1", "   ").expect_err("should reject");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(agent.sent.borrow().is_empty());
    }

    #[test]
    fn send_message_rejects_stale_session_without_sending() {
        let source = FakeSessionSource::new("latest-id", vec![]);
        let agent = FakeAgentGateway::default();
        let error = send_message(&source, &agent, "some-project", "displayed-id", "hello")
            .expect_err("should reject stale session");
        assert!(matches!(error, AppError::SessionStale(_)));
        assert!(
            agent.sent.borrow().is_empty(),
            "must not send when session is stale"
        );
    }
}
