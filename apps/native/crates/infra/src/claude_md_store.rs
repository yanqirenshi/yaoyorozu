use app::{AppError, ClaudeMdStore};
use domain::ClaudeMdFile;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const CLAUDE_MD_FILE_NAME: &str = "CLAUDE.md";

/// `<repo_dir>/CLAUDE.md` を読み書きする。書き込みは `FileSettingsStore` と
/// 同じ流儀でアトミックに行う(`*.tmp` へ書く → `fsync` → `rename`)。
pub struct FileClaudeMdStore;

impl FileClaudeMdStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FileClaudeMdStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeMdStore for FileClaudeMdStore {
    fn read(&self, repo_dir: &Path) -> Result<Option<ClaudeMdFile>, AppError> {
        let path = repo_dir.join(CLAUDE_MD_FILE_NAME);
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

        Ok(Some(ClaudeMdFile {
            content,
            modified_at_ms,
        }))
    }

    fn write(&self, repo_dir: &Path, content: &str) -> Result<(), AppError> {
        let path = repo_dir.join(CLAUDE_MD_FILE_NAME);
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
        let store = FileClaudeMdStore::new();

        let result = store.read(dir.path()).expect("should read");
        assert_eq!(result, None);
    }

    #[test]
    fn write_then_read_roundtrips_content() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeMdStore::new();

        store.write(dir.path(), "# hello").expect("should write");
        let result = store.read(dir.path()).expect("should read").unwrap();

        assert_eq!(result.content, "# hello");
        assert!(result.modified_at_ms > 0);
    }

    #[test]
    fn write_overwrites_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeMdStore::new();

        store.write(dir.path(), "old").expect("should write");
        store.write(dir.path(), "new").expect("should overwrite");
        let result = store.read(dir.path()).expect("should read").unwrap();

        assert_eq!(result.content, "new");
    }

    #[test]
    fn write_leaves_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeMdStore::new();

        store.write(dir.path(), "content").expect("should write");

        assert!(dir.path().join(CLAUDE_MD_FILE_NAME).is_file());
        assert!(!dir
            .path()
            .join(format!("{CLAUDE_MD_FILE_NAME}.tmp"))
            .exists());
    }
}
