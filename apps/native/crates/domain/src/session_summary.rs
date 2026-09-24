use std::collections::HashMap;

/// セッション一覧(ビューア左ペイン)表示用の1件分。全メッセージを読まずに
/// 一覧を出すための最小限の情報。`cwd`/`git_branch` はハブのグラフ階層
/// (issue #104)用にJSONLから抽出した値。どちらもセッションによっては
/// 記録されておらず `None` になりうる(古いセッション・実行環境の都合で
/// 記録されない場合など)。
///
/// `root_uuid` は会話チェーンの根(最初の `parentUuid: null` 行の `uuid`)。
/// セッションの再開のたびに新しい `session_id` でファイルがフォークされ、
/// 旧ファイルの履歴を丸ごと複製する(reports/claude-session-jsonl-format.md
/// §8)ため、同じ会話が複数ファイルとして一覧に重複して並ぶ。`root_uuid` は
/// この「フォーク系列」を束ねる鍵として使う(issue #345。
/// [`collapse_session_series`] 参照)。走査に失敗した等で取得できなければ
/// `None`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub modified_at_ms: u64,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub root_uuid: Option<String>,
}

/// フォーク系列(`root_uuid` が同じ会話ファイル群)ごとに、最終更新が最も
/// 新しいファイル(そのフォークは旧ファイルの履歴を丸ごと複製するため、
/// 最新ファイルだけで会話全体を表示・継続できる)だけを残し、新しい順に
/// 並べて返す(issue #345)。`root_uuid` が取得できなかったセッションは、
/// 自分自身の `id` を鍵にした単独の系列として扱う(誤って別セッションと
/// まとめない)。
pub fn collapse_session_series(sessions: Vec<SessionSummary>) -> Vec<SessionSummary> {
    let mut latest_by_key: HashMap<String, SessionSummary> = HashMap::new();
    for session in sessions {
        let key = session
            .root_uuid
            .clone()
            .unwrap_or_else(|| session.id.clone());
        match latest_by_key.get(&key) {
            Some(existing) if existing.modified_at_ms >= session.modified_at_ms => {}
            _ => {
                latest_by_key.insert(key, session);
            }
        }
    }
    let mut result: Vec<SessionSummary> = latest_by_key.into_values().collect();
    result.sort_by_key(|s| std::cmp::Reverse(s.modified_at_ms));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_summary(id: &str, modified_at_ms: u64, root_uuid: Option<&str>) -> SessionSummary {
        SessionSummary {
            id: id.to_string(),
            title: "title".to_string(),
            modified_at_ms,
            cwd: None,
            git_branch: None,
            root_uuid: root_uuid.map(String::from),
        }
    }

    #[test]
    fn collapse_session_series_orders_newest_first() {
        let sessions = vec![
            session_summary("old", 1, None),
            session_summary("new", 3, None),
            session_summary("mid", 2, None),
        ];

        let collapsed = collapse_session_series(sessions);

        let ids: Vec<&str> = collapsed.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    #[test]
    fn collapse_session_series_keeps_only_the_latest_file_per_root_uuid() {
        let sessions = vec![
            session_summary("fork-1", 1, Some("root-a")),
            session_summary("fork-2", 2, Some("root-a")),
            session_summary("other", 3, Some("root-b")),
        ];

        let collapsed = collapse_session_series(sessions);

        let ids: Vec<&str> = collapsed.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["other", "fork-2"],
            "fork-1は同系列のfork-2に畳まれて消える"
        );
    }

    #[test]
    fn collapse_session_series_treats_missing_root_uuid_as_its_own_series() {
        let sessions = vec![session_summary("a", 1, None), session_summary("b", 2, None)];

        let collapsed = collapse_session_series(sessions);

        let ids: Vec<&str> = collapsed.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["b", "a"],
            "root_uuid不明のセッション同士はまとめない"
        );
    }
}
