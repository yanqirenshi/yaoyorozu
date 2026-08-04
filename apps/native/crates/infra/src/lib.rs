use app::{AppError, ProjectRepository, SessionRepository};
use domain::{extract_message, Message, Project};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub struct FileSystemRepository {
    projects_dir: PathBuf,
}

impl FileSystemRepository {
    pub fn new(projects_dir: PathBuf) -> Self {
        Self { projects_dir }
    }

    pub fn from_home_dir() -> Result<Self, AppError> {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map(PathBuf::from)
            .map_err(|_| AppError::Io("ホームディレクトリが見つかりません".to_string()))?;
        Ok(Self::new(home.join(".claude").join("projects")))
    }
}

fn to_millis(time: std::io::Result<std::time::SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// ディレクトリ直下(サブディレクトリは見ない)の *.jsonl のうち、
/// 最終更新が最も新しいものを返す。
fn latest_session_file(project_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(project_dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .max_by_key(|path| to_millis(fs::metadata(path).and_then(|m| m.modified())))
}

impl ProjectRepository for FileSystemRepository {
    fn list_projects(&self) -> Result<Vec<Project>, AppError> {
        let entries = fs::read_dir(&self.projects_dir).map_err(|e| {
            AppError::Io(format!(
                "{} の読み込みに失敗しました: {}",
                self.projects_dir.display(),
                e
            ))
        })?;

        let projects = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .filter_map(|path| {
                let name = path.file_name()?.to_str()?.to_string();
                let updated_at_ms = latest_session_file(&path)
                    .map(|f| to_millis(fs::metadata(&f).and_then(|m| m.modified())))
                    .unwrap_or_else(|| to_millis(fs::metadata(&path).and_then(|m| m.modified())));
                Some(Project {
                    name,
                    updated_at_ms,
                })
            })
            .collect();

        Ok(projects)
    }
}

impl SessionRepository for FileSystemRepository {
    fn latest_session_messages(&self, project: &str) -> Result<Vec<Message>, AppError> {
        let project_dir = self.projects_dir.join(project);
        let path = latest_session_file(&project_dir)
            .ok_or_else(|| AppError::NotFound(format!("{project} にセッションが見つかりません")))?;
        let file = fs::File::open(&path)
            .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

        let messages = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
            .filter_map(|value| extract_message(&value))
            .collect();

        Ok(messages)
    }
}
