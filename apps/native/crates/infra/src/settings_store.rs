use app::{AppError, LoadedSettings, SettingsStore};
use domain::{GithubProject, Profile, Settings, CURRENT_SETTINGS_VERSION};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 設定ファイルを読む際、一時的な I/O エラー(ロック・同期ツールの読み取り中など)を
/// やり過ごすための再試行回数(issue #538)。1回も読めなければ [`LoadedSettings::evacuated`]
/// を立てずに(退避しない)既定値へ戻す。
const READ_RETRY_ATTEMPTS: u32 = 3;
const READ_RETRY_DELAY: Duration = Duration::from_millis(150);

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

/// v5のJSON形状(タブバー(issue #77)復元用の `open_tabs` を持つ)。
/// 「1ウィンドウ=1プロファイル」への一本化(issue #91)でタブバーを廃止した
/// ため、`open_tabs` は読み捨てる(このstructに含めず、serdeの未知フィールド
/// 無視に任せる)。
#[derive(serde::Deserialize)]
struct SettingsV5Raw {
    profiles: Vec<Profile>,
    active_profile_id: String,
    #[serde(default)]
    claude_projects_dir: Option<PathBuf>,
}

/// v6のJSON形状(`restore_running_sessions` を持たない。issue #459 で追加する前)。
#[derive(serde::Deserialize)]
struct SettingsV6Raw {
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

    /// 内容を読めたが解釈できなかった(JSONとして壊れている・未知のバージョン等。
    /// issue #538)場合のフォールバック。元ファイルは退避するので、以後は触れない
    /// (壊れていると確定しているため)。
    fn corrupted_default(&self) -> LoadedSettings {
        self.evacuate_corrupt_file();
        LoadedSettings {
            settings: Settings::default(),
            recovered_from_corruption: true,
            evacuated: true,
        }
    }

    /// ファイル自体を読めなかった(再試行しても失敗。issue #538)場合のフォールバック。
    /// 内容が壊れているとは限らない(ロック・一時的なI/Oエラーの可能性がある)ため、
    /// `corrupted_default` と違って**退避しない**(元ファイルをそのまま残す)。
    fn unreadable_default(&self) -> LoadedSettings {
        LoadedSettings {
            settings: Settings::default(),
            recovered_from_corruption: true,
            evacuated: false,
        }
    }

    /// v1〜v3(対象リポジトリ・GitHubプロジェクト・対象フォルダをスカラーで
    /// 持つ形)を、その3項目を1件のプロファイルへ包んだ現行バージョンへ移行
    /// する(issue #72)。プロファイルの `name` は `repository_path` の末尾
    /// フォルダ名(未設定・空なら "default")、`id` は移行時のみ固定値
    /// "default" を使う(以降 `create_profile` が払い出すIDと衝突しないよう、
    /// そちらはUUIDを使う)。保存し直しに失敗しても(パーミッション等)、この
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
            profiles: vec![profile],
            claude_projects_dir: legacy.claude_projects_dir,
            // この版には無い項目は既定で入れる(issue #459)。
            restore_running_sessions: Settings::default().restore_running_sessions,
        };
        let _ = self.save(&migrated, false);
        migrated
    }

    /// v4(プロファイル化済みだが `open_tabs` を持たない)を現行バージョンへ
    /// 移行する(issue #77)。
    fn migrate_v4_to_current_version(&self, v4: SettingsV4Raw) -> Settings {
        let migrated = Settings {
            version: CURRENT_SETTINGS_VERSION,
            profiles: v4.profiles,
            active_profile_id: v4.active_profile_id,
            claude_projects_dir: v4.claude_projects_dir,
            restore_running_sessions: Settings::default().restore_running_sessions,
        };
        let _ = self.save(&migrated, false);
        migrated
    }

    /// v5(`open_tabs` を持つが、タブバー廃止(issue #91)で不要になった)を
    /// 現行バージョンへ移行する。`open_tabs` は読み捨てるだけで他は不変。
    fn migrate_v5_to_current_version(&self, v5: SettingsV5Raw) -> Settings {
        let migrated = Settings {
            version: CURRENT_SETTINGS_VERSION,
            profiles: v5.profiles,
            active_profile_id: v5.active_profile_id,
            claude_projects_dir: v5.claude_projects_dir,
            restore_running_sessions: Settings::default().restore_running_sessions,
        };
        let _ = self.save(&migrated, false);
        migrated
    }

    /// v6(`restore_running_sessions` を持たない)を現行バージョンへ移行する(issue #459)。
    /// 既存の利用者も、次の起動から前回動かしていたセッションが再開される(既定 true)。
    fn migrate_v6_to_current_version(&self, v6: SettingsV6Raw) -> Settings {
        let migrated = Settings {
            version: CURRENT_SETTINGS_VERSION,
            profiles: v6.profiles,
            active_profile_id: v6.active_profile_id,
            claude_projects_dir: v6.claude_projects_dir,
            restore_running_sessions: Settings::default().restore_running_sessions,
        };
        let _ = self.save(&migrated, false);
        migrated
    }
}

