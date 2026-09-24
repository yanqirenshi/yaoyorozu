use app::{AppError, ViewerTabsStore};
use domain::{ViewerTab, ViewerTabs, CURRENT_VIEWER_TABS_VERSION};
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

/// v1(issue #353。タブのキーがフォーク系列の鍵 `series_key`)のファイル形式。
/// マイグレーションのためだけに読む(v2 = issue #369 でキーが `session_id` になった)。
#[derive(serde::Deserialize)]
struct ViewerTabsV1 {
    tabs: Vec<ViewerTabV1>,
}

#[derive(serde::Deserialize)]
struct ViewerTabV1 {
    project: String,
    series_key: String,
}

/// v1 → v2。旧 `series_key` の値をそのまま `session_id` として引き継ぐ。
/// 系列の鍵が `root_uuid` だった(=そのセッション自身のIDではなかった)タブは、
/// 一致するセッションが一覧に無くなるので、ビューアの「一覧に無いタブは表示しない」
/// 規則で自然に外れる(ここでは判別も削除もしない)。
fn migrate_v1(v1: ViewerTabsV1) -> ViewerTabs {
    ViewerTabs {
        version: CURRENT_VIEWER_TABS_VERSION,
        tabs: v1
            .tabs
            .into_iter()
            .map(|tab| ViewerTab {
                project: tab.project,
                session_id: tab.series_key,
            })
            .collect(),
    }
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

        let Ok(raw) = serde_json::from_str::<serde_json::Value>(&content) else {
            self.evacuate_corrupt_file(&path);
            return Ok(ViewerTabs::default());
        };

        // v1(タブのキーが `series_key`)は v2 へ移行して書き戻す(issue #369)。
        // 書き戻しに失敗しても(パーミッション等)移行後の値で起動は継続する。
        if raw.get("version").and_then(|v| v.as_u64()) == Some(1) {
            let Ok(v1) = serde_json::from_value::<ViewerTabsV1>(raw) else {
                self.evacuate_corrupt_file(&path);
                return Ok(ViewerTabs::default());
            };
            let migrated = migrate_v1(v1);
            let _ = self.save(profile_id, &migrated);
            return Ok(migrated);
        }

        let Ok(tabs) = serde_json::from_value::<ViewerTabs>(raw) else {
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
                    session_id: "sess-1".to_string(),
                },
                ViewerTab {
                    project: "proj-b".to_string(),
                    session_id: "sess-2".to_string(),
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
    fn load_migrates_v1_series_keys_to_session_ids_and_persists_v2() {
        // v1: キーはフォーク系列の鍵(`series_key`)。値はそのまま `session_id` へ引き継ぐ
        // (`root_uuid` だった鍵は一致するセッションが無くなり、表示側の規則で外れる)。
        let dir = tempfile::tempdir().unwrap();
        let tabs_dir = dir.path().join("viewer-tabs");
        fs::create_dir_all(&tabs_dir).unwrap();
        fs::write(
            tabs_dir.join("p1.json"),
            r#"{"version":1,"tabs":[{"project":"proj-a","series_key":"root-1"},{"project":"proj-b","series_key":"sess-2"}]}"#,
        )
        .unwrap();
        let store = FileViewerTabsStore::new(tabs_dir.clone());

        let loaded = store.load("p1").unwrap();

        let expected = ViewerTabs {
            version: CURRENT_VIEWER_TABS_VERSION,
            tabs: vec![
                ViewerTab {
                    project: "proj-a".to_string(),
                    session_id: "root-1".to_string(),
                },
                ViewerTab {
                    project: "proj-b".to_string(),
                    session_id: "sess-2".to_string(),
                },
            ],
        };
        assert_eq!(loaded, expected);
        // v2 で書き戻されている(次の起動は移行なしで読める。退避もされていない)。
        let persisted = fs::read_to_string(tabs_dir.join("p1.json")).unwrap();
        assert!(persisted.contains("\"version\": 2"));
        assert!(persisted.contains("session_id"));
        assert!(!persisted.contains("series_key"));
        assert_eq!(store.load("p1").unwrap(), expected);
        let evacuated = fs::read_dir(&tabs_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".corrupt."))
            .count();
        assert_eq!(evacuated, 0);
    }

    #[test]
    fn load_evacuates_a_malformed_v1_file() {
        let dir = tempfile::tempdir().unwrap();
        let tabs_dir = dir.path().join("viewer-tabs");
        fs::create_dir_all(&tabs_dir).unwrap();
        fs::write(
            tabs_dir.join("p1.json"),
            r#"{"version":1,"tabs":[{"project":"proj-a"}]}"#,
        )
        .unwrap();
        let store = FileViewerTabsStore::new(tabs_dir.clone());

        assert_eq!(store.load("p1").unwrap(), ViewerTabs::default());
        assert!(!tabs_dir.join("p1.json").exists());
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
