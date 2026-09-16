/// セッション一覧(ビューア左ペイン)表示用の1件分。全メッセージを読まずに
/// 一覧を出すための最小限の情報。`is_latest` はそのフォルダ内で最終更新が
/// 最も新しいセッションかどうか(`--continue` で送信できるのはこれだけ。
/// issue #33)。`cwd`/`git_branch` はハブのグラフ階層(issue #104)用に
/// JSONLから抽出した値。どちらもセッションによっては記録されておらず
/// `None` になりうる(古いセッション・`gitBranch` が実行環境の都合で
/// 記録されない場合など)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub modified_at_ms: u64,
    pub is_latest: bool,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
}

/// セッション一覧を最終更新の新しい順に並べ、最初の要素(そのフォルダの
/// 最新セッション)にだけ `is_latest` を立てる(他は `false` にする)。
pub fn sort_sessions_by_recency(sessions: &mut [SessionSummary]) {
    sessions.sort_by_key(|s| std::cmp::Reverse(s.modified_at_ms));
    for (i, s) in sessions.iter_mut().enumerate() {
        s.is_latest = i == 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_summary(id: &str, modified_at_ms: u64) -> SessionSummary {
        SessionSummary {
            id: id.to_string(),
            title: "title".to_string(),
            modified_at_ms,
            is_latest: false,
            cwd: None,
            git_branch: None,
        }
    }

    #[test]
    fn sort_sessions_by_recency_orders_newest_first_and_marks_latest() {
        let mut sessions = vec![
            session_summary("old", 1),
            session_summary("new", 3),
            session_summary("mid", 2),
        ];

        sort_sessions_by_recency(&mut sessions);

        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
        assert!(sessions[0].is_latest);
        assert!(!sessions[1].is_latest);
        assert!(!sessions[2].is_latest);
    }
}
