//! 閉じた警告(「飛ばした会話ファイル」)の印を、データフォルダに保存する(`dismissed-warnings.json`)。
//!
//! サーバを起動し直しても、閉じた警告を出し直さない。印は「ファイルの大きさ + 先頭の中身の指紋」で、更新時刻だけが
//! 変わっても(中身が同じなら)出し直さない。ファイルが実際に変わったとき(大きさか先頭が違う)だけ、また出る。

use crate::state::FileFingerprint;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

pub const FILE_NAME: &str = "dismissed-warnings.json";

/// 先頭の何バイトを指紋に使うか。
const HEAD_BYTES: usize = 4096;

/// ファイルの指紋(大きさ, 先頭 [`HEAD_BYTES`] バイトの FNV-1a)。更新時刻は使わない。読めなければ `(0, 0)`。
pub fn fingerprint(path: &Path) -> FileFingerprint {
    let Ok(meta) = std::fs::metadata(path) else {
        return (0, 0);
    };
    let mut head = Vec::new();
    if let Ok(file) = std::fs::File::open(path) {
        let _ = file.take(HEAD_BYTES as u64).read_to_end(&mut head);
    }
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in head {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    (meta.len(), hash)
}

/// 保存した印を読む(無い・壊れているときは空。起動は止めない)。
pub fn load(data_dir: &Path) -> HashMap<(String, String), FileFingerprint> {
    let path = data_dir.join(FILE_NAME);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        // 無いのはふつう(まだ何も閉じていない)。それ以外(読めない)はログに出す。
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return HashMap::new(),
        Err(e) => {
            eprintln!("{FILE_NAME} を読めませんでした(閉じた警告の印は空から始めます): {e}");
            return HashMap::new();
        }
    };
    let value = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(value) => value,
        Err(e) => {
            eprintln!("{FILE_NAME} が壊れています(閉じた警告の印は空から始めます): {e}");
            return HashMap::new();
        }
    };
    value
        .get("dismissed")
        .and_then(|d| d.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    Some((
                        (
                            row.get("project")?.as_str()?.to_string(),
                            row.get("file")?.as_str()?.to_string(),
                        ),
                        (row.get("size")?.as_u64()?, row.get("head")?.as_u64()?),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 印を保存する(失敗はログだけ。次に閉じたときに、また保存する)。
pub fn save(data_dir: &Path, dismissed: &HashMap<(String, String), FileFingerprint>) {
    let mut rows: Vec<_> = dismissed.iter().collect();
    rows.sort();
    let value = serde_json::json!({
        "version": 1,
        "dismissed": rows.iter().map(|((project, file), (size, head))| serde_json::json!({
            "project": project, "file": file, "size": size, "head": head,
        })).collect::<Vec<_>>(),
    });
    let Ok(text) = serde_json::to_string_pretty(&value) else {
        return;
    };
    if let Err(e) = crate::data_files::write_atomic(&data_dir.join(FILE_NAME), text.as_bytes()) {
        eprintln!("閉じた警告の印を保存できませんでした: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fingerprint_ignores_the_modified_time_but_sees_a_real_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.jsonl");
        std::fs::write(&path, "壊れた内容").unwrap();
        let before = fingerprint(&path);
        // 更新時刻だけを変える(中身は同じ)。
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(3600))
            .unwrap();
        drop(file);
        assert_eq!(fingerprint(&path), before);
        // 中身が変わると、指紋も変わる。
        std::fs::write(&path, "別の壊れた内容").unwrap();
        assert_ne!(fingerprint(&path), before);
    }

    #[test]
    fn saved_marks_come_back_and_a_broken_file_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let mut marks = HashMap::new();
        marks.insert(("proj".to_string(), "a.jsonl".to_string()), (10, 99));
        save(dir.path(), &marks);
        assert_eq!(load(dir.path()), marks);
        std::fs::write(dir.path().join(FILE_NAME), "壊れた").unwrap();
        assert!(load(dir.path()).is_empty());
    }
}
