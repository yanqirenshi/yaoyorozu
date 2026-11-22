//! データフォルダの中への書き込み(トークン・ポートなど)。実体は infra の `write_atomic`
//! (保存ごとに別の名前の一時ファイルを新規作成 → fsync → rename。リンク先を書き換えない)。

use std::path::Path;

/// `path` へ `content` をアトミックに書く。
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    infra::write_atomic(path, content).map_err(|e| format!("{e:?}"))
}

/// 起動時に、**データフォルダの中だけ**、`write_atomic` が作った古い一時ファイルを消す(保存の途中で
/// プロセスが止められると残る)。消すのは、名前が `<名前>.<pid>.<時刻>.<連番>.tmp` の形の通常のファイルで、
/// 最後の更新から [`STALE_TMP_AGE`] 以上たったものだけ(リンクはたどらない)。リポジトリや `~/.claude` の
/// 中に残ったものは、勝手に消さない(呼ばない)。消した名前を返す。
pub fn cleanup_stale_tmp(data_dir: &Path) -> Vec<String> {
    infra::remove_stale_write_atomic_tmp_files(data_dir, STALE_TMP_AGE)
}

/// 古い一時ファイルとみなす経過時間。保存中のものを消さないよう、長めにとる。
pub const STALE_TMP_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60);

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
        fs::hard_link(&victim, dir.path().join("server-token.tmp")).unwrap();

        write_atomic(&path, b"new-token").unwrap();

        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new-token");
    }
}
