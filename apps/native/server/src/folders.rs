//! 設定に保存する・読み書きの起点にするフォルダのパスの検証(形 + ドライブの種類)。
//!
//! 形の規則は `domain::LocalFolderPath`(`app::validate_folder_path`)の 1 か所。ここでは、それに加えて
//! **ネットワークのドライブ**(`net use` で割り当てた `X:\`。形はローカルでも中身は SMB)を断る
//! (存在の確認・保存・読み書きの前に、`GetDriveTypeW` でドライブの種類を見る。ネットワークへの
//! 問い合わせはしない)。`subst` のドライブは、解決した先がローカルなら固定ドライブとして返るので通る。

use std::path::{Path, PathBuf};

/// パスの文字列を検証する(形 → ドライブの種類)。
pub fn guard_folder_path(raw: &str) -> Result<PathBuf, app::AppError> {
    let path = app::validate_folder_path(raw)?;
    ensure_local_drive(&path)?;
    Ok(path)
}

/// ネットワークのドライブ上のパスを断る。
pub fn ensure_local_drive(path: &Path) -> Result<(), app::AppError> {
    if infra::drive_kind(path) == infra::DriveKind::Remote {
        let drive: String = path.to_string_lossy().chars().take(2).collect();
        return Err(app::AppError::InvalidInput(format!(
            "ネットワークのドライブ({drive})は使えません。このマシンのドライブ上のフォルダを指定してください"
        )));
    }
    Ok(())
}
