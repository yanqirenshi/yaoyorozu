//! セッションのアーカイブ(issue #494)。Desktop の「アーカイブ」(会話ファイルは消さず、
//! 一覧から隠してプロセスを止める。印を外せば戻る)を app にも入れる。
//!
//! 印の読み書きだけがここの責務。実行中プロセスを先に止める処理(app が持つプロセスの検知・
//! 停止・`RunningSessionByApp` の更新)は、`AppState`(ランタイム状態)を見る必要があり、ここ
//! (domain/app)の責務を超えるため tauri 層が行う(native.md §1 の依存の向きのとおり)。

use crate::{AppError, ArchivedSessionsStore};
use domain::{is_valid_session_id, ArchivedSessions};

/// 印を付ける。`session_id` は検証済みのものだけ受け付ける(native.md §4)。
pub fn archive_session(
    store: &dyn ArchivedSessionsStore,
    session_id: &str,
) -> Result<(), AppError> {
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let mut archived = store.load()?;
    archived.archive(session_id);
    store.save(&archived)
}

/// 印を外す。利用者の明示操作に加え、アーカイブ済みの会話を起動(再開)したときにも自動で呼ぶ
/// (開いて使い始めた = 戻した、と見なす。issue #494)。
pub fn unarchive_session(
    store: &dyn ArchivedSessionsStore,
    session_id: &str,
) -> Result<(), AppError> {
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let mut archived = store.load()?;
    archived.unarchive(session_id);
    store.save(&archived)
}

/// アーカイブ済みの一覧を読み込む(`list_sessions` / `get_pc` command が `archived: bool` を
/// 差し込むために使う)。ファイルが無い・壊れている場合は空(`ArchivedSessionsStore::load` の
/// 契約)。
pub fn load_archived_sessions(
    store: &dyn ArchivedSessionsStore,
) -> Result<ArchivedSessions, AppError> {
    store.load()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeStore {
        saved: Mutex<ArchivedSessions>,
    }

    impl FakeStore {
        fn new() -> Self {
            Self {
                saved: Mutex::new(ArchivedSessions::default()),
            }
        }
    }

    impl ArchivedSessionsStore for FakeStore {
        fn load(&self) -> Result<ArchivedSessions, AppError> {
            Ok(self.saved.lock().unwrap().clone())
        }
        fn save(&self, sessions: &ArchivedSessions) -> Result<(), AppError> {
            *self.saved.lock().unwrap() = sessions.clone();
            Ok(())
        }
    }

    #[test]
    fn archive_then_unarchive_roundtrips() {
        let store = FakeStore::new();

        archive_session(&store, "s1").unwrap();
        assert!(load_archived_sessions(&store).unwrap().is_archived("s1"));

        unarchive_session(&store, "s1").unwrap();
        assert!(!load_archived_sessions(&store).unwrap().is_archived("s1"));
    }

    #[test]
    fn archiving_twice_does_not_duplicate_the_entry() {
        let store = FakeStore::new();

        archive_session(&store, "s1").unwrap();
        archive_session(&store, "s1").unwrap();

        assert_eq!(
            load_archived_sessions(&store).unwrap().session_ids,
            vec!["s1".to_string()]
        );
    }

    #[test]
    fn unarchiving_a_session_that_was_never_archived_does_nothing() {
        let store = FakeStore::new();

        unarchive_session(&store, "s1").unwrap();

        assert!(load_archived_sessions(&store)
            .unwrap()
            .session_ids
            .is_empty());
    }

    #[test]
    fn rejects_an_invalid_session_id() {
        let store = FakeStore::new();

        for bad in ["", "../x", "a/b"] {
            assert!(matches!(
                archive_session(&store, bad),
                Err(AppError::InvalidInput(_))
            ));
            assert!(matches!(
                unarchive_session(&store, bad),
                Err(AppError::InvalidInput(_))
            ));
        }
        assert!(load_archived_sessions(&store)
            .unwrap()
            .session_ids
            .is_empty());
    }
}
