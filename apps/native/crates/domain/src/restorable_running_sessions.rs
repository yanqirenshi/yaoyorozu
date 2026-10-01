use crate::RestorableRunningSession;

/// `RestorableRunningSessions` の現在のスキーマバージョン(他の永続化型 `Settings` 等と
/// 同じ流儀。issue #459)。
pub const CURRENT_RESTORABLE_RUNNING_SESSIONS_VERSION: u32 = 1;

/// app が起動していた実行中セッションの一覧(issue #459)。`app_data_dir/running-sessions.json`
/// へ保存し、次の app の起動で順に再開する。
///
/// 並びは**起動した順**(復元もこの順で行う)。`settings.json` には入れない(見た目の状態では
/// ないが、頻繁に書き換わり `settings:updated` を無駄に発火させないため。`hub-layout.json` と
/// 同じ考え方)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RestorableRunningSessions {
    pub version: u32,
    pub sessions: Vec<RestorableRunningSession>,
}

impl Default for RestorableRunningSessions {
    fn default() -> Self {
        Self {
            version: CURRENT_RESTORABLE_RUNNING_SESSIONS_VERSION,
            sessions: Vec::new(),
        }
    }
}

impl RestorableRunningSessions {
    /// 1件を覚える。同じ会話(`session_id`)が既にあれば、**その場所のまま**置き換える
    /// (起動し直しても並びが変わらない)。無ければ末尾に足す。
    pub fn upsert(&mut self, entry: RestorableRunningSession) {
        match self
            .sessions
            .iter_mut()
            .find(|s| s.session_id == entry.session_id)
        {
            Some(existing) => *existing = entry,
            None => self.sessions.push(entry),
        }
    }

    /// 1件を忘れる(利用者が停止・終了したとき)。無ければ何もしない。
    pub fn remove(&mut self, session_id: &str) {
        self.sessions.retain(|s| s.session_id != session_id);
    }

    /// 1件を書き換える。無ければ何もしない(すでに忘れた会話の切り替えが遅れて届いても、
    /// 復活させない)。
    pub fn update(&mut self, session_id: &str, change: impl FnOnce(&mut RestorableRunningSession)) {
        if let Some(entry) = self
            .sessions
            .iter_mut()
            .find(|s| s.session_id == session_id)
        {
            change(entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(session_id: &str, mode: &str) -> RestorableRunningSession {
        RestorableRunningSession {
            profile_id: "default".to_string(),
            project: Some("proj-a".to_string()),
            session_id: session_id.to_string(),
            permission_mode: mode.to_string(),
            model: None,
            name: None,
            worktree_id: "main-worktree".to_string(),
        }
    }

    #[test]
    fn default_is_empty_at_current_version() {
        let sessions = RestorableRunningSessions::default();

        assert_eq!(
            sessions.version,
            CURRENT_RESTORABLE_RUNNING_SESSIONS_VERSION
        );
        assert!(sessions.sessions.is_empty());
    }

    #[test]
    fn upsert_appends_new_conversations_and_replaces_the_same_one_in_place() {
        let mut sessions = RestorableRunningSessions::default();

        sessions.upsert(entry("s1", "default"));
        sessions.upsert(entry("s2", "default"));
        sessions.upsert(entry("s1", "plan"));

        let ids: Vec<&str> = sessions
            .sessions
            .iter()
            .map(|s| s.session_id.as_str())
            .collect();
        assert_eq!(ids, vec!["s1", "s2"], "並び(起動した順)は変わらない");
        assert_eq!(sessions.sessions[0].permission_mode, "plan");
    }

    #[test]
    fn remove_forgets_only_the_named_conversation() {
        let mut sessions = RestorableRunningSessions::default();
        sessions.upsert(entry("s1", "default"));
        sessions.upsert(entry("s2", "default"));

        sessions.remove("s1");
        sessions.remove("知らない会話");

        let ids: Vec<&str> = sessions
            .sessions
            .iter()
            .map(|s| s.session_id.as_str())
            .collect();
        assert_eq!(ids, vec!["s2"]);
    }

    #[test]
    fn update_changes_an_existing_entry_and_ignores_a_forgotten_one() {
        let mut sessions = RestorableRunningSessions::default();
        sessions.upsert(entry("s1", "default"));

        sessions.update("s1", |e| e.model = Some("haiku".to_string()));
        sessions.update("s2", |e| e.model = Some("opus".to_string()));

        assert_eq!(sessions.sessions[0].model.as_deref(), Some("haiku"));
        assert_eq!(sessions.sessions.len(), 1, "無い会話は復活させない");
    }
}
