use domain::{sort_projects_by_recency, Message, Project};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Io(String),
}

pub trait ProjectRepository {
    fn list_projects(&self) -> Result<Vec<Project>, AppError>;
}

pub trait SessionRepository {
    fn latest_session_messages(&self, project: &str) -> Result<Vec<Message>, AppError>;
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
    repo.latest_session_messages(project)
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
    }

    impl SessionRepository for FakeSessionRepository {
        fn latest_session_messages(&self, _project: &str) -> Result<Vec<Message>, AppError> {
            Ok(self.messages.clone())
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
    fn get_latest_session_delegates_to_repository() {
        let repo = FakeSessionRepository {
            messages: vec![Message {
                role: Role::User,
                text: "hi".to_string(),
                timestamp: "".to_string(),
            }],
        };

        let messages = get_latest_session(&repo, "some-project").expect("should get messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].text, "hi");
    }
}
