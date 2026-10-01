/// `ArchivedSessions` の現在のスキーマバージョン(他の永続化型 `RestorableRunningSessions` 等と
/// 同じ流儀。issue #494)。
pub const CURRENT_ARCHIVED_SESSIONS_VERSION: u32 = 1;

/// アーカイブ済みのセッション ID の集合(issue #494)。Desktop の「アーカイブ」(会話ファイルは
/// 消さず、一覧から隠してプロセスを止める。印を外せば戻る)を app にも入れるための印。
///
/// 会話ファイル(jsonl)には触らない。セッション ID は全体で一意なので、プロファイルをまたいで
/// 同じ印を参照する(`app_data_dir/archived-sessions.json` に1つだけ持つ)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ArchivedSessions {
    pub version: u32,
    pub session_ids: Vec<String>,
}

impl Default for ArchivedSessions {
    fn default() -> Self {
        Self {
            version: CURRENT_ARCHIVED_SESSIONS_VERSION,
            session_ids: Vec::new(),
        }
    }
}

impl ArchivedSessions {
    /// 印が付いているか。
    pub fn is_archived(&self, session_id: &str) -> bool {
        self.session_ids.iter().any(|id| id == session_id)
    }

    /// 印を付ける。すでに付いていれば何もしない(同じ会話を重ねて呼んでも増えない)。
    pub fn archive(&mut self, session_id: &str) {
        if !self.is_archived(session_id) {
            self.session_ids.push(session_id.to_string());
        }
    }

    /// 印を外す。付いていなければ何もしない。
    pub fn unarchive(&mut self, session_id: &str) {
        self.session_ids.retain(|id| id != session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_empty_at_current_version() {
        let archived = ArchivedSessions::default();

        assert_eq!(archived.version, CURRENT_ARCHIVED_SESSIONS_VERSION);
        assert!(archived.session_ids.is_empty());
    }

    #[test]
    fn archive_is_idempotent_and_unarchive_removes_only_the_named_session() {
        let mut archived = ArchivedSessions::default();

        archived.archive("s1");
        archived.archive("s2");
        archived.archive("s1");

        assert_eq!(
            archived.session_ids,
            vec!["s1".to_string(), "s2".to_string()]
        );
        assert!(archived.is_archived("s1"));
        assert!(!archived.is_archived("知らない会話"));

        archived.unarchive("s1");
        archived.unarchive("知らない会話");

        assert_eq!(archived.session_ids, vec!["s2".to_string()]);
        assert!(!archived.is_archived("s1"));
    }
}
