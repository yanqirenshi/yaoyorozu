use app::{AppError, LayoutStore};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// レイアウトJSON(`apps/web/src/data/layout/<diagram>.json`)への汎用
/// アトミック書き込み(issue #122)。書き込み先パスの組み立て・検証は
/// `app::save_layout` の責務で、ここでは解決済みパスへの書き込みだけを行う。
/// `FileSettingsStore` と同じ流儀(`*.tmp` へ書く → fsync → rename)だが、
/// この用途に読み込み・マイグレーションは無いため保存のみ実装する。
pub struct FileLayoutStore;

impl FileLayoutStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FileLayoutStore {
    fn default() -> Self {
        Self::new()
    }
}

impl LayoutStore for FileLayoutStore {
    fn save(&self, path: &Path, content: &serde_json::Value) -> Result<(), AppError> {
        let json = serde_json::to_string_pretty(content)
            .map_err(|e| AppError::Io(format!("レイアウトのシリアライズに失敗しました: {e}")))?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("{} を作成できませんでした: {e}", parent.display()))
            })?;
        }

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
        fs::rename(&tmp_path, path)
            .map_err(|e| AppError::Io(format!("{} への置換に失敗しました: {e}", path.display())))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_writes_pretty_json_to_the_given_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("sitemap.json");
        let store = FileLayoutStore::new();
        let content = serde_json::json!({ "nodeA": { "x": 1, "y": 2 } });

        store.save(&path, &content).expect("should save");

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved, content);
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sitemap.json");
        let store = FileLayoutStore::new();

        store
            .save(&path, &serde_json::json!({}))
            .expect("should save");

        assert!(path.is_file());
        assert!(!dir.path().join("sitemap.json.tmp").exists());
    }

    #[test]
    fn save_overwrites_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sitemap.json");
        let store = FileLayoutStore::new();

        store
            .save(&path, &serde_json::json!({ "old": true }))
            .expect("should save");
        store
            .save(&path, &serde_json::json!({ "new": true }))
            .expect("should overwrite");

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved, serde_json::json!({ "new": true }));
    }
}
