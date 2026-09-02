use app::{AppError, LoadedSettings, SettingsStore};
use domain::{GithubProject, Profile, Settings, TabState, CURRENT_SETTINGS_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// v1〜v3のJSON形状(対象リポジトリ・GitHubプロジェクト・対象フォルダを
/// プロファイルに包まず直接持つ)。v1/v2の旧フィールド `selected_session_ids`
/// はこのstructに存在しないため、serdeが未知フィールドとして無視する
/// (issue #17の移行と同じ吸収のさせ方)。
#[derive(serde::Deserialize)]
struct LegacySettingsRaw {
    repository_path: Option<PathBuf>,
    github_project: Option<GithubProject>,
    #[serde(default)]
    selected_project_folders: Vec<String>,
    #[serde(default)]
    claude_projects_dir: Option<PathBuf>,
}

/// v4のJSON形状(プロファイル化済みだが `open_tabs` を持たない。issue #77)。
#[derive(serde::Deserialize)]
struct SettingsV4Raw {
    profiles: Vec<Profile>,
    active_profile_id: String,
    #[serde(default)]
    claude_projects_dir: Option<PathBuf>,
}

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

    /// v1〜v3(対象リポジトリ・GitHubプロジェクト・対象フォルダをスカラーで
    /// 持つ形)を、その3項目を1件のプロファイルへ包んだv5へ移行する
    /// (issue #72)。プロファイルの `name` は `repository_path` の末尾フォルダ名
    /// (未設定・空なら "default")、`id` は移行時のみ固定値 "default" を使う
    /// (以降 `create_profile` が払い出すIDと衝突しないよう、そちらは
    /// UUIDを使う)。`open_tabs` はそのプロファイル1件のタブから始める
    /// (issue #77)。保存し直しに失敗しても(パーミッション等)、この
    /// セッションはメモリ上の移行後の値で動作を続ける(次回起動時に再度
    /// 移行を試みるだけで、他のデータが失われるわけではないため)。
    fn migrate_legacy_to_current_version(&self, legacy: LegacySettingsRaw) -> Settings {
        let name = legacy
            .repository_path
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|f| f.to_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "default".to_string());
        let profile = Profile {
            id: "default".to_string(),
            name,
            repository_path: legacy.repository_path,
            github_project: legacy.github_project,
            selected_project_folders: legacy.selected_project_folders,
        };
        let migrated = Settings {
            version: CURRENT_SETTINGS_VERSION,
            active_profile_id: profile.id.clone(),
            open_tabs: vec![TabState {
                profile_id: profile.id.clone(),
            }],
            profiles: vec![profile],
            claude_projects_dir: legacy.claude_projects_dir,
        };
        let _ = self.save(&migrated);
        migrated
    }

    /// v4(プロファイル化済みだが `open_tabs` を持たない)をv5へ移行する
    /// (issue #77)。アクティブプロファイル1件のタブから始める。
    fn migrate_v4_to_current_version(&self, v4: SettingsV4Raw) -> Settings {
        let migrated = Settings {
            version: CURRENT_SETTINGS_VERSION,
            open_tabs: vec![TabState {
                profile_id: v4.active_profile_id.clone(),
            }],
            profiles: v4.profiles,
            active_profile_id: v4.active_profile_id,
            claude_projects_dir: v4.claude_projects_dir,
        };
        let _ = self.save(&migrated);
        migrated
    }

    /// `open_tabs` が空(壊れた手編集ファイル等)ならアクティブプロファイル
    /// 1件のタブへフォールバックする。「タブは常に1件以上」という不変条件を
    /// 読み込み時点で保証する(issue #77)。
    fn normalize_open_tabs(settings: Settings) -> Settings {
        if settings.open_tabs.is_empty() {
            let profile_id = settings.active_profile_id.clone();
            Settings {
                open_tabs: vec![TabState { profile_id }],
                ..settings
            }
        } else {
            settings
        }
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

        let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
            return Ok(self.recovered_default());
        };

        match value.get("version").and_then(serde_json::Value::as_u64) {
            Some(v) if v == CURRENT_SETTINGS_VERSION as u64 => {
                match serde_json::from_value::<Settings>(value) {
                    Ok(settings) => Ok(LoadedSettings {
                        settings: Self::normalize_open_tabs(settings),
                        recovered_from_corruption: false,
                    }),
                    Err(_) => Ok(self.recovered_default()),
                }
            }
            Some(4) => match serde_json::from_value::<SettingsV4Raw>(value) {
                Ok(v4) => Ok(LoadedSettings {
                    settings: self.migrate_v4_to_current_version(v4),
                    recovered_from_corruption: false,
                }),
                Err(_) => Ok(self.recovered_default()),
            },
            Some(1..=3) => match serde_json::from_value::<LegacySettingsRaw>(value) {
                Ok(legacy) => Ok(LoadedSettings {
                    settings: self.migrate_legacy_to_current_version(legacy),
                    recovered_from_corruption: false,
                }),
                Err(_) => Ok(self.recovered_default()),
            },
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

        let profile = Profile {
            id: "p1".to_string(),
            name: "yaoyorozu".to_string(),
            repository_path: Some(PathBuf::from(r"C:\Users\yanqi\prj\yaoyorozu")),
            github_project: Some(GithubProject {
                owner: "yanqirenshi".to_string(),
                number: 51,
            }),
            selected_project_folders: vec!["proj1".to_string(), "proj2".to_string()],
        };
        let settings = Settings {
            version: CURRENT_SETTINGS_VERSION,
            active_profile_id: profile.id.clone(),
            open_tabs: vec![TabState {
                profile_id: profile.id.clone(),
            }],
            profiles: vec![profile],
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
        fs::write(&path, r#"{"version":999}"#).unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should recover with default");

        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.recovered_from_corruption);
    }

    #[test]
    fn load_migrates_v1_settings_wrapping_the_three_legacy_items_into_a_single_profile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // v1のJSON(claude_projects_dir・selected_project_foldersのどちらも持たない)。
        fs::write(
            &path,
            r#"{"version":1,"repository_path":"C:\\Users\\yanqi\\prj\\yaoyorozu","github_project":null,"selected_session_ids":["s1"]}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v1 to current version");

        assert_eq!(loaded.settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(loaded.settings.profiles.len(), 1);
        let profile = &loaded.settings.profiles[0];
        assert_eq!(loaded.settings.active_profile_id, profile.id);
        assert_eq!(
            profile.name, "yaoyorozu",
            "repository_pathの末尾フォルダ名を使う"
        );
        assert_eq!(
            profile.repository_path,
            Some(PathBuf::from(r"C:\Users\yanqi\prj\yaoyorozu"))
        );
        assert!(
            profile.selected_project_folders.is_empty(),
            "v1の旧selected_session_idsはフィールド置換により破棄される"
        );
        assert_eq!(loaded.settings.claude_projects_dir, None);
        assert_eq!(
            loaded.settings.open_tabs,
            vec![TabState {
                profile_id: profile.id.clone()
            }]
        );
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
    }

    #[test]
    fn load_migrates_v2_settings_discarding_old_session_ids_and_keeping_claude_projects_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // v2のJSON(selected_session_ids・claude_projects_dirを持つ)。
        fs::write(
            &path,
            r#"{"version":2,"repository_path":null,"github_project":null,"selected_session_ids":["s1"],"claude_projects_dir":"D:\\custom\\projects"}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v2 to current version");

        assert_eq!(loaded.settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(loaded.settings.profiles.len(), 1);
        let profile = &loaded.settings.profiles[0];
        assert_eq!(
            profile.name, "default",
            "repository_pathが未設定なのでdefault名になる"
        );
        assert!(
            profile.selected_project_folders.is_empty(),
            "v2の旧selected_session_idsはフィールド置換により破棄される"
        );
        assert_eq!(
            loaded.settings.claude_projects_dir,
            Some(PathBuf::from(r"D:\custom\projects")),
            "claude_projects_dirはグローバル項目として引き継がれる"
        );
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
    }

    #[test]
    fn load_migrates_v3_settings_wrapping_existing_three_items_into_a_single_profile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":3,"repository_path":"C:\\Users\\yanqi\\prj\\yaoyorozu","github_project":{"owner":"yanqirenshi","number":51},"selected_project_folders":["proj1","proj2"],"claude_projects_dir":null}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v3 to current version");

        assert_eq!(loaded.settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(loaded.settings.profiles.len(), 1);
        let profile = &loaded.settings.profiles[0];
        assert_eq!(loaded.settings.active_profile_id, profile.id);
        assert_eq!(profile.name, "yaoyorozu");
        assert_eq!(
            profile.repository_path,
            Some(PathBuf::from(r"C:\Users\yanqi\prj\yaoyorozu"))
        );
        assert_eq!(
            profile.github_project,
            Some(GithubProject {
                owner: "yanqirenshi".to_string(),
                number: 51,
            })
        );
        assert_eq!(
            profile.selected_project_folders,
            vec!["proj1".to_string(), "proj2".to_string()]
        );
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
    }

    #[test]
    fn load_migrates_v3_settings_with_null_repository_path_using_default_profile_name() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":3,"repository_path":null,"github_project":null,"selected_project_folders":[]}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v3 to current version");

        assert_eq!(loaded.settings.profiles[0].name, "default");
    }

    #[test]
    fn load_migrates_v4_settings_adding_a_single_tab_for_the_active_profile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // v4のJSON(プロファイル化済みだがopen_tabsを持たない)。
        fs::write(
            &path,
            r#"{"version":4,"profiles":[{"id":"p1","name":"yaoyorozu","repository_path":null,"github_project":null,"selected_project_folders":[]}],"active_profile_id":"p1","claude_projects_dir":null}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v4 to current version");

        assert_eq!(loaded.settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(loaded.settings.profiles.len(), 1);
        assert_eq!(loaded.settings.active_profile_id, "p1");
        assert_eq!(
            loaded.settings.open_tabs,
            vec![TabState {
                profile_id: "p1".to_string()
            }]
        );
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
    }

    #[test]
    fn load_falls_back_to_a_single_tab_when_current_version_file_has_empty_open_tabs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // 現行バージョンだが open_tabs が空(手編集等で壊れたケース)。
        fs::write(
            &path,
            format!(
                r#"{{"version":{v},"profiles":[{{"id":"p1","name":"yaoyorozu","repository_path":null,"github_project":null,"selected_project_folders":[]}}],"active_profile_id":"p1","claude_projects_dir":null,"open_tabs":[]}}"#,
                v = CURRENT_SETTINGS_VERSION
            ),
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should load and normalize");

        assert_eq!(
            loaded.settings.open_tabs,
            vec![TabState {
                profile_id: "p1".to_string()
            }],
            "空のopen_tabsはアクティブプロファイル1件のタブへフォールバックする"
        );
    }

    #[test]
    fn load_persists_the_migration_immediately() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":1,"repository_path":null,"github_project":null,"selected_session_ids":[]}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        store.load().expect("should migrate to current version");

        // ファイル自体も現行バージョンとして保存し直されている(次回起動時に
        // 再度移行処理を通らなくてよいことを確認する)。
        let content = fs::read_to_string(&path).unwrap();
        let saved: Settings = serde_json::from_str(&content).unwrap();
        assert_eq!(saved.version, CURRENT_SETTINGS_VERSION);
    }
}
