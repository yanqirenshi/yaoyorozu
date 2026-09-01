use app::{AppError, ClaudeSettingsStore};
use domain::ClaudeSettingsFile;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const SETTINGS_FILE_NAME: &str = "settings.json";

/// `~/.claude/settings.json` のパスを解決する(issue #53)。ホーム
/// ディレクトリの解決は `session_source::default_projects_dir` と同じ流儀
/// (`USERPROFILE`/`HOME`)。このアプリの対象は `settings.json` のみに限定し、
/// `.credentials.json` 等 `~/.claude` 配下の他ファイルへのアクセス経路は
/// 作らない(セキュリティ上、ファイルごとに専用の解決関数を用意する)。
fn resolve_settings_path() -> Result<PathBuf, AppError> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| AppError::Io("ホームディレクトリが見つかりません".to_string()))?;
    Ok(home.join(".claude").join(SETTINGS_FILE_NAME))
}

/// `~/.claude/settings.json` を読み書きする。書き込みは `FileClaudeMdStore`
/// と同じ流儀でアトミックに行う(`*.tmp` へ書く → `fsync` → `rename`)。
pub struct FileClaudeSettingsStore;

impl FileClaudeSettingsStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FileClaudeSettingsStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeSettingsStore for FileClaudeSettingsStore {
    fn read(&self) -> Result<Option<ClaudeSettingsFile>, AppError> {
        let path = resolve_settings_path()?;
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

    fn write(&self, content: &str) -> Result<(), AppError> {
        let path = resolve_settings_path()?;
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
    use std::sync::Mutex;

    // `resolve_settings_path` は環境変数 USERPROFILE/HOME を直接読むため、
    // テスト間で環境変数を書き換える箇所が並行実行で競合しないよう
    // 排他する(std::env::set_var はプロセス全体に効くグローバル状態のため)。
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_home_dir<T>(home: &std::path::Path, f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap();
        let original = std::env::var("USERPROFILE").ok();
        std::env::set_var("USERPROFILE", home);
        let result = f();
        match original {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
        result
    }

    #[test]
    fn read_returns_none_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeSettingsStore::new();

        let result = with_home_dir(dir.path(), || store.read()).expect("should read");
        assert_eq!(result, None);
    }

    #[test]
    fn write_then_read_roundtrips_content() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeSettingsStore::new();

        with_home_dir(dir.path(), || {
            store.write(r#"{"a":1}"#).expect("should write");
            let result = store.read().expect("should read").unwrap();
            assert_eq!(result.content, r#"{"a":1}"#);
            assert!(result.modified_at_ms > 0);
        });
    }

    #[test]
    fn write_overwrites_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeSettingsStore::new();

        with_home_dir(dir.path(), || {
            store.write("{}").expect("should write");
            store.write(r#"{"a":1}"#).expect("should overwrite");
            let result = store.read().expect("should read").unwrap();
            assert_eq!(result.content, r#"{"a":1}"#);
        });
    }

    #[test]
    fn write_leaves_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeSettingsStore::new();

        with_home_dir(dir.path(), || {
            store.write("{}").expect("should write");
        });

        let claude_dir = dir.path().join(".claude");
        assert!(claude_dir.join(SETTINGS_FILE_NAME).is_file());
        assert!(!claude_dir
            .join(format!("{SETTINGS_FILE_NAME}.tmp"))
            .exists());
    }

    #[test]
    fn write_creates_claude_dir_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileClaudeSettingsStore::new();

        with_home_dir(dir.path(), || {
            store.write("{}").expect("should write");
        });

        assert!(dir.path().join(".claude").is_dir());
    }
}
