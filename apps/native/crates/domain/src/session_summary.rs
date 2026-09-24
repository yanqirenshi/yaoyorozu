/// セッション一覧(ビューア左ペイン)表示用の1件分。全メッセージを読まずに
/// 一覧を出すための最小限の情報。`cwd`/`git_branch` はハブのグラフ階層
/// (issue #104)用にJSONLから抽出した値。どちらもセッションによっては
/// 記録されておらず `None` になりうる(古いセッション・実行環境の都合で
/// 記録されない場合など)。
///
/// 1件 = 1セッション(セッションID = 会話ファイル)。フォークや圧縮で別のIDの
/// ファイルに分かれた会話は、別のセッションとしてそれぞれ並ぶ(issue #369。
/// #345 で入れた「フォーク系列を最新ファイルへ畳む」扱いは廃止した)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub modified_at_ms: u64,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
}

/// 最終更新の新しい順に並べる(ビューアの一覧用。同じ更新時刻の並びは元の順を保つ)。
pub fn sort_sessions_newest_first(sessions: &mut [SessionSummary]) {
    sessions.sort_by_key(|s| std::cmp::Reverse(s.modified_at_ms));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_summary(id: &str, modified_at_ms: u64) -> SessionSummary {
        SessionSummary {
            id: id.to_string(),
            title: "title".to_string(),
            modified_at_ms,
            cwd: None,
            git_branch: None,
        }
    }

    #[test]
    fn sort_sessions_newest_first_orders_by_modified_time_descending() {
        let mut sessions = vec![
            session_summary("old", 1),
            session_summary("new", 3),
            session_summary("mid", 2),
        ];

        sort_sessions_newest_first(&mut sessions);

        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    #[test]
    fn sort_sessions_newest_first_keeps_every_session_even_with_similar_content() {
        // issue #369: フォークや圧縮で分かれたファイルも、セッションごとに全件残す。
        let mut sessions = vec![
            session_summary("fork-1", 1),
            session_summary("fork-2", 2),
            session_summary("other", 3),
        ];

        sort_sessions_newest_first(&mut sessions);

        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["other", "fork-2", "fork-1"]);
    }
}
