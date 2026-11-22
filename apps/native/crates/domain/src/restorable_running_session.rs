/// app が起動していた実行中セッション1件の「再開に必要な指定」(issue #459)。app の起動時に
/// 前回動かしていたセッションを自動で再開するために、起動・停止・切り替えのたびに保存する
/// (`app_data_dir/running-sessions.json`)。
///
/// **パスは持たない**(native.md §4)。cwd・リポジトリは再開のときに app が
/// プロファイル・会話ファイル・Git 台帳から解決する。worktree も、パスではなく台帳の ID
/// (リポジトリ本体は予約 ID `main-worktree`、リポジトリ外は `outside-repository`)で覚える。
///
/// 会話ごとに1件(鍵は `session_id`。同じ会話の二重起動は app が止めるため、重複しない)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RestorableRunningSession {
    /// どのプロファイルで起動していたか。
    pub profile_id: String,
    /// 会話ファイルのあるプロジェクトフォルダ名。新しく始めてまだ会話ファイルが無いものは
    /// `None`(`--resume` で開き直せないため、復元では飛ばす)。
    pub project: Option<String>,
    pub session_id: String,
    /// 権限モード(CLI に渡す値。途中で切り替えていれば**現在の**値)。
    pub permission_mode: String,
    /// 起動のときに選んだモデルの別名(`--model` に渡す値。`None` は CLI の既定)。
    /// 途中で切り替えたら、そのときの別名に更新する。`system/init` が報告する
    /// 実際のモデル名(`claude-haiku-4-5-…` など)は**入れない**(版が変わると古くなるため。
    /// issue #445 で起動時の指定を別名に限っているのと同じ理由)。
    pub model: Option<String>,
    /// 起動のときに付けた表示名(`--name`。一意化したあとの値)。
    pub name: Option<String>,
    /// 起動していた worktree の ID(Git 台帳の ID、または予約 ID)。
    pub worktree_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_through_json() {
        let entry = RestorableRunningSession {
            profile_id: "default".to_string(),
            project: Some("proj-a".to_string()),
            session_id: "s1".to_string(),
            permission_mode: "plan".to_string(),
            model: Some("opus".to_string()),
            name: Some("実装:APP".to_string()),
            worktree_id: "main-worktree".to_string(),
        };

        let json = serde_json::to_string(&entry).unwrap();

        assert_eq!(
            serde_json::from_str::<RestorableRunningSession>(&json).unwrap(),
            entry
        );
    }
}
