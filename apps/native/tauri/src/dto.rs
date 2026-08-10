use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ProjectDto {
    pub name: String,
    pub updated_at: u64,
}

impl From<domain::Project> for ProjectDto {
    fn from(project: domain::Project) -> Self {
        Self {
            name: project.name,
            updated_at: project.updated_at_ms,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum RoleDto {
    User,
    Assistant,
}

impl From<domain::Role> for RoleDto {
    fn from(role: domain::Role) -> Self {
        match role {
            domain::Role::User => RoleDto::User,
            domain::Role::Assistant => RoleDto::Assistant,
        }
    }
}

#[derive(Serialize, Clone)]
pub struct MessageDto {
    pub role: RoleDto,
    pub text: String,
    pub timestamp: String,
}

impl From<domain::Message> for MessageDto {
    fn from(message: domain::Message) -> Self {
        Self {
            role: message.role.into(),
            text: message.text,
            timestamp: message.timestamp,
        }
    }
}

#[derive(Serialize, Clone)]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
}

impl From<app::AppError> for AppErrorDto {
    fn from(error: app::AppError) -> Self {
        match error {
            app::AppError::NotFound(message) => Self {
                code: "not_found".to_string(),
                message,
            },
            app::AppError::Io(message) => Self {
                code: "io_error".to_string(),
                message,
            },
            app::AppError::InvalidInput(message) => Self {
                code: "invalid_input".to_string(),
                message,
            },
        }
    }
}
