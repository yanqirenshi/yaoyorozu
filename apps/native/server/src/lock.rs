//! データフォルダの排他(`server.lock`)。
//!
//! 同じデータフォルダを 2 つのサーバが使うと、トークン・ポート・実行中セッションの台帳が食い違う。
//! `server.lock` を**共有なし(`share_mode(0)`)で開き、プロセスが終わるまで持つ**ことで、2 つ目を断る。
//! 強制終了でも OS がハンドルを閉じるので、ロックが残り続けることはない(ファイルは残っても、もう開ける)。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;

pub const LOCK_FILE_NAME: &str = "server.lock";

/// ロックを持っている間だけ生きる。落とすと(プロセスの終わりを含む)解ける。
#[derive(Debug)]
pub struct DataDirLock {
    _file: File,
}

impl DataDirLock {
    /// データフォルダの `server.lock` を排他で開く。ほかのサーバが持っていれば断る。
    ///
    /// トークン・ポートの書き込み、古い一時ファイルの掃除より**前**に呼ぶ(2 つ目が何も壊さないように)。
    pub fn acquire(data_dir: &Path) -> Result<Self, String> {
        let path = data_dir.join(LOCK_FILE_NAME);
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(0)
            .open(&path)
            .map_err(|e| {
                // 共有違反(32)・アクセス拒否(5): ほかのサーバが持っている。
                if matches!(e.raw_os_error(), Some(32) | Some(5)) {
                    "このデータフォルダはほかのサーバが使っています".to_string()
                } else {
                    format!("ロックファイルを開けません({}): {e}", path.display())
                }
            })?;
        // 確認用に自分の PID を書く(排他なので、ほかのプロセスは読めない。人が見るのは終了後)。
        let _ = file.set_len(0);
        let _ = write!(file, "{}", std::process::id());
        let _ = file.flush();
        Ok(Self { _file: file })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_lock_on_the_same_folder_is_refused_until_the_first_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let first = DataDirLock::acquire(dir.path()).unwrap();
        let err = DataDirLock::acquire(dir.path()).unwrap_err();
        assert_eq!(err, "このデータフォルダはほかのサーバが使っています");
        drop(first);
        DataDirLock::acquire(dir.path()).unwrap();
    }
}
