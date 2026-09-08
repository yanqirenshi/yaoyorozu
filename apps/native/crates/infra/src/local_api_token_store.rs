use app::{AppError, LocalApiTokenStore};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// ローカルAPIサーバの認証トークンを `app_data_dir/local-api-token` へ保存
/// する(issue #122)。アプリはこのファイルを読み返さない(起動のたびに
/// 新規生成して上書きする、書き込み専用の値)ため、`FileSettingsStore` の
/// ような読み込み・破損時退避のロジックは無い。アトミック書き込みだけは
/// 他ストアと同じ流儀(`*.tmp` へ書く → fsync → rename)にし、連携先が
/// 書き込み途中のファイルを読んでしまうことを防ぐ。
pub struct FileLocalApiTokenStore {
    path: PathBuf,
}

impl FileLocalApiTokenStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl LocalApiTokenStore for FileLocalApiTokenStore {
    fn save(&self, token: &str) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("{} を作成できませんでした: {e}", parent.display()))
            })?;
        }

        let tmp_path = PathBuf::from(format!("{}.tmp", self.path.display()));
        let mut file = fs::File::create(&tmp_path).map_err(|e| {
            AppError::Io(format!("{} の作成に失敗しました: {e}", tmp_path.display()))
        })?;
        file.write_all(token.as_bytes()).map_err(|e| {
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
    fn save_writes_the_token_to_the_given_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local-api-token");
        let store = FileLocalApiTokenStore::new(path.clone());

        store.save("secret-token").expect("should save");

        assert_eq!(fs::read_to_string(&path).unwrap(), "secret-token");
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local-api-token");
        let store = FileLocalApiTokenStore::new(path.clone());

        store.save("secret-token").expect("should save");

        assert!(path.is_file());
        assert!(!dir.path().join("local-api-token.tmp").exists());
    }

    #[test]
    fn save_overwrites_the_previous_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local-api-token");
        let store = FileLocalApiTokenStore::new(path.clone());

        store.save("old-token").expect("should save");
        store.save("new-token").expect("should overwrite");

        assert_eq!(fs::read_to_string(&path).unwrap(), "new-token");
    }
}
