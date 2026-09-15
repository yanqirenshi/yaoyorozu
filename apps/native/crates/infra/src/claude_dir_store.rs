use app::{AppError, ClaudeDirStore};
use domain::{join_claude_dir_path, ClaudeDirEntry, ClaudeDirEntryKind};
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

/// `~/.claude` を解決する。ホームディレクトリの解決は
/// `FileSystemRepository::default_projects_dir` と同じ流儀
/// (`USERPROFILE`/`HOME`)。
pub fn claude_home_dir() -> Result<PathBuf, AppError> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| AppError::Io("ホームディレクトリが見つかりません".to_string()))?;
    Ok(home.join(".claude"))
}

/// `root`(本番では `~/.claude`)配下のディレクトリを一覧する(読み取り
/// 専用。/claude 画面のExplorerタブ)。ルートを注入できるようにしているのは、
/// テストで一時ディレクトリを使うため(native.md §5: 実ユーザーディレクトリを
/// 触らない)。
pub struct FileClaudeDirStore {
    root: PathBuf,
}

impl FileClaudeDirStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl ClaudeDirStore for FileClaudeDirStore {
    /// `relative_path` の形式(`..` 等を含まないこと)は呼び出し側
    /// (`app::list_claude_dir`)で検証済みの前提。そのうえで、途中の
    /// シンボリックリンク/ジャンクション経由で `root` の外へ出ていないかを
    /// 実パスで確かめる(多層防御。native.md §4)。
    fn list(&self, relative_path: &str) -> Result<Vec<ClaudeDirEntry>, AppError> {
        let root = fs::canonicalize(&self.root)
            .map_err(|_| AppError::NotFound(format!("{} が見つかりません", self.root.display())))?;
        let mut dir = root.clone();
        dir.extend(
            relative_path
                .split('/')
                .filter(|segment| !segment.is_empty()),
        );
        let dir = fs::canonicalize(&dir)
            .map_err(|_| AppError::NotFound(format!("{relative_path} が見つかりません")))?;
        if !dir.starts_with(&root) {
            return Err(AppError::InvalidInput(
                "~/.claude の外は表示できません".to_string(),
            ));
        }
        if !dir.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "{relative_path} はディレクトリではありません"
            )));
        }

        let entries = fs::read_dir(&dir)
            .map_err(|e| AppError::Io(format!("{} を読み込めませんでした: {e}", dir.display())))?;

        Ok(entries
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                // 名前がUTF-8として解釈できないエントリは、相対パスとして
                // フロントと往復できないため一覧に出さない。
                let name = entry.file_name().to_str()?.to_string();
                // `DirEntry::file_type`/`metadata` はリンクを辿らない。
                let file_type = entry.file_type().ok()?;
                let kind = if file_type.is_symlink() {
                    ClaudeDirEntryKind::Symlink
                } else if file_type.is_dir() {
                    ClaudeDirEntryKind::Directory
                } else {
                    ClaudeDirEntryKind::File
                };
                let metadata = entry.metadata().ok();
                let size_bytes = match kind {
                    ClaudeDirEntryKind::File => metadata.as_ref().map(|m| m.len()),
                    _ => None,
                };
                let modified_at_ms = metadata
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                Some(ClaudeDirEntry {
                    path: join_claude_dir_path(relative_path, &name),
                    name,
                    kind,
                    size_bytes,
                    modified_at_ms,
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted_names(entries: &[ClaudeDirEntry]) -> Vec<&str> {
        let mut names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        names.sort();
        names
    }

    #[test]
    fn list_root_returns_files_and_directories_with_kind_and_size() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("projects")).unwrap();
        fs::write(dir.path().join("settings.json"), "{}").unwrap();
        let store = FileClaudeDirStore::new(dir.path().to_path_buf());

        let entries = store.list("").expect("should list");

        assert_eq!(sorted_names(&entries), vec!["projects", "settings.json"]);
        let projects = entries.iter().find(|e| e.name == "projects").unwrap();
        assert_eq!(projects.kind, ClaudeDirEntryKind::Directory);
        assert_eq!(projects.path, "projects");
        assert_eq!(projects.size_bytes, None);
        let settings = entries.iter().find(|e| e.name == "settings.json").unwrap();
        assert_eq!(settings.kind, ClaudeDirEntryKind::File);
        assert_eq!(settings.size_bytes, Some(2));
        assert!(settings.modified_at_ms > 0);
    }

    #[test]
    fn list_nested_directory_returns_paths_relative_to_root() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("projects").join("foo");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("a.jsonl"), "").unwrap();
        let store = FileClaudeDirStore::new(dir.path().to_path_buf());

        let entries = store.list("projects/foo").expect("should list");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "projects/foo/a.jsonl");
    }

    #[test]
    fn list_returns_empty_for_empty_directory() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeDirStore::new(dir.path().to_path_buf());

        let entries = store.list("").expect("should list");
        assert!(entries.is_empty());
    }

    #[test]
    fn list_returns_not_found_for_missing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeDirStore::new(dir.path().to_path_buf());

        let error = store.list("missing").expect_err("should fail");
        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn list_returns_not_found_when_root_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeDirStore::new(dir.path().join("missing"));

        let error = store.list("").expect_err("should fail");
        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn list_rejects_file_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{}").unwrap();
        let store = FileClaudeDirStore::new(dir.path().to_path_buf());

        let error = store.list("settings.json").expect_err("should fail");
        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[cfg(unix)]
    #[test]
    fn list_does_not_follow_symlink_escaping_root() {
        let outside = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        let store = FileClaudeDirStore::new(dir.path().to_path_buf());

        // 一覧にはリンクとして(辿らずに)出る。
        let entries = store.list("").expect("should list");
        assert_eq!(entries[0].kind, ClaudeDirEntryKind::Symlink);

        // リンク経由で root の外を一覧しようとすると弾く。
        let error = store.list("link").expect_err("should fail");
        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
