use app::{AppError, ViewerTabsStore};
use domain::{ViewerTabs, CURRENT_VIEWER_TABS_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// ビューアのセッションタブの並び(`ViewerTabs`)を、プロファイルごとの JSON
/// ファイル(`<dir>/<プロファイルID>.json`)として永続化する(issue #353)。
/// `FileHubTuningStore` と同じ流儀(native.md §2): 書き込みはアトミック
/// (`*.tmp` へ書く → fsync → rename)、読み込み失敗時はプロセスを落とさず空で
/// 始める(壊れたファイルは `*.corrupt.<timestamp>` へ退避)。
/// プロファイル ID は app 層で検証済みの前提(ファイル名の構築に使うため)。
pub struct FileViewerTabsStore {
    dir: PathBuf,
}

impl FileViewerTabsStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn path_for(&self, profile_id: &str) -> PathBuf {
        self.dir.join(format!("{profile_id}.json"))
    }

    fn evacuate_corrupt_file(&self, path: &PathBuf) {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("viewer-tabs.json");
        let corrupt_path = path.with_file_name(format!("{file_name}.corrupt.{millis}"));
        // 退避に失敗しても(パーミッション等)空での起動は継続する。
        let _ = fs::rename(path, corrupt_path);
    }
}

impl ViewerTabsStore for FileViewerTabsStore {
    fn load(&self, profile_id: &str) -> Result<ViewerTabs, AppError> {
        let path = self.path_for(profile_id);
        if !path.is_file() {
            return Ok(ViewerTabs::default());
        }

        let Ok(content) = fs::read_to_string(&path) else {
            self.evacuate_corrupt_file(&path);
            return Ok(ViewerTabs::default());
        };

        let Ok(tabs) = serde_json::from_str::<ViewerTabs>(&content) else {
            self.evacuate_corrupt_file(&path);
            return Ok(ViewerTabs::default());
        };

        if tabs.version != CURRENT_VIEWER_TABS_VERSION {
            // 未知のバージョン(将来のアプリが書いたファイルを古いアプリが読む
            // 場合など)は解釈できないため、破損扱いとして退避する。
            self.evacuate_corrupt_file(&path);
            return Ok(ViewerTabs::default());
        }

        Ok(tabs)
    }

    fn save(&self, profile_id: &str, tabs: &ViewerTabs) -> Result<(), AppError> {
        let path = self.path_for(profile_id);
        let json = serde_json::to_string_pretty(tabs)
            .map_err(|e| AppError::Io(format!("タブ一覧のシリアライズに失敗しました: {e}")))?;

        fs::create_dir_all(&self.dir).map_err(|e| {
            AppError::Io(format!(
                "{} を作成できませんでした: {e}",
                self.dir.display()
            ))
        })?;

        let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));
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
        fs::rename(&tmp_path, &path)
            .map_err(|e| AppError::Io(format!("{} への置換に失敗しました: {e}", path.display())))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::ViewerTab;

    fn sample() -> ViewerTabs {
        ViewerTabs {
            version: CURRENT_VIEWER_TABS_VERSION,
            tabs: vec![
                ViewerTab {
                    project: "proj-a".to_string(),
                    series_key: "root-1".to_string(),
                },
                ViewerTab {
                    project: "proj-b".to_string(),
                    series_key: "sess-2".to_string(),
                },
            ],
        }
    }

    #[test]
    fn load_returns_empty_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileViewerTabsStore::new(dir.path().join("viewer-tabs"));

        assert_eq!(store.load("p1").unwrap(), ViewerTabs::default());
    }

    #[test]
    fn save_then_load_roundtrips_per_profile_keeping_order() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileViewerTabsStore::new(dir.path().join("viewer-tabs"));

        store.save("p1", &sample()).unwrap();

        assert_eq!(store.load("p1").unwrap(), sample());
        // 別プロファイルは別ファイル(影響しない)
        assert_eq!(store.load("p2").unwrap(), ViewerTabs::default());
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let tabs_dir = dir.path().join("viewer-tabs");
        let store = FileViewerTabsStore::new(tabs_dir.clone());

        store.save("p1", &sample()).unwrap();

        assert!(tabs_dir.join("p1.json").is_file());
        assert!(!tabs_dir.join("p1.json.tmp").exists());
    }

    #[test]
    fn load_evacuates_corrupt_file_and_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        let tabs_dir = dir.path().join("viewer-tabs");
        fs::create_dir_all(&tabs_dir).unwrap();
        fs::write(tabs_dir.join("p1.json"), "not json").unwrap();
        let store = FileViewerTabsStore::new(tabs_dir.clone());

        assert_eq!(store.load("p1").unwrap(), ViewerTabs::default());
        assert!(!tabs_dir.join("p1.json").exists());
        let evacuated = fs::read_dir(&tabs_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("p1.json.corrupt."))
            .count();
        assert_eq!(evacuated, 1);
    }

    #[test]
    fn load_evacuates_unknown_version() {
        let dir = tempfile::tempdir().unwrap();
        let tabs_dir = dir.path().join("viewer-tabs");
        fs::create_dir_all(&tabs_dir).unwrap();
        fs::write(tabs_dir.join("p1.json"), r#"{"version":999,"tabs":[]}"#).unwrap();
        let store = FileViewerTabsStore::new(tabs_dir.clone());

        assert_eq!(store.load("p1").unwrap(), ViewerTabs::default());
        assert!(!tabs_dir.join("p1.json").exists());
    }
}
