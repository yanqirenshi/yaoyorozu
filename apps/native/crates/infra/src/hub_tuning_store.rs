use app::{AppError, HubTuningStore};
use domain::{HubTuning, CURRENT_HUB_TUNING_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// ハブグラフの force シミュレーション調整値(`HubTuning`)をJSONファイルとして
/// 永続化する(issue #249)。`hub-layout.json` とは別ファイル
/// (`hub-tuning.json`)。`FileHubLayoutStore` と同じ流儀(native.md §2):
/// 書き込みはアトミック(`*.tmp` へ書く → fsync → rename)、読み込み失敗時は
/// プロセスを落とさずデフォルト値へフォールバックする(壊れたファイルは
/// `*.corrupt.<timestamp>` へ退避)。
pub struct FileHubTuningStore {
    path: PathBuf,
}

impl FileHubTuningStore {
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
            .unwrap_or("hub-tuning.json");
        let corrupt_path = self
            .path
            .with_file_name(format!("{file_name}.corrupt.{millis}"));
        // 退避に失敗しても(パーミッション等)デフォルト値での起動は継続する。
        let _ = fs::rename(&self.path, corrupt_path);
    }
}

impl HubTuningStore for FileHubTuningStore {
    fn load(&self) -> Result<HubTuning, AppError> {
        if !self.path.is_file() {
            return Ok(HubTuning::default());
        }

        let Ok(content) = fs::read_to_string(&self.path) else {
            self.evacuate_corrupt_file();
            return Ok(HubTuning::default());
        };

        let Ok(tuning) = serde_json::from_str::<HubTuning>(&content) else {
            self.evacuate_corrupt_file();
            return Ok(HubTuning::default());
        };

        if tuning.version != CURRENT_HUB_TUNING_VERSION {
            // 未知のバージョン(将来のアプリが書いたファイルを古いアプリが
            // 読む場合など)は解釈できないため、破損扱いとして退避する。
            self.evacuate_corrupt_file();
            return Ok(HubTuning::default());
        }

        Ok(tuning)
    }

    fn save(&self, tuning: &HubTuning) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(tuning)
            .map_err(|e| AppError::Io(format!("ハブ調整値のシリアライズに失敗しました: {e}")))?;

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

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileHubTuningStore::new(dir.path().join("hub-tuning.json"));

        assert_eq!(
            store.load().expect("should load default"),
            HubTuning::default()
        );
    }

    #[test]
    fn save_then_load_roundtrips_including_none_link_strength() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileHubTuningStore::new(dir.path().join("hub-tuning.json"));

        for link_strength in [None, Some(0.35)] {
            let tuning = HubTuning {
                version: CURRENT_HUB_TUNING_VERSION,
                link_distance: 120.0,
                link_strength,
                charge_strength: -250.0,
                collide_radius: 40.0,
            };
            store.save(&tuning).expect("should save");
            assert_eq!(store.load().expect("should load"), tuning);
        }
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-tuning.json");
        let store = FileHubTuningStore::new(path.clone());

        store.save(&HubTuning::default()).expect("should save");

        assert!(path.is_file());
        assert!(!dir.path().join("hub-tuning.json.tmp").exists());
    }

    #[test]
    fn load_evacuates_corrupt_file_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-tuning.json");
        fs::write(&path, "this is not valid json").unwrap();
        let store = FileHubTuningStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded, HubTuning::default());
        assert!(!path.exists(), "corrupt file should have been moved away");
        let corrupt_files = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("hub-tuning.json.corrupt.")
            })
            .count();
        assert_eq!(corrupt_files, 1, "expected exactly one evacuated file");
    }

    #[test]
    fn load_evacuates_file_with_unknown_version_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hub-tuning.json");
        fs::write(
            &path,
            r#"{"version":999,"link_distance":1.0,"link_strength":null,"charge_strength":-1.0,"collide_radius":1.0}"#,
        )
        .unwrap();
        let store = FileHubTuningStore::new(path.clone());

        assert_eq!(store.load().expect("should recover"), HubTuning::default());
        assert!(!path.exists());
    }
}
