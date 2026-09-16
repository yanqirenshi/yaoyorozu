use crate::{GitBranch, GitWorktree};
use std::collections::HashMap;

/// `GitLedger` の現在のスキーマバージョン。`HubLayout`(issue #121)と同じ
/// 流儀で最初から持たせておく(issue #193)。
pub const CURRENT_GIT_LEDGER_VERSION: u32 = 1;

/// 1リポジトリ分の台帳(issue #193)。クラス図上の型ではなく、
/// [`GitLedger`]が抱える小さな入れ物(`GitRepository`本体は`settings`から
/// 都度組み立てるため永続化しない。issue #189の`current_pc_with_repositories`
/// 参照)。
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct GitRepositoryLedger {
    pub branches: Vec<GitBranch>,
    pub worktrees: Vec<GitWorktree>,
}

/// 登録済み全リポジトリの`GitBranch`/`GitWorktree`台帳(issue #193)。
/// `settings.json`・`hub-layout.json`とは別ファイル(`git-ledger.json`)に
/// 保存する。gitコマンドの実行コストが高いため`GitRepository`(issue #189)
/// のようにクエリのたびに都度組み立てることはせず、起動時とハブの
/// 再読み込み操作時にのみ突き合わせ(reconcile)を行い、結果を`AppState`に
/// 保持する(`app::reconcile_git_ledger`のドキュメントコメント参照)。
///
/// キーはリポジトリの個体指定子(`GitRepository.repository_path`の文字列
/// 表現)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitLedger {
    pub version: u32,
    pub repositories: HashMap<String, GitRepositoryLedger>,
}

impl Default for GitLedger {
    fn default() -> Self {
        Self {
            version: CURRENT_GIT_LEDGER_VERSION,
            repositories: HashMap::new(),
        }
    }
}