impl SettingsStore for FileSettingsStore {
    fn load(&self) -> Result<LoadedSettings, AppError> {
        if !self.path.is_file() {
            return Ok(LoadedSettings {
                settings: Settings::default(),
                recovered_from_corruption: false,
                evacuated: false,
            });
        }

        // 読めないこと自体は、内容が壊れていることを意味しない(issue #538)。
        // ロック・ウイルス対策ソフトや同期ツールの走査中など、一時的な理由で
        // 読めないことがあるため、少し待って何度か試す。それでも読めなければ
        // (本当に読めないのか、内容が壊れているのかは区別できないので)既定値で
        // 起動するが、**退避はしない**(元ファイルをそのまま残す。中身が実は
        // 問題無い可能性があるため)。
        let mut content = None;
        for attempt in 0..READ_RETRY_ATTEMPTS {
            match fs::read_to_string(&self.path) {
                Ok(text) => {
                    content = Some(text);
                    break;
                }
                Err(_) if attempt + 1 < READ_RETRY_ATTEMPTS => {
                    std::thread::sleep(READ_RETRY_DELAY);
                }
                Err(_) => {}
            }
        }
        let Some(content) = content else {
            return Ok(self.unreadable_default());
        };

        // ここからは「読めた」ので、以降の失敗は内容そのものの問題(本当の破損)として
        // 扱い、退避する。
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
            return Ok(self.corrupted_default());
        };

