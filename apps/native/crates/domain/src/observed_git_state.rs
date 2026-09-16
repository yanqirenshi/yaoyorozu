use std::path::PathBuf;

/// 1つのworktreeについて、gitコマンドから観測した生の状態(issue #193)。
/// `GitWorktree`(台帳のレコード)そのものではない点に注意: ID・作成/削除
/// 時刻は台帳側が持つ情報であり、観測結果には含まれない。`checked_out_branch`
/// は観測時点のブランチ**名**(detachedなら`None`)で、台帳のブランチID解決は
/// [`crate::reconcile_worktrees`] の呼び出し元が行う。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedWorktree {
    pub folder_path: PathBuf,
    pub git_file_path: PathBuf,
    pub checked_out_branch_name: Option<String>,
}

/// 1リポジトリ分の観測結果(issue #193)。`GitStateSource` port(app層)の
/// 戻り値として使う、[`reconcile_branches`](crate::reconcile_branches)・
/// [`reconcile_worktrees`](crate::reconcile_worktrees)への入力データ。
/// メインの作業ツリー([`ObservedWorktree`]としては記録しない。issue本文の
/// 明示的な指示)は観測の時点(infra)で除外済みであること。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ObservedGitState {
    pub branch_names: Vec<String>,
    pub worktrees: Vec<ObservedWorktree>,
}
