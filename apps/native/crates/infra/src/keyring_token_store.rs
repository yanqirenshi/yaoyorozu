use app::{AppError, TokenStore};

/// GitHubアクセストークンをOSのキーチェーン(Windows Credential Manager等)に
/// 保管する。設定ファイル(JSON)には保存しない(native.md §4)。
pub struct KeyringTokenStore {
    service: String,
    username: String,
}

impl KeyringTokenStore {
    pub fn new() -> Self {
        Self {
            service: "yaoyorozu".to_string(),
            username: "github-token".to_string(),
        }
    }

    #[cfg(test)]
    fn with_service(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            username: "github-token".to_string(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, AppError> {
        keyring::Entry::new(&self.service, &self.username)
            .map_err(|e| AppError::Io(format!("キーチェーンへのアクセスに失敗しました: {e}")))
    }
}

impl Default for KeyringTokenStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore for KeyringTokenStore {
    fn save(&self, token: &str) -> Result<(), AppError> {
        self.entry()?
            .set_password(token)
            .map_err(|e| AppError::Io(format!("トークンの保存に失敗しました: {e}")))
    }

    fn load(&self) -> Result<Option<String>, AppError> {
        match self.entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Io(format!("トークンの取得に失敗しました: {e}"))),
        }
    }

    fn delete(&self) -> Result<(), AppError> {
        match self.entry()?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Io(format!("トークンの削除に失敗しました: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 実キーチェーンを汚さないよう、テスト専用のサービス名(プロセスID込み)を
    // 使い、各テストの最後に必ず delete して片付ける。
    fn test_store(name: &str) -> KeyringTokenStore {
        KeyringTokenStore::with_service(format!("yaoyorozu-test-{name}-{}", std::process::id()))
    }

    #[test]
    fn load_returns_none_when_nothing_saved() {
        let store = test_store("load-none");
        let loaded = store.load().expect("should not error when entry is absent");
        assert_eq!(loaded, None);
    }

    #[test]
    fn save_then_load_roundtrips() {
        let store = test_store("roundtrip");
        store.save("secret-token").expect("should save");

        let loaded = store.load().expect("should load");
        assert_eq!(loaded.as_deref(), Some("secret-token"));

        store.delete().expect("should delete");
    }

    #[test]
    fn delete_then_load_returns_none() {
        let store = test_store("delete");
        store.save("secret-token").expect("should save");
        store.delete().expect("should delete");

        let loaded = store.load().expect("should not error after delete");
        assert_eq!(loaded, None);
    }

    #[test]
    fn delete_is_idempotent_when_nothing_saved() {
        let store = test_store("delete-idempotent");
        store
            .delete()
            .expect("deleting a missing entry should not error");
    }
}
