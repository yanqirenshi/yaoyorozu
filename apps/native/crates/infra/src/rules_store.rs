use app::{AppError, RulesStore};
use domain::RuleSummary;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// `<repo_dir>/.claude/rules/*.md` を読み取り専用で扱う(issue #61)。
pub struct FileRulesStore;

impl FileRulesStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FileRulesStore {
    fn default() -> Self {
        Self::new()
    }
}

fn rules_dir(repo_dir: &Path) -> PathBuf {
    repo_dir.join(".claude").join("rules")
}

impl RulesStore for FileRulesStore {
    fn list(&self, repo_dir: &Path) -> Result<Vec<RuleSummary>, AppError> {
        let dir = rules_dir(repo_dir);
        if !dir.is_dir() {
            return Ok(Vec::new());
        }

        let entries = fs::read_dir(&dir)
            .map_err(|e| AppError::Io(format!("{} を読み込めませんでした: {e}", dir.display())))?;

        let mut summaries: Vec<RuleSummary> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter(|entry| entry.path().extension().and_then(|e| e.to_str()) == Some("md"))
            .filter_map(|entry| {
                let file_name = entry.file_name().to_str()?.to_string();
                let modified_at_ms = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                Some(RuleSummary {
                    file_name,
                    modified_at_ms,
                })
            })
            .collect();
        summaries.sort_by(|a, b| a.file_name.cmp(&b.file_name));

        Ok(summaries)
    }

    /// `file_name` は呼び出し側(`app::get_rule`)で検証済みの前提で
    /// そのまま結合する(issue #61)。
    fn read(&self, repo_dir: &Path, file_name: &str) -> Result<String, AppError> {
        let path = rules_dir(repo_dir).join(file_name);
        fs::read_to_string(&path)
            .map_err(|_| AppError::NotFound(format!("{file_name} が見つかりません")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(dir: &Path, name: &str, content: &str) {
        fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn list_returns_empty_when_rules_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileRulesStore::new();

        let result = store.list(dir.path()).expect("should list");
        assert!(result.is_empty());
    }

    #[test]
    fn list_returns_empty_when_rules_dir_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(rules_dir(dir.path())).unwrap();
        let store = FileRulesStore::new();

        let result = store.list(dir.path()).expect("should list");
        assert!(result.is_empty());
    }

    #[test]
    fn list_returns_md_files_sorted_by_name_and_skips_non_md() {
        let dir = tempfile::tempdir().unwrap();
        let rules = rules_dir(dir.path());
        fs::create_dir_all(&rules).unwrap();
        write_file(&rules, "web.md", "# web");
        write_file(&rules, "native.md", "# native");
        write_file(&rules, "notes.txt", "ignored");
        let store = FileRulesStore::new();

        let result = store.list(dir.path()).expect("should list");

        let names: Vec<&str> = result.iter().map(|r| r.file_name.as_str()).collect();
        assert_eq!(names, vec!["native.md", "web.md"]);
        assert!(result.iter().all(|r| r.modified_at_ms > 0));
    }

    #[test]
    fn read_returns_content_of_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let rules = rules_dir(dir.path());
        fs::create_dir_all(&rules).unwrap();
        write_file(&rules, "native.md", "# native rules");
        let store = FileRulesStore::new();

        let content = store.read(dir.path(), "native.md").expect("should read");
        assert_eq!(content, "# native rules");
    }

    #[test]
    fn read_returns_not_found_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileRulesStore::new();

        let error = store
            .read(dir.path(), "missing.md")
            .expect_err("should fail");
        assert!(matches!(error, AppError::NotFound(_)));
    }
}