        match value.get("version").and_then(serde_json::Value::as_u64) {
            Some(v) if v == CURRENT_SETTINGS_VERSION as u64 => {
                match serde_json::from_value::<Settings>(value) {
                    Ok(settings) => Ok(LoadedSettings {
                        settings,
                        recovered_from_corruption: false,
                        evacuated: false,
                    }),
                    Err(_) => Ok(self.corrupted_default()),
                }
            }
            Some(6) => match serde_json::from_value::<SettingsV6Raw>(value) {
                Ok(v6) => Ok(LoadedSettings {
                    settings: self.migrate_v6_to_current_version(v6),
                    recovered_from_corruption: false,
                    evacuated: false,
                }),
                Err(_) => Ok(self.corrupted_default()),
            },
            Some(5) => match serde_json::from_value::<SettingsV5Raw>(value) {
                Ok(v5) => Ok(LoadedSettings {
                    settings: self.migrate_v5_to_current_version(v5),
                    recovered_from_corruption: false,
                    evacuated: false,
                }),
                Err(_) => Ok(self.corrupted_default()),
            },
            Some(4) => match serde_json::from_value::<SettingsV4Raw>(value) {
                Ok(v4) => Ok(LoadedSettings {
                    settings: self.migrate_v4_to_current_version(v4),
                    recovered_from_corruption: false,
                    evacuated: false,
                }),
                Err(_) => Ok(self.corrupted_default()),
            },
            Some(1..=3) => match serde_json::from_value::<LegacySettingsRaw>(value) {
                Ok(legacy) => Ok(LoadedSettings {
                    settings: self.migrate_legacy_to_current_version(legacy),
                    recovered_from_corruption: false,
                    evacuated: false,
                }),
                Err(_) => Ok(self.corrupted_default()),
            },
            // 未知のバージョン(将来のアプリが書いたファイルを古いアプリが
            // 読む場合など)は解釈できないため、破損扱いとして退避する。
            _ => Ok(self.corrupted_default()),
        }
    }

    fn save(&self, settings: &Settings, protect_existing: bool) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| AppError::Io(format!("設定のシリアライズに失敗しました: {e}")))?;

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("{} を作成できませんでした: {e}", parent.display()))
            })?;
        }

        if protect_existing && self.path.is_file() {
            // 既定値へ復旧した直後の最初の保存(issue #538)。復旧の原因が一時的な
            // I/O エラーで、今の内容が実は有効だった場合に備え、上書きする前に
            // 複製を残す(ベストエフォート。複製に失敗しても保存自体は続ける)。
            let millis = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let file_name = self
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("settings.json");
            let backup_path = self
                .path
                .with_file_name(format!("{file_name}.before-overwrite.{millis}"));
            let _ = fs::copy(&self.path, backup_path);
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
            profiles: vec![profile],
            claude_projects_dir: Some(PathBuf::from(r"D:\custom\projects")),
            restore_running_sessions: false,
        };

        store.save(&settings, false).expect("should save");
        let loaded = store.load().expect("should load");

        assert_eq!(loaded.settings, settings);
        assert!(!loaded.recovered_from_corruption);
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = FileSettingsStore::new(path.clone());

        store
            .save(&Settings::default(), false)
            .expect("should save");

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
        assert!(loaded.evacuated, "本当に内容が壊れているので退避する");
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
        assert!(loaded.evacuated);
    }

    #[test]
    fn load_does_not_evacuate_when_the_file_cannot_be_read_but_is_not_actually_corrupt() {
        // issue #538: 読めないこと(ロック・同期ツールの読み取り中など)と内容が本当に
        // 壊れていることを区別する。無効なUTF-8バイト列は `fs::read_to_string` を
        // 「読めない(Err)」にする手軽な手段として使う(本当の原因がロック等でも
        // `read_to_string` のエラーとしては区別できないため、同じコード経路を通る)。
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, [0xFF, 0xFE, 0x00, 0x01]).unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should fall back to default");

        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.recovered_from_corruption);
        assert!(
            !loaded.evacuated,
            "読めなかっただけなので退避してはいけない"
        );
        assert!(path.is_file(), "元ファイルは残したまま");
        let corrupt_files: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".corrupt."))
            .collect();
        assert!(
            corrupt_files.is_empty(),
            "読めなかっただけでは退避ファイルを作らない"
        );
    }

    #[test]
    fn save_backs_up_the_existing_file_before_overwriting_when_protecting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"old":"content"}"#).unwrap();
        let store = FileSettingsStore::new(path.clone());

        store.save(&Settings::default(), true).expect("should save");

        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("settings.json.before-overwrite.")
            })
            .collect();
        assert_eq!(backups.len(), 1, "上書き前の内容を複製しておく");
        let backup_content = fs::read_to_string(backups[0].path()).unwrap();
        assert_eq!(backup_content, r#"{"old":"content"}"#);
        // 保存自体は普通に進む(新しい内容に置き換わる)。
        assert!(fs::read_to_string(&path).unwrap().contains("\"version\""));
    }

    #[test]
    fn save_does_not_back_up_when_there_is_nothing_to_protect() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = FileSettingsStore::new(path.clone());

        store
            .save(&Settings::default(), true)
            .expect("should save even with nothing to back up");

        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("before-overwrite"))
            .collect();
        assert!(backups.is_empty());
    }

    #[test]
    fn save_does_not_back_up_when_not_protecting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"old":"content"}"#).unwrap();
        let store = FileSettingsStore::new(path.clone());

        store
            .save(&Settings::default(), false)
            .expect("should save");

        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("before-overwrite"))
            .collect();
        assert!(backups.is_empty());
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
    fn load_migrates_v4_settings_to_current_version() {
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
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
    }

    #[test]
    fn load_migrates_v5_settings_discarding_open_tabs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // v5のJSON(タブバー廃止(issue #91)で不要になったopen_tabsを持つ)。
        fs::write(
            &path,
            r#"{"version":5,"profiles":[{"id":"p1","name":"yaoyorozu","repository_path":null,"github_project":null,"selected_project_folders":[]}],"active_profile_id":"p1","claude_projects_dir":null,"open_tabs":[{"profile_id":"p1"}]}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v5 to current version");

        assert_eq!(loaded.settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(loaded.settings.profiles.len(), 1);
        assert_eq!(loaded.settings.active_profile_id, "p1");
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
    }

    #[test]
    fn load_migrates_v6_settings_turning_session_restore_on() {
        // v6(`restore_running_sessions` を持たない)→ v7(issue #459)。既存の利用者も、
        // 次の起動から前回動かしていたセッションが再開される(既定 true)。
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":6,"profiles":[{"id":"p1","name":"yaoyorozu","repository_path":null,"github_project":null,"selected_project_folders":[]}],"active_profile_id":"p1","claude_projects_dir":"D:\\custom"}"#,
        )
        .unwrap();
        let store = FileSettingsStore::new(path.clone());

        let loaded = store.load().expect("should migrate v6 to current version");

        assert_eq!(loaded.settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(loaded.settings.active_profile_id, "p1");
        assert_eq!(
            loaded.settings.claude_projects_dir,
            Some(PathBuf::from(r"D:\custom")),
            "他の項目は移行で変えない"
        );
        assert!(loaded.settings.restore_running_sessions);
        assert!(
            !loaded.recovered_from_corruption,
            "migration is not corruption"
        );
        // 移行後の形で書き戻され、次の起動は移行なしで読める。
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("\"version\": 7"));
        assert!(store.load().unwrap().settings.restore_running_sessions);
    }

    #[test]
    fn load_keeps_session_restore_off_when_the_user_turned_it_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"version":7,"profiles":[],"active_profile_id":"p1","claude_projects_dir":null,"restore_running_sessions":false}"#,
        )
        .unwrap();

        let loaded = FileSettingsStore::new(path).load().unwrap();

        assert!(!loaded.settings.restore_running_sessions);
        assert!(!loaded.recovered_from_corruption);
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
