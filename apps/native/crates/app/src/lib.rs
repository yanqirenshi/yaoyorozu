use domain::{order_messages_newest_first, sort_projects_by_recency, Message, Project};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    InvalidInput(String),
}

pub trait ProjectRepository {
    fn list_projects(&self) -> Result<Vec<Project>, AppError>;
}

pub trait SessionRepository {
    fn latest_session_messages(&self, project: &str) -> Result<Vec<Message>, AppError>;

    /// 指定プロジェクトの最新セッションを resume し、AI にメッセージを送る。
    /// ツール実行は行わせず、応答は既存セッションの JSONL に追記される想定。
    fn send_message(&self, project: &str, text: &str) -> Result<(), AppError>;
}

pub fn list_projects(repo: &dyn ProjectRepository) -> Result<Vec<Project>, AppError> {
    let mut projects = repo.list_projects()?;
    sort_projects_by_recency(&mut projects);
    Ok(projects)
}

pub fn get_latest_session(
    repo: &dyn SessionRepository,
    project: &str,
) -> Result<Vec<Message>, AppError> {
    let mut messages = repo.latest_session_messages(project)?;
    order_messages_newest_first(&mut messages);
    Ok(messages)
}

pub fn send_message(
    repo: &dyn SessionRepository,
    project: &str,
    text: &str,
) -> Result<(), AppError> {
    if text.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "メッセージを入力してください".to_string(),
        ));
    }
    repo.send_message(project, text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::Role;

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
        messages: Vec<Message>,
        sent: std::cell::RefCell<Vec<String>>,
    }

    impl FakeSessionRepository {
        fn new(messages: Vec<Message>) -> Self {
            Self {
                messages,
                sent: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl SessionRepository for FakeSessionRepository {
        fn latest_session_messages(&self, _project: &str) -> Result<Vec<Message>, AppError> {
            Ok(self.messages.clone())
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
        let repo = FakeSessionRepository::new(vec![
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
        ]);

        let messages = get_latest_session(&repo, "some-project").expect("should get messages");
        let texts: Vec<&str> = messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["second", "first"]);
    }

    #[test]
    fn send_message_delegates_to_repository() {
        let repo = FakeSessionRepository::new(vec![]);
        send_message(&repo, "some-project", "hello").expect("should send message");
        assert_eq!(repo.sent.borrow().as_slice(), ["hello"]);
    }

    #[test]
    fn send_message_rejects_blank_text() {
        let repo = FakeSessionRepository::new(vec![]);
        let error = send_message(&repo, "some-project", "   ").expect_err("should reject");
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(repo.sent.borrow().is_empty());
    }
}
