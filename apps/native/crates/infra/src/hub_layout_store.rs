use app::{AppError, HubLayoutStore};
use domain::{HubLayout, CURRENT_HUB_LAYOUT_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// ハブグラフのノード位置(`HubLayout`)をJSONファイルとして永続化する。
/// `settings.json` とは別ファイル(`hub-layout.json`)に保存する低重要度
/// データであり、まだv1のみでマイグレーションは無いため `FileSettingsStore`
/// より単純(issue #121)。native.md §2 に準拠: 書き込みはアトミック
/// (`*.tmp` へ書く → fsync → rename)、読み込み失敗時はプロセスを落とさず
/// デフォルト値へフォールバックする(壊れたファイルは `*.corrupt.<timestamp>`
/// へ退避)。
pub struct FileHubLayoutStore {
    path: PathBuf,
}

impl FileHubLayoutStore {
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
            .unwrap_or("hub-layout.json");
        let corrupt_path = self
            .path
            .with_file_name(format!("{file_name}.corrupt.{millis}"));
        // 退避に失敗しても(パーミッション等)デフォルト値での起動は継続する。
        let _ = fs::rename(&self.path, corrupt_path);
    }
}

impl HubLayoutStore for FileHubLayoutStore {
    fn load(&self) -> Result<HubLayout, AppError> {
        if !self.path.is_file() {
            return Ok(HubLayout::default());
        }

        let Ok(content) = fs::read_to_string(&self.path) else {
            self.evacuate_corrupt_file();
            return Ok(HubLayout::default());
        };

        let Ok(layout) = serde_json::from_str::<HubLayout>(&content) else {
            self.evacuate_corrupt_file();
            return Ok(HubLayout::default());
        };

        match layout.version {
            CURRENT_HUB_LAYOUT_VERSION => Ok(layout),
            // v1 -> v2(issue #268): 視点(`camera`)が増えただけ。v1 のファイルは
            // 視点を持たない(`None`)ので、positions はそのままバージョンだけ
            // 上げ、すぐに書き戻す(`FileSettingsStore` と同じ流儀)。書き戻しに
            // 失敗しても、読み込んだ内容は使える。
            1 => {
                let migrated = HubLayout {
                    version: CURRENT_HUB_LAYOUT_VERSION,
                    positions: layout.positions,
                    camera: None,
                };
                let _ = self.save(&migrated);
                Ok(migrated)
            }
            _ => {
                // 未知のバージョン(将来のアプリが書いたファイルを古いアプリが
                // 読む場合など)は解釈できないため、破損扱いとして退避する。
                self.evacuate_corrupt_file();
                Ok(HubLayout::default())
            }
        }
    }

    fn save(&self, layout: &HubLayout) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(layout).map_err(|e| {
            AppError::Io(format!("ハブレイアウトのシリアライズに失敗しました: {e}"))
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
    use domain::{Camera, NodePosition};
    use std::collections::HashMap;

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileHubLayoutStore::new(dir.path().join("hub-layout.json"));

        let loaded = store.load().expect("should load default");
        assert_eq!(loaded, HubLayout::default());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-layout.json");
        let store = FileHubLayoutStore::new(path.clone());

        let mut positions = HashMap::new();
        positions.insert("cwd:proj1".to_string(), NodePosition { x: 12.5, y: -3.0 });
        let layout = HubLayout {
            version: CURRENT_HUB_LAYOUT_VERSION,
            positions,
            camera: Some(Camera {
                x: 12.5,
                y: -40.0,
                k: 1.5,
            }),
        };

        store.save(&layout).expect("should save");
        let loaded = store.load().expect("should load");

        assert_eq!(loaded, layout);
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-layout.json");
        let store = FileHubLayoutStore::new(path.clone());

        store.save(&HubLayout::default()).expect("should save");

        assert!(path.is_file());
        assert!(!dir.path().join("hub-layout.json.tmp").exists());
    }

    #[test]
    fn load_evacuates_corrupt_file_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-layout.json");
        fs::write(&path, "this is not valid json").unwrap();
        let store = FileHubLayoutStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded, HubLayout::default());
        assert!(!path.exists(), "corrupt file should have been moved away");

        let corrupt_files: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("hub-layout.json.corrupt.")
            })
            .collect();
        assert_eq!(
            corrupt_files.len(),
            1,
            "expected exactly one evacuated file"
        );
    }

    #[test]
    fn load_evacuates_file_with_unknown_version_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-layout.json");
        fs::write(&path, r#"{"version":999,"positions":{}}"#).unwrap();
        let store = FileHubLayoutStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded, HubLayout::default());
    }

    #[test]
    fn load_migrates_v1_layout_keeping_positions_and_persisting_v2() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-layout.json");
        fs::write(
            &path,
            r#"{"version":1,"positions":{"git-branch:b1":{"x":1.5,"y":2.5}}}"#,
        )
        .unwrap();
        let store = FileHubLayoutStore::new(path.clone());

        let loaded = store.load().expect("should migrate");

        assert_eq!(loaded.version, CURRENT_HUB_LAYOUT_VERSION);
        assert_eq!(loaded.camera, None, "v1 は視点を持たない");
        assert_eq!(
            loaded.positions.get("git-branch:b1"),
            Some(&NodePosition { x: 1.5, y: 2.5 }),
            "positions は不変"
        );
        // 移行結果がすぐ書き戻され、再読み込みでも同じ内容(退避されない)。
        assert!(path.is_file());
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("\"version\": 2"));
        assert_eq!(store.load().expect("should load again"), loaded);
    }
}
