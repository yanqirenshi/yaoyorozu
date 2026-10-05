use app::{AppError, YyzScaffoldWriter};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// `yyz/` 一式をリポジトリ内に作る(issue #547)。書き込みは `FileClaudeMdStore` 等と
/// 同じ流儀でアトミックに行う(`*.tmp` へ書く → `fsync` → `rename`)が、ここでは
/// **既存ファイルへの書き込みを一切行わない**(`ensure_file` は存在確認が真なら
/// 即座に戻る。tmp ファイルすら作らない)。
pub struct FileYyzScaffoldWriter;

impl FileYyzScaffoldWriter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FileYyzScaffoldWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl YyzScaffoldWriter for FileYyzScaffoldWriter {
    fn file_exists(&self, repository_path: &Path, relative_path: &str) -> Result<bool, AppError> {
        Ok(repository_path.join(relative_path).is_file())
    }

    fn ensure_file(
        &self,
        repository_path: &Path,
        relative_path: &str,
        content: &str,
    ) -> Result<(), AppError> {
        let path = repository_path.join(relative_path);
        // 絶対に上書きしない(issue #547)。呼び出し側(app層)が事前に
        // `file_exists` で判断している想定だが、ここでも確かめる(呼び出し順に
        // 依存しない安全策)。
        if path.is_file() {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("{} を作成できませんでした: {e}", parent.display()))
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
    fn file_exists_reflects_the_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        let writer = FileYyzScaffoldWriter::new();

        assert!(!writer.file_exists(dir.path(), "yyz/README.md").unwrap());

        fs::create_dir_all(dir.path().join("yyz")).unwrap();
        fs::write(dir.path().join("yyz/README.md"), "x").unwrap();

        assert!(writer.file_exists(dir.path(), "yyz/README.md").unwrap());
    }

    #[test]
    fn ensure_file_creates_missing_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let writer = FileYyzScaffoldWriter::new();

        writer
            .ensure_file(dir.path(), "yyz/spec/wbs.json", "{}")
            .expect("should create");

        assert_eq!(
            fs::read_to_string(dir.path().join("yyz/spec/wbs.json")).unwrap(),
            "{}"
        );
    }

    #[test]
    fn ensure_file_never_overwrites_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("yyz")).unwrap();
        fs::write(dir.path().join("yyz/README.md"), "元の内容").unwrap();
        let writer = FileYyzScaffoldWriter::new();

        writer
            .ensure_file(
                dir.path(),
                "yyz/README.md",
                "新しい内容で上書きしようとする",
            )
            .expect("should succeed without writing");

        assert_eq!(
            fs::read_to_string(dir.path().join("yyz/README.md")).unwrap(),
            "元の内容"
        );
    }

    #[test]
    fn ensure_file_leaves_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let writer = FileYyzScaffoldWriter::new();

        writer
            .ensure_file(dir.path(), "yyz/README.md", "content")
            .expect("should create");

        assert!(dir.path().join("yyz/README.md").is_file());
        assert!(!dir.path().join("yyz/README.md.tmp").exists());
    }
}
