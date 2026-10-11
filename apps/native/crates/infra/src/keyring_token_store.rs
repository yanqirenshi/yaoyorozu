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
    use std::sync::Mutex;

    // 実キーチェーンを汚さないよう、テスト専用のサービス名(プロセスID込み)を
    // 使い、各テストの最後に必ず delete して片付ける。
    fn test_store(name: &str) -> KeyringTokenStore {
        KeyringTokenStore::with_service(format!("yaoyorozu-test-{name}-{}", std::process::id()))
    }

    // keyring クレートの README(Windows-native の節)は「Windows の資格情報
    // ストアは呼び出しの順序を保証しないので、マルチスレッドアクセスに注意する
    // こと」と明記している。このモジュールの4テストはキー名こそ別々だが、
    // cargo test は既定で各テストを別スレッドで並行実行するため、ストア全体への
    // 同時呼び出しが発生する。これが issue #604 でまれに観測された失敗
    // (save_then_load_roundtrips が9回中1回失敗)の原因と見られるため、
    // このモジュール内のテストは常に1本のスレッドからのみストアへアクセスする
    // よう、このロックで直列化する。
    static KEYCHAIN_TEST_LOCK: Mutex<()> = Mutex::new(());

    // 他のテストがロック保持中にパニックしても(poisoned)直列化自体は続ける。
    // ロックの中身は `()` で不変条件は無く、poison は無視してよい。
    fn lock_keychain() -> std::sync::MutexGuard<'static, ()> {
        KEYCHAIN_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn load_returns_none_when_nothing_saved() {
        let _guard = lock_keychain();
        let store = test_store("load-none");
        let loaded = store.load().expect("should not error when entry is absent");
        assert_eq!(loaded, None);
    }

    #[test]
    fn save_then_load_roundtrips() {
        let _guard = lock_keychain();
        let store = test_store("roundtrip");
        store.save("secret-token").expect("should save");

        let loaded = store.load().expect("should load");
        assert_eq!(loaded.as_deref(), Some("secret-token"));

        store.delete().expect("should delete");
    }

    #[test]
    fn delete_then_load_returns_none() {
        let _guard = lock_keychain();
        let store = test_store("delete");
        store.save("secret-token").expect("should save");
        store.delete().expect("should delete");

        let loaded = store.load().expect("should not error after delete");
        assert_eq!(loaded, None);
    }

    #[test]
    fn delete_is_idempotent_when_nothing_saved() {
        let _guard = lock_keychain();
        let store = test_store("delete-idempotent");
        store
            .delete()
            .expect("deleting a missing entry should not error");
    }
}
