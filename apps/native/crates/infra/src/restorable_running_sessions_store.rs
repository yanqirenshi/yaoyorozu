use app::{AppError, RestorableRunningSessionsStore};
use domain::{RestorableRunningSessions, CURRENT_RESTORABLE_RUNNING_SESSIONS_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// app が起動していた実行中セッション(再開に必要な指定)を、`app_data_dir/running-sessions.json`
/// として永続化する(issue #459)。`FileViewerTabsStore` と同じ流儀(native.md §2): 書き込みは
/// アトミック(`*.tmp` へ書く → fsync → rename)、読み込み失敗時はプロセスを落とさず空で始める
/// (壊れたファイルは `*.corrupt.<timestamp>` へ退避)。
///
/// 「前回動かしていたもの」を覚えるだけの控えなので、読めないときに起動を止めない(復元を
/// あきらめるだけで、利用者は今までどおり手で起動できる)。
pub struct FileRestorableRunningSessionsStore {
    path: PathBuf,
}

impl FileRestorableRunningSessionsStore {
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
            .unwrap_or("running-sessions.json");
        let corrupt_path = self
            .path
            .with_file_name(format!("{file_name}.corrupt.{millis}"));
        // 退避に失敗しても(パーミッション等)空での起動は継続する。
        let _ = fs::rename(&self.path, corrupt_path);
    }
}

impl RestorableRunningSessionsStore for FileRestorableRunningSessionsStore {
    fn load(&self) -> Result<RestorableRunningSessions, AppError> {
        if !self.path.is_file() {
            return Ok(RestorableRunningSessions::default());
        }

        let Ok(content) = fs::read_to_string(&self.path) else {
            self.evacuate_corrupt_file();
            return Ok(RestorableRunningSessions::default());
        };

        let Ok(raw) = serde_json::from_str::<serde_json::Value>(&content) else {
            self.evacuate_corrupt_file();
            return Ok(RestorableRunningSessions::default());
        };

        // 未知のバージョン(将来のアプリが書いたファイルを古いアプリが読む場合など)は
        // 解釈できないため、破損扱いとして退避する。移行が要るバージョンが増えたら、ここに
        // 旧形式の読み取りと変換を足す(`FileSettingsStore` と同じ流儀)。
        if raw.get("version").and_then(|v| v.as_u64())
            != Some(CURRENT_RESTORABLE_RUNNING_SESSIONS_VERSION as u64)
        {
            self.evacuate_corrupt_file();
            return Ok(RestorableRunningSessions::default());
        }

        let Ok(sessions) = serde_json::from_value::<RestorableRunningSessions>(raw) else {
            self.evacuate_corrupt_file();
            return Ok(RestorableRunningSessions::default());
        };

        Ok(sessions)
    }

    fn save(&self, sessions: &RestorableRunningSessions) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(sessions).map_err(|e| {
            AppError::Io(format!(
                "実行中セッションの控えのシリアライズに失敗しました: {e}"
            ))
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
    use domain::RestorableRunningSession;

    fn sample() -> RestorableRunningSessions {
        RestorableRunningSessions {
            version: CURRENT_RESTORABLE_RUNNING_SESSIONS_VERSION,
            sessions: vec![
                RestorableRunningSession {
                    profile_id: "default".to_string(),
                    project: Some("proj-a".to_string()),
                    session_id: "s1".to_string(),
                    permission_mode: "plan".to_string(),
                    model: Some("opus".to_string()),
                    name: Some("実装:APP".to_string()),
                    worktree_id: "main-worktree".to_string(),
                },
                RestorableRunningSession {
                    profile_id: "default".to_string(),
                    project: Some("proj-b".to_string()),
                    session_id: "s2".to_string(),
                    permission_mode: "auto".to_string(),
                    model: None,
                    name: None,
                    worktree_id: "wt-1".to_string(),
                },
            ],
        }
    }

    fn store(dir: &tempfile::TempDir) -> FileRestorableRunningSessionsStore {
        FileRestorableRunningSessionsStore::new(dir.path().join("running-sessions.json"))
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

        assert_eq!(
            store(&dir).load().unwrap(),
            RestorableRunningSessions::default()
        );
    }

    #[test]
    fn save_then_load_roundtrips_keeping_the_order() {
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

        assert!(dir.path().join("running-sessions.json").is_file());
        assert!(!dir.path().join("running-sessions.json.tmp").exists());
    }

    #[test]
    fn load_evacuates_a_corrupt_file_and_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("running-sessions.json"), "not json").unwrap();
        let store = store(&dir);

        assert_eq!(store.load().unwrap(), RestorableRunningSessions::default());
        assert!(!dir.path().join("running-sessions.json").exists());
        assert_eq!(corrupt_files(&dir), 1);
    }

    #[test]
    fn load_evacuates_an_unknown_version() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("running-sessions.json"),
            r#"{"version":999,"sessions":[]}"#,
        )
        .unwrap();
        let store = store(&dir);

        assert_eq!(store.load().unwrap(), RestorableRunningSessions::default());
        assert_eq!(corrupt_files(&dir), 1);
    }

    #[test]
    fn load_evacuates_a_file_whose_entries_are_malformed() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("running-sessions.json"),
            r#"{"version":1,"sessions":[{"session_id":"s1"}]}"#,
        )
        .unwrap();
        let store = store(&dir);

        assert_eq!(store.load().unwrap(), RestorableRunningSessions::default());
        assert_eq!(corrupt_files(&dir), 1);
    }

    #[test]
    fn save_creates_the_directory_when_it_does_not_exist_yet() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileRestorableRunningSessionsStore::new(
            dir.path().join("nested").join("running-sessions.json"),
        );

        store.save(&sample()).unwrap();

        assert_eq!(store.load().unwrap(), sample());
    }
}
