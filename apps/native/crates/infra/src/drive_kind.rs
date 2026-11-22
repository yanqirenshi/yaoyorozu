//! ドライブの種類(ローカルか、ネットワークか)。
//!
//! `net use` で割り当てたドライブは、形は `X:\` でも中身はネットワーク(SMB)で、存在の確認や読み書きが
//! 宛先への通信になる(応答しない宛先では長く止まる)。このアプリは同じマシンのフォルダだけを扱うので、
//! 設定に保存するパスや確認するパスは、ドライブの種類を見て、ネットワークのドライブを断る。
//! 判定は Win32 の `GetDriveTypeW`(ネットワークへの問い合わせはしない)。`subst` のドライブは、
//! 解決した先がローカルなら固定ドライブとして返るので、そのまま通る。

use std::path::Path;

/// ドライブの種類(断るかどうかの判断に要る分だけ)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveKind {
    /// 固定・リムーバブル・光学・RAM ディスクなど、このマシンの中のドライブ。
    Local,
    /// ネットワークのドライブ(`DRIVE_REMOTE`)。
    Remote,
    /// 種類を判定できない(存在しないドライブ文字など)。断らない(存在の確認が「無い」と答える)。
    Unknown,
}

/// `GetDriveTypeW` の戻り値を分類する(テストできるように純粋な関数にしてある)。
/// 0 = `DRIVE_UNKNOWN`、1 = `DRIVE_NO_ROOT_DIR`、2 = 取り外し可能、3 = 固定、4 = `DRIVE_REMOTE`、
/// 5 = 光学、6 = RAM ディスク。
pub fn classify_drive_type(code: u32) -> DriveKind {
    match code {
        4 => DriveKind::Remote,
        0 | 1 => DriveKind::Unknown,
        _ => DriveKind::Local,
    }
}

/// `path`(`X:\…` の形。検証済み)が乗っているドライブの種類。`X:` で始まらなければ `Unknown`。
pub fn drive_kind(path: &Path) -> DriveKind {
    let text = path.to_string_lossy();
    let mut chars = text.chars();
    let (Some(letter), Some(':')) = (chars.next(), chars.next()) else {
        return DriveKind::Unknown;
    };
    if !letter.is_ascii_alphabetic() {
        return DriveKind::Unknown;
    }
    let root = format!("{}:\\", letter.to_ascii_uppercase());
    let code = unsafe {
        windows::Win32::Storage::FileSystem::GetDriveTypeW(&windows::core::HSTRING::from(root))
    };
    classify_drive_type(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_drive_type_codes() {
        assert_eq!(classify_drive_type(4), DriveKind::Remote);
        assert_eq!(classify_drive_type(3), DriveKind::Local);
        assert_eq!(classify_drive_type(2), DriveKind::Local);
        assert_eq!(classify_drive_type(5), DriveKind::Local);
        assert_eq!(classify_drive_type(6), DriveKind::Local);
        assert_eq!(classify_drive_type(0), DriveKind::Unknown);
        assert_eq!(classify_drive_type(1), DriveKind::Unknown);
    }

    #[test]
    fn the_drive_of_the_temp_folder_is_local_and_a_missing_drive_is_not_refused() {
        let temp = std::env::temp_dir();
        assert_eq!(drive_kind(&temp), DriveKind::Local, "{}", temp.display());
        // 割り当てのないドライブ文字(後ろから探す)。
        let unused = ('D'..='Z')
            .rev()
            .map(|c| format!("{c}:\\"))
            .find(|root| !Path::new(root).exists())
            .expect("未使用のドライブ文字がある");
        assert_ne!(drive_kind(Path::new(&unused)), DriveKind::Remote);
    }

    #[test]
    fn paths_that_do_not_start_with_a_drive_are_unknown() {
        assert_eq!(drive_kind(Path::new(r"\\host\share")), DriveKind::Unknown);
        assert_eq!(drive_kind(Path::new("relative")), DriveKind::Unknown);
    }
}
