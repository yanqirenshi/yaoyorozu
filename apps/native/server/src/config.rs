//! データフォルダとポートの決め方。
//!
//! MSI 版(`com.yaoyorozu.native`)のフォルダは読まない・書かない。同じフォルダを使うと
//! トークンを上書きし、後の段階では自動再開が本番のセッションに再開を試みる(native.md §8)。

use std::path::{Path, PathBuf};

/// データフォルダを上書きする環境変数。
pub const DATA_DIR_ENV_VAR: &str = "YAOYOROZU_DATA_DIR";
/// ポートを上書きする環境変数。
pub const PORT_ENV_VAR: &str = "YAOYOROZU_SERVER_PORT";
/// 既定のポート(Tauri 版のローカル API 14200 とは別)。
pub const DEFAULT_PORT: u16 = 14210;
/// 既定のデータフォルダ名(`%APPDATA%` の下)。
pub const DATA_DIR_NAME: &str = "com.yaoyorozu.server";
/// 触ってはいけない MSI 版のフォルダ名。
pub const FORBIDDEN_DIR_NAME: &str = "com.yaoyorozu.native";

/// データフォルダを決める。`env_dir` は [`DATA_DIR_ENV_VAR`] の値、`appdata` は `%APPDATA%`。
/// MSI 版のフォルダを指していたらエラーにする。
pub fn resolve_data_dir(env_dir: Option<&str>, appdata: Option<&str>) -> Result<PathBuf, String> {
    let dir = match env_dir.map(str::trim).filter(|v| !v.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => {
            let appdata = appdata
                .filter(|v| !v.is_empty())
                .ok_or("%APPDATA% が見つかりません。YAOYOROZU_DATA_DIR を指定してください")?;
            Path::new(appdata).join(DATA_DIR_NAME)
        }
    };
    if dir
        .components()
        .any(|c| c.as_os_str().eq_ignore_ascii_case(FORBIDDEN_DIR_NAME))
    {
        return Err(format!(
            "MSI 版のフォルダ({FORBIDDEN_DIR_NAME})は使えません: {}",
            dir.display()
        ));
    }
    Ok(dir)
}

/// ポートを決める。数値として読めない・`0` は既定へ戻す。
pub fn resolve_port(env_value: Option<&str>) -> u16 {
    env_value
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|&p| p != 0)
        .unwrap_or(DEFAULT_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_dir_is_under_appdata_with_the_server_name() {
        let dir = resolve_data_dir(None, Some(r"C:\Users\x\AppData\Roaming")).unwrap();
        assert!(dir.ends_with(DATA_DIR_NAME));
    }

    #[test]
    fn env_dir_overrides() {
        let dir = resolve_data_dir(Some(r"D:\data"), Some(r"C:\a")).unwrap();
        assert_eq!(dir, PathBuf::from(r"D:\data"));
    }

    #[test]
    fn the_msi_folder_is_refused() {
        assert!(resolve_data_dir(Some(r"C:\a\com.yaoyorozu.native"), None).is_err());
        assert!(resolve_data_dir(Some(r"C:\a\COM.YAOYOROZU.NATIVE\x"), None).is_err());
    }

    #[test]
    fn missing_appdata_is_an_error() {
        assert!(resolve_data_dir(None, None).is_err());
    }

    #[test]
    fn port_falls_back_to_default() {
        assert_eq!(resolve_port(None), DEFAULT_PORT);
        assert_eq!(resolve_port(Some(" 14220 ")), 14220);
        for bad in ["", "0", "x", "-1", "99999999"] {
            assert_eq!(resolve_port(Some(bad)), DEFAULT_PORT, "{bad:?}");
        }
    }
}
