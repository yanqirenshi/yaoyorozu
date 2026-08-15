use domain::{
    order_messages_newest_first, paginate_messages, sort_projects_by_recency, Project, Session,
};

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

pub trait ProjectRepository {
    fn list_projects(&self) -> Result<Vec<Project>, AppError>;
}

pub trait SessionRepository {
    /// 最新セッション(ID + 全メッセージ)を返す。
    fn latest_session(&self, project: &str) -> Result<Session, AppError>;

    /// 最新セッションのIDだけを返す(送信前後の一致検証用の軽量な問い合わせ)。
    fn latest_session_id(&self, project: &str) -> Result<String, AppError>;

    /// 指定プロジェクトの最新セッションを継続し、AI にメッセージを送る。
    /// ツール実行は行わせず、応答は既存セッションの JSONL に追記される想定。
    fn send_message(&self, project: &str, text: &str) -> Result<(), AppError>;
}

pub fn list_projects(repo: &dyn ProjectRepository) -> Result<Vec<Project>, AppError> {
    let mut projects = repo.list_projects()?;
    sort_projects_by_recency(&mut projects);
    Ok(projects)
}

/// 最新セッションのメッセージを新しい順に並べ、`offset`/`limit` で指定された
/// 範囲だけを返す(1回のIPCで会話全件を返さないため)。
pub fn get_latest_session(
    repo: &dyn SessionRepository,
    project: &str,
    offset: usize,
    limit: usize,
) -> Result<Session, AppError> {
    let mut session = repo.latest_session(project)?;
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
    repo: &dyn SessionRepository,
    project: &str,
    expected_session_id: &str,
    text: &str,
) -> Result<(), AppError> {
    if text.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "メッセージを入力してください".to_string(),
        ));
    }

    let actual_session_id = repo.latest_session_id(project)?;
    if actual_session_id != expected_session_id {
        return Err(AppError::SessionStale(format!(
            "表示中のセッションが最新ではありません(表示中: {expected_session_id}, 最新: {actual_session_id})"
        )));
    }

    repo.send_message(project, text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{Message, Role};

    struct FakeProjectRepository {
        projects: Vec<Project>,
    }

    impl ProjectRepository for FakeProjectRepository {
        fn list_projects(&self) -> Result<Vec<Project>, AppError> {
            Ok(self.projects.clone())
        }
    }

    struct FailingProjectRepository;

    impl ProjectRepository for FailingProjectRepository {
        fn list_projects(&self) -> Result<Vec<Project>, AppError> {
            Err(AppError::Io("boom".to_string()))
        }
    }

    struct FakeSessionRepository {
        session_id: String,
        messages: Vec<Message>,
        sent: std::cell::RefCell<Vec<String>>,
    }

    impl FakeSessionRepository {
        fn new(session_id: &str, messages: Vec<Message>) -> Self {
            Self {
                session_id: session_id.to_string(),
                messages,
                sent: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl SessionRepository for FakeSessionRepository {
        fn latest_session(&self, _project: &str) -> Result<Session, AppError> {
            Ok(Session {
                id: self.session_id.clone(),
                messages: self.messages.clone(),
            })
        }

        fn latest_session_id(&self, _project: &str) -> Result<String, AppError> {
            Ok(self.session_id.clone())
        }

        fn send_message(&self, _project: &str, text: &str) -> Result<(), AppError> {
            self.sent.borrow_mut().push(text.to_string());
            Ok(())
        }
    }

    #[test]
    fn list_projects_sorts_by_recency() {
        let repo = FakeProjectRepository {
            projects: vec![
                Project {
                    name: "old".to_string(),
                    updated_at_ms: 1,
                },
                Project {
                    name: "new".to_string(),
                    updated_at_ms: 2,
                },
            ],
        };

        let projects = list_projects(&repo).expect("should list projects");
        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["new", "old"]);
    }

    #[test]
    fn list_projects_propagates_repository_error() {
        let repo = FailingProjectRepository;
        let error = list_projects(&repo).expect_err("should propagate error");
        assert!(matches!(error, AppError::Io(message) if message == "boom"));
    }

    #[test]
    fn get_latest_session_orders_newest_first() {
        let repo = FakeSessionRepository::new(
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

        let session = get_latest_session(&repo, "some-project", 0, 10).expect("should get session");
        assert_eq!(session.id, "s1");
        let texts: Vec<&str> = session.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["second", "first"]);
    }

    #[test]
    fn get_latest_session_applies_offset_and_limit() {
        let repo = FakeSessionRepository::new(
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
        let session = get_latest_session(&repo, "some-project", 1, 2).expect("should get session");
        let texts: Vec<&str> = session.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["c", "b"]);
    }

    #[test]
    fn send_message_delegates_to_repository_when_session_matches() {
        let repo = FakeSessionRepository::new("s1", vec![]);
        send_message(&repo, "some-project", "s1", "hello").expect("should send message");
        assert_eq!(repo.sent.borrow().as_slice(), ["hello"]);
    }

    #[test]
    fn send_message_rejects_blank_text() {
        let repo = FakeSessionRepository::new("s1", vec![]);
        let error = send_message(&repo, "some-project", "s1", "   ").expect_err("should reject");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(repo.sent.borrow().is_empty());
    }

    #[test]
    fn send_message_rejects_stale_session_without_sending() {
        let repo = FakeSessionRepository::new("latest-id", vec![]);
        let error = send_message(&repo, "some-project", "displayed-id", "hello")
            .expect_err("should reject stale session");
        assert!(matches!(error, AppError::SessionStale(_)));
        assert!(
            repo.sent.borrow().is_empty(),
            "must not send when session is stale"
        );
    }
}
