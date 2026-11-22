//! データフォルダの中への書き込み(トークン・ポートなど)。実体は infra の `write_atomic`
//! (保存ごとに別の名前の一時ファイルを新規作成 → fsync → rename。リンク先を書き換えない)。

use std::path::Path;

/// `path` へ `content` をアトミックに書く。
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    infra::write_atomic(path, content).map_err(|e| format!("{e:?}"))
}

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
