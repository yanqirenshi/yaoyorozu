//! Windows の 8.3 形式(短い名前。`TAROYA~1` など)の求め方。
//!
//! ユーザー名のフォルダは、長い名前でも 8.3 形式の別名を持つことがある。エラーの文面からユーザー名を消すとき
//! (`server/src/redact.rs`)、ホームのフォルダの 8.3 形式も同じ対象にするために使う。

use std::os::windows::ffi::OsStrExt;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::GetShortPathNameW;

/// `path`(存在するフォルダ・ファイル)の 8.3 形式。求められない(存在しない・8.3 が無効なボリューム)・
/// 元と同じときは `None`。
pub fn short_path_name(path: &str) -> Option<String> {
    let wide: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `wide` は 0 終端の有効な文字列。出力先は `len` 要素の有効なバッファ。
    unsafe {
        let len = GetShortPathNameW(PCWSTR(wide.as_ptr()), None);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        let written = GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buf));
        if written == 0 || written as usize > buf.len() {
            return None;
        }
        let short = String::from_utf16_lossy(&buf[..written as usize]);
        (short != path).then_some(short)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_path_has_no_short_name() {
        assert_eq!(
            short_path_name(
                r"C:	hisdoes
otexist-at-all"
            ),
            None
        );
    }

    #[test]
    fn a_long_folder_name_gets_its_8_3_alias_when_the_volume_makes_one() {
        let dir = tempfile::tempdir().unwrap();
        let long = dir.path().join("a-very-long-folder-name-for-the-test");
        std::fs::create_dir(&long).unwrap();
        let long_text = long.to_string_lossy().to_string();
        // 8.3 が無効なボリュームでは `None`(その場合は確かめない)。
        if let Some(short) = short_path_name(&long_text) {
            assert!(short.contains('~'), "{short}");
            assert!(!short.contains("a-very-long-folder-name"), "{short}");
        }
    }
}
