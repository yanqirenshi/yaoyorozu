use app::{AppError, ArchivedSessionsStore};
use domain::{ArchivedSessions, CURRENT_ARCHIVED_SESSIONS_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// アーカイブ済みのセッション ID の集合を、`app_data_dir/archived-sessions.json` として
/// 永続化する(issue #494)。`FileSettingsStore` と同じ流儀(native.md §2): 書き込みは
/// アトミック(`*.tmp` へ書く → fsync → rename)、読み込み失敗時はプロセスを落とさず空で始める
/// (壊れたファイルは `*.corrupt.<timestamp>` へ退避)。
pub struct FileArchivedSessionsStore {
    path: PathBuf,
}

impl FileArchivedSessionsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn evacuate_corrupt_file(&self) {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let file_name = self
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("archived-sessions.json");
        let corrupt_path = self
            .path
            .with_file_name(format!("{file_name}.corrupt.{millis}"));
        // 退避に失敗しても(パーミッション等)空での起動は継続する。
        let _ = fs::rename(&self.path, corrupt_path);
    }
}

impl ArchivedSessionsStore for FileArchivedSessionsStore {
    fn load(&self) -> Result<ArchivedSessions, AppError> {
        if !self.path.is_file() {
            return Ok(ArchivedSessions::default());
        }

        let Ok(content) = fs::read_to_string(&self.path) else {
            self.evacuate_corrupt_file();
            return Ok(ArchivedSessions::default());
        };

        let Ok(raw) = serde_json::from_str::<serde_json::Value>(&content) else {
            self.evacuate_corrupt_file();
            return Ok(ArchivedSessions::default());
        };

        // 未知のバージョン(将来のアプリが書いたファイルを古いアプリが読む場合など)は
        // 解釈できないため、破損扱いとして退避する。
        if raw.get("version").and_then(|v| v.as_u64())
            != Some(CURRENT_ARCHIVED_SESSIONS_VERSION as u64)
        {
            self.evacuate_corrupt_file();
            return Ok(ArchivedSessions::default());
        }

        let Ok(archived) = serde_json::from_value::<ArchivedSessions>(raw) else {
            self.evacuate_corrupt_file();
            return Ok(ArchivedSessions::default());
        };

        Ok(archived)
    }

    fn save(&self, sessions: &ArchivedSessions) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(sessions).map_err(|e| {
            AppError::Io(format!("アーカイブの印のシリアライズに失敗しました: {e}"))
        })?;

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("{} を作成できませんでした: {e}", parent.display()))
            })?;
        }

        let tmp_path = PathBuf::from(format!("{}.tmp", self.path.display()));
        let mut file = fs::File::create(&tmp_path).map_err(|e| {
            AppError::Io(format!("{} の作成に失敗しました: {e}", tmp_path.display()))
        })?;
        file.write_all(json.as_bytes()).map_err(|e| {
            AppError::Io(format!(
                "{} への書き込みに失敗しました: {e}",
                tmp_path.display()
            ))
        })?;
        file.sync_all().map_err(|e| {
            AppError::Io(format!("{} の同期に失敗しました: {e}", tmp_path.display()))
        })?;
        fs::rename(&tmp_path, &self.path).map_err(|e| {
            AppError::Io(format!(
                "{} への置換に失敗しました: {e}",
                self.path.display()
            ))
        })?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ArchivedSessions {
        ArchivedSessions {
            version: CURRENT_ARCHIVED_SESSIONS_VERSION,
            session_ids: vec!["s1".to_string(), "s2".to_string()],
        }
    }

    fn store(dir: &tempfile::TempDir) -> FileArchivedSessionsStore {
        FileArchivedSessionsStore::new(dir.path().join("archived-sessions.json"))
    }

    fn corrupt_files(dir: &tempfile::TempDir) -> usize {
        fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".corrupt."))
            .count()
    }

    #[test]
    fn load_returns_empty_when_the_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(store(&dir).load().unwrap(), ArchivedSessions::default());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);

        store.save(&sample()).unwrap();

        assert_eq!(store.load().unwrap(), sample());
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);

        store.save(&sample()).unwrap();

        assert!(dir.path().join("archived-sessions.json").is_file());
        assert!(!dir.path().join("archived-sessions.json.tmp").exists());
    }

    #[test]
    fn load_evacuates_a_corrupt_file_and_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("archived-sessions.json"), "not json").unwrap();
        let store = store(&dir);

        assert_eq!(store.load().unwrap(), ArchivedSessions::default());
        assert!(!dir.path().join("archived-sessions.json").exists());
        assert_eq!(corrupt_files(&dir), 1);
    }

    #[test]
    fn load_evacuates_an_unknown_version() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("archived-sessions.json"),
            r#"{"version":999,"session_ids":[]}"#,
        )
        .unwrap();
        let store = store(&dir);

        assert_eq!(store.load().unwrap(), ArchivedSessions::default());
        assert_eq!(corrupt_files(&dir), 1);
    }

    #[test]
    fn save_creates_the_directory_when_it_does_not_exist_yet() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileArchivedSessionsStore::new(
            dir.path().join("nested").join("archived-sessions.json"),
        );

        store.save(&sample()).unwrap();

        assert_eq!(store.load().unwrap(), sample());
    }
}
