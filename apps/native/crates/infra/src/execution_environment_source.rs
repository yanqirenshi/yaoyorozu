use app::{AppError, ExecutionEnvironmentSource};
use domain::{Pc, User};
use std::path::PathBuf;

/// 個々の項目の取得に失敗した際のプレースホルダ(issue #182)。アプリを
/// 止めず、警告を出しつつこの値で起動する。
const UNKNOWN_PLACEHOLDER: &str = "unknown";

/// Windows実行環境から `Pc`/`User` を組み立てる(issue #182)。
pub struct WindowsExecutionEnvironmentSource;

impl WindowsExecutionEnvironmentSource {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WindowsExecutionEnvironmentSource {
    fn default() -> Self {
        Self::new()
    }
}

impl ExecutionEnvironmentSource for WindowsExecutionEnvironmentSource {
    fn current_pc(&self) -> Result<Pc, AppError> {
        let system_uuid = resolve_or_placeholder(
            read_machine_guid().ok(),
            "system_uuid(レジストリ MachineGuid)",
        );
        let pc_name = resolve_or_placeholder(
            std::env::var("COMPUTERNAME").ok(),
            "pc_name(環境変数 COMPUTERNAME)",
        );
        let user_id =
            resolve_or_placeholder(std::env::var("USERNAME").ok(), "user_id(環境変数 USERNAME)");
        let home_directory = resolve_home_directory(
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .ok(),
        );

        Ok(Pc {
            system_uuid,
            pc_name,
            description: String::new(),
            users: vec![User {
                // OSはユーザーIDと表示名を分けて簡単には取得できないため、
                // 当面は同じ値を使う(issue #182)。
                user_name: user_id.clone(),
                user_id,
                home_directory,
            }],
        })
    }
}

/// 値が取得できた(かつ空文字でない)場合はそのまま使い、そうでなければ
/// 警告を出しつつプレースホルダで代替する(issue #182: 取得失敗時はアプリを
/// 止めない)。
fn resolve_or_placeholder(value: Option<String>, field_description: &str) -> String {
    match value {
        Some(v) if !v.is_empty() => v,
        _ => {
            eprintln!("{field_description} の取得に失敗しました。プレースホルダで続行します。");
            UNKNOWN_PLACEHOLDER.to_string()
        }
    }
}

fn resolve_home_directory(value: Option<String>) -> PathBuf {
    match value {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => {
            eprintln!(
                "home_directory(環境変数 USERPROFILE/HOME) の取得に失敗しました。空のパスで続行します。"
            );
            PathBuf::new()
        }
    }
}

#[cfg(target_os = "windows")]
fn read_machine_guid() -> Result<String, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
        .map_err(|e| e.to_string())?;
    key.get_value("MachineGuid").map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn read_machine_guid() -> Result<String, String> {
    Err("このOSでは system_uuid の取得に対応していません".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_or_placeholder_uses_the_value_when_present_and_non_empty() {
        assert_eq!(
            resolve_or_placeholder(Some("MY-PC".to_string()), "pc_name"),
            "MY-PC"
        );
    }

    #[test]
    fn resolve_or_placeholder_falls_back_when_missing() {
        assert_eq!(resolve_or_placeholder(None, "pc_name"), UNKNOWN_PLACEHOLDER);
    }

    #[test]
    fn resolve_or_placeholder_falls_back_when_empty() {
        assert_eq!(
            resolve_or_placeholder(Some(String::new()), "pc_name"),
            UNKNOWN_PLACEHOLDER
        );
    }

    #[test]
    fn resolve_home_directory_uses_the_value_when_present_and_non_empty() {
        assert_eq!(
            resolve_home_directory(Some(r"C:\Users\yanqi".to_string())),
            PathBuf::from(r"C:\Users\yanqi")
        );
    }

    #[test]
    fn resolve_home_directory_falls_back_to_empty_path_when_missing() {
        assert_eq!(resolve_home_directory(None), PathBuf::new());
    }
}
