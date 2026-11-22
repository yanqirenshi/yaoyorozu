use app::{AppError, ProjectSettingsFile, ProjectSettingsStore};
use domain::ClaudeSettingsFile;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// プロジェクトの `<repo_dir>/.claude/settings.json` /
/// `settings.local.json` を読み書きする(issue #70)。書き込みは
/// `FileClaudeSettingsStore`(ユーザーレベル)と同じ流儀でアトミックに行う
/// (`*.tmp` へ書く → `fsync` → `rename`)。
pub struct FileProjectSettingsStore;

impl FileProjectSettingsStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FileProjectSettingsStore {
    fn default() -> Self {
        Self::new()
    }
}

fn settings_path(repo_dir: &Path, which: ProjectSettingsFile) -> PathBuf {
    let file_name = match which {
        ProjectSettingsFile::Settings => "settings.json",
        ProjectSettingsFile::SettingsLocal => "settings.local.json",
    };
    repo_dir.join(".claude").join(file_name)
}

impl ProjectSettingsStore for FileProjectSettingsStore {
    fn read(
        &self,
        repo_dir: &Path,
        which: ProjectSettingsFile,
    ) -> Result<Option<ClaudeSettingsFile>, AppError> {
        let path = settings_path(repo_dir, which);
        if !path.is_file() {
            return Ok(None);
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::Io(format!("{} を読み込めませんでした: {e}", path.display())))?;
        let modified_at_ms = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Ok(Some(ClaudeSettingsFile {
            content,
            modified_at_ms,
        }))
    }

    fn write(
        &self,
        repo_dir: &Path,
        which: ProjectSettingsFile,
        content: &str,
    ) -> Result<(), AppError> {
        let path = settings_path(repo_dir, which);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("{} の作成に失敗しました: {e}", parent.display()))
            })?;
        }
        let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));

        let mut file = fs::File::create(&tmp_path).map_err(|e| {
            AppError::Io(format!("{} の作成に失敗しました: {e}", tmp_path.display()))
        })?;
        file.write_all(content.as_bytes()).map_err(|e| {
            AppError::Io(format!(
                "{} への書き込みに失敗しました: {e}",
                tmp_path.display()
            ))
        })?;
        file.sync_all().map_err(|e| {
            AppError::Io(format!("{} の同期に失敗しました: {e}", tmp_path.display()))
        })?;
        fs::rename(&tmp_path, &path)
            .map_err(|e| AppError::Io(format!("{} への置換に失敗しました: {e}", path.display())))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_returns_none_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileProjectSettingsStore::new();

        let result = store
            .read(dir.path(), ProjectSettingsFile::Settings)
            .expect("should read");
        assert_eq!(result, None);
    }

    #[test]
    fn write_then_read_roundtrips_content() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileProjectSettingsStore::new();

        store
            .write(dir.path(), ProjectSettingsFile::Settings, r#"{"a":1}"#)
            .expect("should write");
        let result = store
            .read(dir.path(), ProjectSettingsFile::Settings)
            .expect("should read")
            .unwrap();

        assert_eq!(result.content, r#"{"a":1}"#);
        assert!(result.modified_at_ms > 0);
    }

    #[test]
    fn write_overwrites_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileProjectSettingsStore::new();

        store
            .write(dir.path(), ProjectSettingsFile::Settings, "{}")
            .expect("should write");
        store
            .write(dir.path(), ProjectSettingsFile::Settings, r#"{"a":1}"#)
            .expect("should overwrite");
        let result = store
            .read(dir.path(), ProjectSettingsFile::Settings)
            .expect("should read")
            .unwrap();

        assert_eq!(result.content, r#"{"a":1}"#);
    }

    #[test]
    fn write_leaves_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileProjectSettingsStore::new();

        store
            .write(dir.path(), ProjectSettingsFile::Settings, "{}")
            .expect("should write");

        let claude_dir = dir.path().join(".claude");
        assert!(claude_dir.join("settings.json").is_file());
        assert!(!claude_dir.join("settings.json.tmp").exists());
    }

    #[test]
    fn write_creates_claude_dir_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileProjectSettingsStore::new();

        store
            .write(dir.path(), ProjectSettingsFile::SettingsLocal, "{}")
            .expect("should write");

        assert!(dir.path().join(".claude").is_dir());
    }

    #[test]
    fn settings_and_settings_local_are_independent_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileProjectSettingsStore::new();

        store
            .write(dir.path(), ProjectSettingsFile::Settings, r#"{"a":1}"#)
            .expect("should write settings");
        store
            .write(dir.path(), ProjectSettingsFile::SettingsLocal, r#"{"b":2}"#)
            .expect("should write settings.local");

        let settings = store
            .read(dir.path(), ProjectSettingsFile::Settings)
            .expect("should read")
            .unwrap();
        let settings_local = store
            .read(dir.path(), ProjectSettingsFile::SettingsLocal)
            .expect("should read")
            .unwrap();

        assert_eq!(settings.content, r#"{"a":1}"#);
        assert_eq!(settings_local.content, r#"{"b":2}"#);
    }
}
