use app::{AppError, SkillsStore};
use domain::SkillSummary;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const SKILL_MD_FILE_NAME: &str = "SKILL.md";

/// `<repo_dir>/.claude/skills/<name>/SKILL.md` を読み取り専用で扱う
/// (issue #65)。一覧の単位は `SKILL.md` を持つディレクトリ名。
pub struct FileSkillsStore;

impl FileSkillsStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FileSkillsStore {
    fn default() -> Self {
        Self::new()
    }
}

fn skills_dir(repo_dir: &Path) -> PathBuf {
    repo_dir.join(".claude").join("skills")
}

fn skill_md_path(repo_dir: &Path, name: &str) -> PathBuf {
    skills_dir(repo_dir).join(name).join(SKILL_MD_FILE_NAME)
}

impl SkillsStore for FileSkillsStore {
    fn list(&self, repo_dir: &Path) -> Result<Vec<SkillSummary>, AppError> {
        let dir = skills_dir(repo_dir);
        if !dir.is_dir() {
            return Ok(Vec::new());
        }

        let entries = fs::read_dir(&dir)
            .map_err(|e| AppError::Io(format!("{} を読み込めませんでした: {e}", dir.display())))?;

        let mut summaries: Vec<SkillSummary> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter_map(|entry| {
                let name = entry.file_name().to_str()?.to_string();
                let skill_md = entry.path().join(SKILL_MD_FILE_NAME);
                let modified_at_ms = fs::metadata(&skill_md)
                    .ok()
                    .filter(|m| m.is_file())?
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                Some(SkillSummary {
                    name,
                    modified_at_ms,
                })
            })
            .collect();
        summaries.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(summaries)
    }

    /// `name` は呼び出し側(`app::get_skill`)で検証済みの前提でそのまま
    /// 結合する(issue #65)。
    fn read(&self, repo_dir: &Path, name: &str) -> Result<String, AppError> {
        let path = skill_md_path(repo_dir, name);
        fs::read_to_string(&path)
            .map_err(|_| AppError::NotFound(format!("スキル {name} が見つかりません")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(dir: &Path, name: &str, content: &str) {
        let skill_dir = dir.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join(SKILL_MD_FILE_NAME), content).unwrap();
    }

    #[test]
    fn list_returns_empty_when_skills_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileSkillsStore::new();

        let result = store.list(dir.path()).expect("should list");
        assert!(result.is_empty());
    }

    #[test]
    fn list_returns_empty_when_skills_dir_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(skills_dir(dir.path())).unwrap();
        let store = FileSkillsStore::new();

        let result = store.list(dir.path()).expect("should list");
        assert!(result.is_empty());
    }

    #[test]
    fn list_returns_only_directories_with_skill_md_sorted_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let skills = skills_dir(dir.path());
        fs::create_dir_all(&skills).unwrap();
        write_skill(&skills, "release", "# release skill");
        write_skill(&skills, "code-review", "# code review skill");
        // SKILL.md を持たないディレクトリは一覧に出さない。
        fs::create_dir_all(skills.join("empty-dir")).unwrap();
        let store = FileSkillsStore::new();

        let result = store.list(dir.path()).expect("should list");

        let names: Vec<&str> = result.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["code-review", "release"]);
        assert!(result.iter().all(|s| s.modified_at_ms > 0));
    }

    #[test]
    fn read_returns_content_of_existing_skill_md() {
        let dir = tempfile::tempdir().unwrap();
        let skills = skills_dir(dir.path());
        fs::create_dir_all(&skills).unwrap();
        write_skill(&skills, "release", "# release skill");
        let store = FileSkillsStore::new();

        let content = store.read(dir.path(), "release").expect("should read");
        assert_eq!(content, "# release skill");
    }

    #[test]
    fn read_returns_not_found_when_skill_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileSkillsStore::new();

        let error = store.read(dir.path(), "missing").expect_err("should fail");
        assert!(matches!(error, AppError::NotFound(_)));
    }
}
