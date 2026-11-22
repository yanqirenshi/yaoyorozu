use app::{AppError, LocalApiPortStore};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// ローカルAPIサーバが実際に使っているポートを `app_data_dir/local-api-port` へ保存する
/// (issue #470)。`FileLocalApiTokenStore` と同じ流儀: アプリはこのファイルを読み返さない
/// (起動のたびに上書きする、書き込み専用の値)。書き込みはアトミック(`*.tmp` へ書く →
/// fsync → rename)。
///
/// トークンと同じディレクトリへ書く(apps/web の Route Handler がトークンと同じ流儀で
/// 読めるようにするため。issue #470)。
pub struct FileLocalApiPortStore {
    path: PathBuf,
}

impl FileLocalApiPortStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl LocalApiPortStore for FileLocalApiPortStore {
    fn save(&self, port: u16) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!("{} を作成できませんでした: {e}", parent.display()))
            })?;
        }

        let tmp_path = PathBuf::from(format!("{}.tmp", self.path.display()));
        let mut file = fs::File::create(&tmp_path).map_err(|e| {
            AppError::Io(format!("{} の作成に失敗しました: {e}", tmp_path.display()))
        })?;
        file.write_all(port.to_string().as_bytes()).map_err(|e| {
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
    fn save_writes_the_port_to_the_given_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local-api-port");
        let store = FileLocalApiPortStore::new(path.clone());

        store.save(14200).expect("should save");

        assert_eq!(fs::read_to_string(&path).unwrap(), "14200");
    }

    #[test]
    fn save_writes_atomically_leaving_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local-api-port");
        let store = FileLocalApiPortStore::new(path.clone());

        store.save(14200).expect("should save");

        assert!(path.is_file());
        assert!(!dir.path().join("local-api-port.tmp").exists());
    }

    #[test]
    fn save_overwrites_the_previous_port() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local-api-port");
        let store = FileLocalApiPortStore::new(path.clone());

        store.save(14200).expect("should save");
        store.save(14201).expect("should overwrite");

        assert_eq!(fs::read_to_string(&path).unwrap(), "14201");
    }
}
