use app::{AppError, LoadedSettings, SettingsStore};
use domain::{Settings, CURRENT_SETTINGS_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// アプリ設定(`Settings`)をJSONファイルとして永続化する。
/// native.md §2 に準拠: 書き込みはアトミック(`*.tmp` へ書く → fsync →
/// rename)、読み込み失敗時はプロセスを落とさずデフォルト値へフォールバック
/// する(壊れたファイルは `*.corrupt.<timestamp>` へ退避)。
pub struct FileSettingsStore {
    path: PathBuf,
}

impl FileSettingsStore {
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
            .unwrap_or("settings.json");
        let corrupt_path = self
            .path
            .with_file_name(format!("{file_name}.corrupt.{millis}"));
        // 退避に失敗しても(パーミッション等)デフォルト値での起動は継続する。
        let _ = fs::rename(&self.path, corrupt_path);
    }

    fn recovered_default(&self) -> LoadedSettings {
        self.evacuate_corrupt_file();
        LoadedSettings {
            settings: Settings::default(),
            recovered_from_corruption: true,
        }
    }

    /// v1(`claude_projects_dir` を持たない)を v2 へ移行する。v1 のJSONは
    /// `#[serde(default)]` により `claude_projects_dir: None` としてそのまま
    /// パースできているため、ここでは `version` を上げて保存し直すだけでよい。
    /// 保存し直しに失敗しても(パーミッション等)、このセッションはメモリ上の
    /// 移行後の値で動作を続ける(次回起動時に再度移行を試みるだけで、
    /// データが失われるわけではないため)。
    fn migrate_v1_to_v2(&self, v1: Settings) -> Settings {
        let migrated = Settings {
            version: CURRENT_SETTINGS_VERSION,
            ..v1
        };
        let _ = self.save(&migrated);
        migrated
    }
}

impl SettingsStore for FileSettingsStore {
    fn load(&self) -> Result<LoadedSettings, AppError> {
        if !self.path.is_file() {
            return Ok(LoadedSettings {
                settings: Settings::default(),
                recovered_from_corruption: false,
            });
        }

        let Ok(content) = fs::read_to_string(&self.path) else {
            return Ok(self.recovered_default());
        };

        let Ok(settings) = serde_json::from_str::<Settings>(&content) else {
            return Ok(self.recovered_default());
        };

        match settings.version {
            v if v == CURRENT_SETTINGS_VERSION => Ok(LoadedSettings {
                settings,
                recovered_from_corruption: false,
            }),
            1 => Ok(LoadedSettings {
                settings: self.migrate_v1_to_v2(settings),
                recovered_from_corruption: false,
            }),
            // 未知のバージョン(将来のアプリが書いたファイルを古いアプリが
            // 読む場合など)は解釈できないため、破損扱いとして退避する。
            _ => Ok(self.recovered_default()),
        }
    }

    fn save(&self, settings: &Settings) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| AppError::Io(format!("設定のシリアライズに失敗しました: {e}")))?;

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
    use domain::GithubProject;

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileSettingsStore::new(dir.path().join("settings.json"));

        let loaded = store.load().expect("should load default");
        assert_eq!(loaded.settings, Settings::default());
        assert!(!loaded.recovered_from_corruption);
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = FileSettingsStore::new(path.clone());

        let settings = Settings {
            version: CURRENT_SETTINGS_VERSION,
            repository_path: Some(PathBuf::from(r"C:\Users\yanqi\prj\yaoyorozu")),
            github_project: Some(GithubProject {
                owner: "yanqirenshi".to_string(),
                number: 51,
            }),
            selected_session_ids: vec!["s1".to_string(), "s2".to_string()],
            claude_projects_dir: Some(PathBuf::from(r"D:\custom\projects")),
        };

        store.save(&settings).expect("should save");
        let loaded = store.load().expect("should load");

        assert_eq!(loaded.settings, settings);
        assert!(!loaded.recovered_from_corruption);
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = FileSettingsStore::new(path.clone());

        store.save(&Settings::default()).expect("should save");

        assert!(path.is_file());
        assert!(!dir.path().join("settings.json.tmp").exists());
    }

    #[test]
    fn load_evacuates_corrupt_file_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "this is not valid json").unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.recovered_from_corruption);
        assert!(!path.exists(), "corrupt file should have been moved away");

        let corrupt_files: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("settings.json.corrupt.")
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
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"version":999,"repository_path":null,"github_project":null,"selected_session_ids":[]}"#).unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.recovered_from_corruption);
    }

    #[test]
    fn load_migrates_v1_settings_to_v2_without_treating_it_as_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // v1のJSON(claude_projects_dirフィールドを持たない)。
        fs::write(
            &path,
            r#"{"version":1,"repository_path":"C:\\Users\\yanqi\\prj\\yaoyorozu","github_project":null,"selected_session_ids":["s1"]}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v1 to v2");

        assert_eq!(loaded.settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(
            loaded.settings.repository_path,
            Some(PathBuf::from(r"C:\Users\yanqi\prj\yaoyorozu"))
        );
        assert_eq!(loaded.settings.selected_session_ids, vec!["s1".to_string()]);
        assert_eq!(loaded.settings.claude_projects_dir, None);
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
    }

    #[test]
    fn load_persists_the_v1_to_v2_migration_immediately() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":1,"repository_path":null,"github_project":null,"selected_session_ids":[]}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        store.load().expect("should migrate v1 to v2");

        // ファイル自体もv2として保存し直されている(次回起動時に再度
        // 移行処理を通らなくてよいことを確認する)。
        let content = fs::read_to_string(&path).unwrap();
        let saved: Settings = serde_json::from_str(&content).unwrap();
        assert_eq!(saved.version, CURRENT_SETTINGS_VERSION);
    }
}
