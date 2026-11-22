use app::{AppError, GitLedgerStore};
use domain::{GitLedger, CURRENT_GIT_LEDGER_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// `GitBranch`/`GitWorktree`台帳(`GitLedger`)をJSONファイルとして永続化
/// する。`settings.json`・`hub-layout.json`とは別ファイル
/// (`git-ledger.json`)に保存する(オブジェクトモデル実装 第3弾。
/// issue #193)。`FileHubLayoutStore`(issue #121)と同じ実装パターン:
/// 書き込みはアトミック(`*.tmp`へ書く→fsync→rename)、読み込み失敗時は
/// プロセスを落とさずデフォルト値へフォールバックする(壊れたファイルは
/// `*.corrupt.<timestamp>`へ退避)。
pub struct FileGitLedgerStore {
    path: PathBuf,
}

impl FileGitLedgerStore {
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
            .unwrap_or("git-ledger.json");
        let corrupt_path = self
            .path
            .with_file_name(format!("{file_name}.corrupt.{millis}"));
        let _ = fs::rename(&self.path, corrupt_path);
    }
}

impl GitLedgerStore for FileGitLedgerStore {
    fn load(&self) -> Result<GitLedger, AppError> {
        if !self.path.is_file() {
            return Ok(GitLedger::default());
        }

        let Ok(content) = fs::read_to_string(&self.path) else {
            self.evacuate_corrupt_file();
            return Ok(GitLedger::default());
        };

        let Ok(ledger) = serde_json::from_str::<GitLedger>(&content) else {
            self.evacuate_corrupt_file();
            return Ok(GitLedger::default());
        };

        if ledger.version != CURRENT_GIT_LEDGER_VERSION {
            self.evacuate_corrupt_file();
            return Ok(GitLedger::default());
        }

        Ok(ledger)
    }

    fn save(&self, ledger: &GitLedger) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(ledger)
            .map_err(|e| AppError::Io(format!("Git台帳のシリアライズに失敗しました: {e}")))?;

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
    use domain::{GitBranch, GitRepositoryLedger};
    use std::collections::HashMap;

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileGitLedgerStore::new(dir.path().join("git-ledger.json"));

        let loaded = store.load().expect("should load default");
        assert_eq!(loaded, GitLedger::default());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("git-ledger.json");
        let store = FileGitLedgerStore::new(path.clone());

        let mut repositories = HashMap::new();
        repositories.insert(
            r"C:\repo\a".to_string(),
            GitRepositoryLedger {
                branches: vec![GitBranch {
                    branch_id: "id-1".to_string(),
                    branch_name: "main".to_string(),
                    description: String::new(),
                    created_at_time: 100,
                    deleted_at_time: None,
                }],
                worktrees: Vec::new(),
            },
        );
        let ledger = GitLedger {
            version: CURRENT_GIT_LEDGER_VERSION,
            repositories,
        };

        store.save(&ledger).expect("should save");
        let loaded = store.load().expect("should load");

        assert_eq!(loaded, ledger);
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("git-ledger.json");
        let store = FileGitLedgerStore::new(path.clone());

        store.save(&GitLedger::default()).expect("should save");

        assert!(path.is_file());
        assert!(!dir.path().join("git-ledger.json.tmp").exists());
    }

    #[test]
    fn load_evacuates_corrupt_file_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("git-ledger.json");
        fs::write(&path, "this is not valid json").unwrap();
        let store = FileGitLedgerStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded, GitLedger::default());
        assert!(!path.exists(), "corrupt file should have been moved away");

        let corrupt_files: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("git-ledger.json.corrupt.")
            })
            .collect();
        assert_eq!(corrupt_files.len(), 1);
    }

    #[test]
    fn load_evacuates_file_with_unknown_version_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("git-ledger.json");
        fs::write(&path, r#"{"version":999,"repositories":{}}"#).unwrap();
        let store = FileGitLedgerStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded, GitLedger::default());
    }
}
