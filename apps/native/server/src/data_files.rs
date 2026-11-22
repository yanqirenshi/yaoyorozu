//! データフォルダの中への書き込み(トークン・ポート)。
//!
//! 一時ファイルは**新規作成に限る**(`create_new`)。既にある(ハードリンク・シンボリックリンクを
//! 含む)場合にリンク先を書き換えないため、名前を変えて作り直す。置換は `rename` なので、
//! 置換先がリンクでも、リンクそのものが差し替わるだけでリンク先の中身は変わらない。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// `path` へ `content` をアトミックに書く(一時ファイルへ新規作成 → fsync → rename)。
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} の親フォルダがありません", path.display()))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} のファイル名が不正です", path.display()))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    for attempt in 0..100u32 {
        let tmp: PathBuf = parent.join(format!(
            "{name}.{}.{nanos}.{attempt}.tmp",
            std::process::id()
        ));
        // `create_new` は、同名のものが既にあれば(リンクでも)失敗する。そのときは名前を変える。
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("{} の作成に失敗しました: {e}", tmp.display())),
        };
        let result = file
            .write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("{} への書き込みに失敗しました: {e}", tmp.display()))
            .and_then(|_| {
                fs::rename(&tmp, path)
                    .map_err(|e| format!("{} への置換に失敗しました: {e}", path.display()))
            });
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        return result;
    }
    Err(format!(
        "{} の一時ファイルを作れませんでした",
        path.display()
    ))
}

/// 既存の `<path>.tmp`(infra の保存が `File::create` で使う固定名)を取り除く。
/// ハードリンクなどで作られていると、infra の保存がリンク先を上書きしてしまうため、
/// 保存の直前に**エントリだけ**を消す(リンク先の中身は消えない)。
pub fn remove_stale_tmp(path: &Path) {
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    if fs::symlink_metadata(&tmp).is_ok() {
        let _ = fs::remove_file(&tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_replaces_without_leaving_tmp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server-token");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_hard_linked_old_tmp_file_is_never_written_through() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim.txt");
        fs::write(&victim, "precious").unwrap();
        let path = dir.path().join("server-token");
        // 古い固定名の一時ファイルがハードリンクで残っている状況。
        let linked = dir.path().join("server-token.tmp");
        fs::hard_link(&victim, &linked).unwrap();

        write_atomic(&path, b"new-token").unwrap();

        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new-token");
    }

    #[test]
    fn replacing_a_hard_linked_destination_does_not_change_the_link_target() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim.txt");
        fs::write(&victim, "precious").unwrap();
        let path = dir.path().join("server-port");
        fs::hard_link(&victim, &path).unwrap();

        write_atomic(&path, b"14210").unwrap();

        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert_eq!(fs::read_to_string(&path).unwrap(), "14210");
    }

    #[test]
    fn remove_stale_tmp_removes_the_entry_but_not_the_link_target() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim.txt");
        fs::write(&victim, "precious").unwrap();
        let path = dir.path().join("settings.json");
        let linked = dir.path().join("settings.json.tmp");
        fs::hard_link(&victim, &linked).unwrap();

        remove_stale_tmp(&path);

        assert!(!linked.exists());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
    }
}
