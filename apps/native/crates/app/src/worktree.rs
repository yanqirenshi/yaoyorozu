//! 起動前の worktree の用意(作成・最新化)のユースケースと port(issue #437。Phase 3)。
//!
//! app が「このリポジトリの、このブランチの worktree」を用意して、そこを cwd に `claude` を
//! 起動する。`git worktree add` / `git fetch` / `git merge` は I/O なので port
//! ([`GitWorktreeManager`]。実装は infra)の責務で、ここには「どこに作るか・どの順で行うか・
//! 失敗したらどうするか」という規則だけを置く。フロントからパスは受け取らない(native.md §4):
//! 画面が渡すのは worktree_id か branch_name だけで、パスは app が決める。

use crate::AppError;
use domain::{GitLedger, MAIN_WORKTREE_ID, OUTSIDE_WORKTREE_ID};
use std::path::{Path, PathBuf};

/// 最新化(着手前の `git fetch` + `git merge`)で取り込む先のブランチ。
pub const ORIGIN_MAIN: &str = "origin/main";

/// worktree を置くフォルダ(リポジトリからの相対)。CLAUDE.md の運用(`.claude/worktrees/`)と
/// 同じ場所で、`git worktree list` の実出力から worktree と判定できる(既存の規則。native.md §7)。
const WORKTREES_DIR: &[&str] = &[".claude", "worktrees"];

/// ブランチ名の長さの上限(文字数)。
const MAX_BRANCH_CHARS: usize = 200;

/// どの worktree で起動するかの指定(画面から来る値。パスは含まない)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeSpec {
    /// リポジトリ本体で起動する(1つ目の worktree。worktree は作らない)。
    Main,
    /// 既存の worktree(台帳の `GitWorktree.worktree_id`)で起動する。
    Existing { worktree_id: String },
    /// このブランチの worktree で起動する。あればそれを使い、無ければ app が用意する
    /// (ブランチも無ければ `origin/main` から作る)。
    Branch { branch_name: String },
}

/// `git worktree list` の1件(リポジトリ本体を含む)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeEntry {
    pub path: PathBuf,
    /// チェックアウト中のブランチ名(detached HEAD は `None`)。
    pub branch_name: Option<String>,
    /// リポジトリ本体の作業ツリーか(`git worktree list` の先頭)。
    pub is_main: bool,
}

/// `git merge` の結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeOutcome {
    /// すでに最新(何も変わらなかった)。
    UpToDate,
    /// 取り込んだ。
    Merged,
    /// 競合・その他の理由で取り込めなかった(呼び出し側が `abort_merge` する)。
    Conflict { detail: String },
}

/// worktree の作成・最新化の port(実装は infra。`git` コマンドの実行)。
pub trait GitWorktreeManager: Send + Sync {
    /// `repo` の worktree の一覧(リポジトリ本体を含む。先頭が本体)。
    fn list(&self, repo: &Path) -> Result<Vec<WorktreeEntry>, AppError>;
    /// ローカルにブランチ `branch` があるか。
    fn branch_exists(&self, repo: &Path, branch: &str) -> Result<bool, AppError>;
    /// worktree を作る。`create_from` があれば、そのリビジョンからブランチ `branch` を新しく作って
    /// チェックアウトする(`git worktree add -b <branch> <path> <create_from>`)。無ければ、
    /// 既存のブランチ `branch` をチェックアウトする(`git worktree add <path> <branch>`)。
    fn add_worktree(
        &self,
        repo: &Path,
        path: &Path,
        branch: &str,
        create_from: Option<&str>,
    ) -> Result<(), AppError>;
    /// `git fetch origin`(`dir` は worktree)。
    fn fetch_origin(&self, dir: &Path) -> Result<(), AppError>;
    /// `git merge <rev>`(`dir` は worktree)。競合などで取り込めなければ [`MergeOutcome::Conflict`]。
    fn merge(&self, dir: &Path, rev: &str) -> Result<MergeOutcome, AppError>;
    /// 途中の merge を取り消す(`git merge --abort`)。merge が進行中でなくても呼んでよい。
    fn abort_merge(&self, dir: &Path);
}

/// 用意した worktree(起動の cwd になる)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedWorktree {
    /// worktree の絶対パス(起動の cwd)。
    pub path: PathBuf,
    /// チェックアウト中のブランチ名(分かれば)。
    pub branch_name: Option<String>,
    /// リポジトリ本体か。
    pub is_main: bool,
    /// このとき新しく作ったか。
    pub created: bool,
    /// 起動前の最新化(`fetch` + `merge`)を行ったか。
    pub synced: bool,
}

/// worktree を起動に使える形で用意した結果に、台帳の ID を添えたもの([`prepare_worktree`] の
/// あと、台帳へ反映してから [`WorktreeIndex::id_of`] で引く)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedWorktree {
    pub path: PathBuf,
    pub worktree_id: String,
}

/// 台帳から作る、パス → `worktree_id` の対応(リポジトリ1つぶん。issue #437)。再開のように、
/// 会話ファイルの cwd で起動するとき、その cwd がどの worktree かを記録するために使う。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorktreeIndex {
    repository_path: PathBuf,
    entries: Vec<(PathBuf, String)>,
}

impl WorktreeIndex {
    /// `ledger` の `repository_path` のリポジトリの、削除されていない worktree から作る。
    pub fn from_ledger(ledger: &GitLedger, repository_path: &Path) -> Self {
        let key = repository_path.display().to_string();
        let entries = ledger
            .repositories
            .get(&key)
            .map(|repo| {
                repo.worktrees
                    .iter()
                    .filter(|w| w.deleted_at_time.is_none())
                    .map(|w| (w.worktree_folder_path.clone(), w.worktree_id.clone()))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            repository_path: repository_path.to_path_buf(),
            entries,
        }
    }

    /// `path` の worktree の ID: リポジトリ本体なら [`MAIN_WORKTREE_ID`]、台帳の worktree ならその ID、
    /// どれでもなければ [`OUTSIDE_WORKTREE_ID`]。
    pub fn id_of(&self, path: &Path) -> String {
        if same_path(path, &self.repository_path) {
            return MAIN_WORKTREE_ID.to_string();
        }
        self.entries
            .iter()
            .find(|(folder, _)| same_path(folder, path))
            .map(|(_, id)| id.clone())
            .unwrap_or_else(|| OUTSIDE_WORKTREE_ID.to_string())
    }

    /// 台帳の `worktree_id` の worktree のパス(リポジトリ本体の予約 ID は本体のパス)。
    pub fn path_of(&self, worktree_id: &str) -> Option<PathBuf> {
        if worktree_id == MAIN_WORKTREE_ID {
            return Some(self.repository_path.clone());
        }
        self.entries
            .iter()
            .find(|(_, id)| id == worktree_id)
            .map(|(folder, _)| folder.clone())
    }

    /// `path` が台帳の worktree(リポジトリ本体を除く)として引けるか。
    pub fn knows(&self, path: &Path) -> bool {
        self.entries
            .iter()
            .any(|(folder, _)| same_path(folder, path))
    }
}

/// パスの同一判定(区切りの違い・末尾の区切り・Windows の大文字小文字を吸収する。台帳のパスは
/// `git worktree list` 由来の `/` 区切り、設定のパスは `\\` 区切りのこともある)。
pub fn same_path(a: &Path, b: &Path) -> bool {
    fn normalize(path: &Path) -> String {
        let text = path.to_string_lossy().replace('\\', "/");
        let text = text.trim_end_matches('/').to_string();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text
        }
    }
    normalize(a) == normalize(b)
}

/// ブランチ名の検証(フロントから受け取る値。git の参照名の規則を絞った形で、パスの構築と
/// コマンド引数に使って安全なものだけを通す)。
pub fn validate_branch_name(name: &str) -> Result<(), AppError> {
    let invalid = |reason: &str| {
        Err(AppError::InvalidInput(format!(
            "不正なブランチ名です({reason}): {name}"
        )))
    };
    if name.is_empty() {
        return invalid("空です");
    }
    if name.chars().count() > MAX_BRANCH_CHARS {
        return invalid("長すぎます");
    }
    if name.starts_with('-') || name.starts_with('/') || name.ends_with('/') || name.ends_with('.')
    {
        return invalid("先頭・末尾に使えない文字があります");
    }
    if name == "@" || name.contains("..") || name.contains("@{") || name.contains("//") {
        return invalid("使えない並びを含みます");
    }
    if name.ends_with(".lock") {
        return invalid(".lock で終わっています");
    }
    if name
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || " ~^:?*[\\".contains(c))
    {
        return invalid("使えない文字を含みます");
    }
    if name.split('/').any(|part| part.starts_with('.')) {
        return invalid("`.` で始まる部分があります");
    }
    Ok(())
}

/// ブランチ名から、worktree のフォルダ名を機械的に決める(issue #437)。英数字・`.`・`_`・`-`
/// 以外(`/` を含む)を `-` にし、連続する `-` は1つにまとめ、先頭・末尾の `-` と `.` は落とす。
/// 理由: フォルダ名は1階層に収めたく(`feature/x` を入れ子にすると、ブランチの削除後に空の
/// 親フォルダが残る)、Windows で使えない文字を避ける必要があるため。名前から一意に決まるので、
/// 同じブランチは常に同じ場所になる(あとから探せる)。衝突(`a/b` と `a-b`)は
/// [`prepare_worktree`] が検出して断る。
pub fn worktree_dir_name(branch: &str) -> Result<String, AppError> {
    validate_branch_name(branch)?;
    let mut name = String::new();
    for c in branch.chars() {
        let mapped = if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            c
        } else {
            '-'
        };
        if mapped == '-' && name.ends_with('-') {
            continue;
        }
        name.push(mapped);
    }
    let name = name.trim_matches(|c| c == '-' || c == '.').to_string();
    if name.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "ブランチ名からフォルダ名を決められません: {branch}"
        )));
    }
    Ok(name)
}

/// worktree を置くパス: `<repository_path>/.claude/worktrees/<フォルダ名>`。
pub fn worktree_path(repository_path: &Path, branch: &str) -> Result<PathBuf, AppError> {
    let mut path = repository_path.to_path_buf();
    for part in WORKTREES_DIR {
        path.push(part);
    }
    path.push(worktree_dir_name(branch)?);
    Ok(path)
}

/// 起動前の最新化: `git fetch origin` → `git merge origin/main`。競合(など取り込めない場合)は
/// `git merge --abort` で元に戻し、起動を止める理由を返す(黙って進めない)。
fn sync_with_origin_main(manager: &dyn GitWorktreeManager, dir: &Path) -> Result<(), AppError> {
    manager.fetch_origin(dir)?;
    match manager.merge(dir, ORIGIN_MAIN)? {
        MergeOutcome::UpToDate | MergeOutcome::Merged => Ok(()),
        MergeOutcome::Conflict { detail } => {
            manager.abort_merge(dir);
            Err(AppError::WorktreeSyncFailed(format!(
                "{} へ {ORIGIN_MAIN} を取り込めませんでした(競合など)。取り込みは取り消して、起動を止めました。手動で解消してから開き直してください。\n{detail}",
                dir.display()
            )))
        }
    }
}

/// `spec` の worktree を用意する(必要なら作り、起動前に最新化する)。
///
/// 順序: 場所を決める → (無ければ)作る → 最新化(`sync` が真のとき)。最新化に失敗したら
/// `Err`(呼び出し側は起動しない)。リポジトリ本体([`WorktreeSpec::Main`] と、本体がチェックアウト
/// 中のブランチの指定)は最新化しない: 本体は利用者が直接使う作業ツリーで、未コミットの変更が
/// あり得るため、勝手に merge しない(判断は PR に記録)。
///
/// `index` は台帳から作った ID → パスの対応(`Existing` の解決に使う)。
pub fn prepare_worktree(
    manager: &dyn GitWorktreeManager,
    repository_path: &Path,
    spec: &WorktreeSpec,
    index: &WorktreeIndex,
    sync: bool,
) -> Result<PreparedWorktree, AppError> {
    match spec {
        WorktreeSpec::Main => Ok(PreparedWorktree {
            path: repository_path.to_path_buf(),
            branch_name: None,
            is_main: true,
            created: false,
            synced: false,
        }),
        WorktreeSpec::Existing { worktree_id } => {
            let path = index.path_of(worktree_id).ok_or_else(|| {
                AppError::NotFound("指定された worktree が見つかりません".to_string())
            })?;
            let entries = manager.list(repository_path)?;
            let entry = entries
                .iter()
                .find(|e| same_path(&e.path, &path))
                .ok_or_else(|| {
                    AppError::NotFound(format!(
                        "worktree が存在しません(削除された可能性があります): {}",
                        path.display()
                    ))
                })?;
            finish_existing(manager, entry, sync)
        }
        WorktreeSpec::Branch { branch_name } => {
            validate_branch_name(branch_name)?;
            let entries = manager.list(repository_path)?;
            if let Some(entry) = entries
                .iter()
                .find(|e| e.branch_name.as_deref() == Some(branch_name.as_str()))
            {
                return finish_existing(manager, entry, sync);
            }
            let path = worktree_path(repository_path, branch_name)?;
            if entries.iter().any(|e| same_path(&e.path, &path)) || path.exists() {
                return Err(AppError::InvalidInput(format!(
                    "worktree の置き場所がすでに使われています(別のブランチの worktree と名前が衝突しています): {}",
                    path.display()
                )));
            }
            // ブランチが無ければ origin/main から作る。origin/main は最新にしてから使う。
            let create_from = if manager.branch_exists(repository_path, branch_name)? {
                None
            } else {
                if sync {
                    manager.fetch_origin(repository_path)?;
                }
                Some(ORIGIN_MAIN)
            };
            manager.add_worktree(repository_path, &path, branch_name, create_from)?;
            if sync {
                // 作ったばかりの(origin/main から作った)ものは、すでに最新。既存のブランチを
                // チェックアウトした場合だけ取り込む必要がある。
                if create_from.is_none() {
                    sync_with_origin_main(manager, &path)?;
                }
            }
            Ok(PreparedWorktree {
                path,
                branch_name: Some(branch_name.clone()),
                is_main: false,
                created: true,
                synced: sync,
            })
        }
    }
}

/// すでにある worktree を使う(本体は最新化しない)。
fn finish_existing(
    manager: &dyn GitWorktreeManager,
    entry: &WorktreeEntry,
    sync: bool,
) -> Result<PreparedWorktree, AppError> {
    let do_sync = sync && !entry.is_main;
    if do_sync {
        sync_with_origin_main(manager, &entry.path)?;
    }
    Ok(PreparedWorktree {
        path: entry.path.clone(),
        branch_name: entry.branch_name.clone(),
        is_main: entry.is_main,
        created: false,
        synced: do_sync,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{GitRepositoryLedger, GitWorktree};
    use std::sync::Mutex;

    /// ログ用に、区切りを `/` にそろえた文字列にする(Windows の `\` を吸収する)。
    fn norm(path: &Path) -> String {
        path.display().to_string().replace('\\', "/")
    }

    /// 呼ばれた操作を記録するフェイク。
    #[derive(Default)]
    struct FakeManager {
        entries: Vec<WorktreeEntry>,
        branches: Vec<String>,
        merge_outcome: Option<MergeOutcome>,
        fail_fetch: bool,
        calls: Mutex<Vec<String>>,
    }

    impl FakeManager {
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl GitWorktreeManager for FakeManager {
        fn list(&self, _repo: &Path) -> Result<Vec<WorktreeEntry>, AppError> {
            self.calls.lock().unwrap().push("list".to_string());
            Ok(self.entries.clone())
        }
        fn branch_exists(&self, _repo: &Path, branch: &str) -> Result<bool, AppError> {
            Ok(self.branches.iter().any(|b| b == branch))
        }
        fn add_worktree(
            &self,
            _repo: &Path,
            path: &Path,
            branch: &str,
            create_from: Option<&str>,
        ) -> Result<(), AppError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("add {} {branch} from={create_from:?}", norm(path)));
            Ok(())
        }
        fn fetch_origin(&self, dir: &Path) -> Result<(), AppError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("fetch {}", norm(dir)));
            if self.fail_fetch {
                return Err(AppError::Io("network down".to_string()));
            }
            Ok(())
        }
        fn merge(&self, dir: &Path, rev: &str) -> Result<MergeOutcome, AppError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("merge {} {rev}", norm(dir)));
            Ok(self.merge_outcome.clone().unwrap_or(MergeOutcome::Merged))
        }
        fn abort_merge(&self, dir: &Path) {
            self.calls
                .lock()
                .unwrap()
                .push(format!("abort {}", norm(dir)));
        }
    }

    fn repo() -> PathBuf {
        PathBuf::from("/repo")
    }

    fn main_entry() -> WorktreeEntry {
        WorktreeEntry {
            path: repo(),
            branch_name: Some("main".to_string()),
            is_main: true,
        }
    }

    fn wt_entry(dir: &str, branch: &str) -> WorktreeEntry {
        WorktreeEntry {
            path: PathBuf::from(format!("/repo/.claude/worktrees/{dir}")),
            branch_name: Some(branch.to_string()),
            is_main: false,
        }
    }

    fn ledger_with(worktrees: Vec<GitWorktree>) -> GitLedger {
        let mut ledger = GitLedger::default();
        ledger.repositories.insert(
            "/repo".to_string(),
            GitRepositoryLedger {
                branches: Vec::new(),
                worktrees,
            },
        );
        ledger
    }

    fn ledger_worktree(id: &str, folder: &str, deleted: Option<u64>) -> GitWorktree {
        GitWorktree {
            worktree_id: id.to_string(),
            worktree_name: folder.rsplit('/').next().unwrap().to_string(),
            description: String::new(),
            worktree_folder_path: PathBuf::from(folder),
            worktree_git_file_path: PathBuf::from(format!("{folder}/.git")),
            created_at_time: 1,
            deleted_at_time: deleted,
            checked_out_branch: None,
        }
    }

    fn empty_index() -> WorktreeIndex {
        WorktreeIndex::from_ledger(&GitLedger::default(), &repo())
    }

    // ---- 名前・場所 ----

    #[test]
    fn the_folder_name_is_derived_from_the_branch_name_mechanically() {
        assert_eq!(
            worktree_dir_name("session/impl-app").unwrap(),
            "session-impl-app"
        );
        assert_eq!(worktree_dir_name("feature/a/b").unwrap(), "feature-a-b");
        assert_eq!(worktree_dir_name("fix_1.2").unwrap(), "fix_1.2");
        assert!(worktree_dir_name("日本語/ブランチ")
            .unwrap_err()
            .to_string()
            .contains("フォルダ名"));
        assert_eq!(
            worktree_path(&repo(), "session/impl-app").unwrap(),
            PathBuf::from("/repo/.claude/worktrees/session-impl-app")
        );
    }

    #[test]
    fn unsafe_or_invalid_branch_names_are_rejected() {
        for bad in [
            "", "-x", "/x", "x/", "x.", "a..b", "a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b",
            "a\\b", "x.lock", "a//b", ".hidden", "a/.b", "@", "a@{b}", "a\nb",
        ] {
            assert!(
                matches!(validate_branch_name(bad), Err(AppError::InvalidInput(_))),
                "{bad:?}"
            );
        }
        assert!(validate_branch_name(&"x".repeat(201)).is_err());
        for good in ["main", "session/impl-app", "feature/x_y-1.2", "日本語"] {
            assert!(validate_branch_name(good).is_ok(), "{good:?}");
        }
    }

    // ---- 用意 ----

    #[test]
    fn main_uses_the_repository_itself_without_touching_git() {
        let manager = FakeManager::default();

        let prepared =
            prepare_worktree(&manager, &repo(), &WorktreeSpec::Main, &empty_index(), true).unwrap();

        assert_eq!(prepared.path, repo());
        assert!(prepared.is_main && !prepared.created && !prepared.synced);
        assert!(manager.calls().is_empty(), "本体は作らず、最新化もしない");
    }

    #[test]
    fn a_missing_branch_gets_a_new_worktree_from_origin_main_after_fetching() {
        let manager = FakeManager {
            entries: vec![main_entry()],
            ..FakeManager::default()
        };

        let prepared = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "session/x".to_string(),
            },
            &empty_index(),
            true,
        )
        .unwrap();

        assert_eq!(
            prepared.path,
            PathBuf::from("/repo/.claude/worktrees/session-x")
        );
        assert!(prepared.created && prepared.synced);
        // fetch → add(origin/main から)の順。作ったばかりなので、merge はしない。
        assert_eq!(
            manager.calls(),
            vec![
                "list".to_string(),
                "fetch /repo".to_string(),
                "add /repo/.claude/worktrees/session-x session/x from=Some(\"origin/main\")"
                    .to_string(),
            ]
        );
    }

    #[test]
    fn an_existing_local_branch_without_a_worktree_is_checked_out_then_synced() {
        let manager = FakeManager {
            entries: vec![main_entry()],
            branches: vec!["session/x".to_string()],
            ..FakeManager::default()
        };

        let prepared = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "session/x".to_string(),
            },
            &empty_index(),
            true,
        )
        .unwrap();

        assert!(prepared.created);
        assert_eq!(
            manager.calls(),
            vec![
                "list".to_string(),
                "add /repo/.claude/worktrees/session-x session/x from=None".to_string(),
                "fetch /repo/.claude/worktrees/session-x".to_string(),
                "merge /repo/.claude/worktrees/session-x origin/main".to_string(),
            ]
        );
    }

    #[test]
    fn a_branch_that_already_has_a_worktree_reuses_it_and_syncs_it() {
        let manager = FakeManager {
            entries: vec![main_entry(), wt_entry("session-x", "session/x")],
            ..FakeManager::default()
        };

        let prepared = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "session/x".to_string(),
            },
            &empty_index(),
            true,
        )
        .unwrap();

        assert!(!prepared.created && prepared.synced && !prepared.is_main);
        assert_eq!(prepared.branch_name.as_deref(), Some("session/x"));
        assert_eq!(
            manager.calls(),
            vec![
                "list".to_string(),
                "fetch /repo/.claude/worktrees/session-x".to_string(),
                "merge /repo/.claude/worktrees/session-x origin/main".to_string(),
            ]
        );
    }

    #[test]
    fn the_branch_checked_out_in_the_main_worktree_is_used_as_is_without_merging() {
        let manager = FakeManager {
            entries: vec![main_entry()],
            ..FakeManager::default()
        };

        let prepared = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "main".to_string(),
            },
            &empty_index(),
            true,
        )
        .unwrap();

        assert!(prepared.is_main && !prepared.synced);
        assert_eq!(manager.calls(), vec!["list".to_string()]);
    }

    #[test]
    fn syncing_can_be_turned_off() {
        let manager = FakeManager {
            entries: vec![main_entry(), wt_entry("session-x", "session/x")],
            ..FakeManager::default()
        };

        let prepared = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "session/x".to_string(),
            },
            &empty_index(),
            false,
        )
        .unwrap();

        assert!(!prepared.synced);
        assert_eq!(manager.calls(), vec!["list".to_string()]);
    }

    #[test]
    fn a_conflict_aborts_the_merge_and_stops_the_start_with_the_reason() {
        let manager = FakeManager {
            entries: vec![main_entry(), wt_entry("session-x", "session/x")],
            merge_outcome: Some(MergeOutcome::Conflict {
                detail: "CONFLICT (content): Merge conflict in a.txt".to_string(),
            }),
            ..FakeManager::default()
        };

        let error = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "session/x".to_string(),
            },
            &empty_index(),
            true,
        )
        .unwrap_err();

        let AppError::WorktreeSyncFailed(message) = error else {
            panic!("expected WorktreeSyncFailed");
        };
        assert!(
            message.contains("a.txt") && message.contains("session-x"),
            "{message}"
        );
        assert!(
            manager
                .calls()
                .contains(&"abort /repo/.claude/worktrees/session-x".to_string()),
            "競合したら merge --abort する"
        );
    }

    #[test]
    fn a_failed_fetch_stops_the_start_instead_of_going_on_silently() {
        let manager = FakeManager {
            entries: vec![main_entry(), wt_entry("session-x", "session/x")],
            fail_fetch: true,
            ..FakeManager::default()
        };

        let result = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "session/x".to_string(),
            },
            &empty_index(),
            true,
        );

        assert!(matches!(result, Err(AppError::Io(_))));
        assert!(!manager.calls().iter().any(|c| c.starts_with("merge")));
    }

    #[test]
    fn a_colliding_folder_name_of_another_branch_is_refused() {
        // `a/b` と `a-b` は同じフォルダ名になる。
        let manager = FakeManager {
            entries: vec![main_entry(), wt_entry("a-b", "a-b")],
            ..FakeManager::default()
        };

        let result = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Branch {
                branch_name: "a/b".to_string(),
            },
            &empty_index(),
            true,
        );

        assert!(matches!(result, Err(AppError::InvalidInput(m)) if m.contains("衝突")));
        assert!(!manager.calls().iter().any(|c| c.starts_with("add")));
    }

    #[test]
    fn an_existing_worktree_is_found_by_its_ledger_id() {
        let manager = FakeManager {
            entries: vec![main_entry(), wt_entry("session-x", "session/x")],
            ..FakeManager::default()
        };
        let index = WorktreeIndex::from_ledger(
            &ledger_with(vec![ledger_worktree(
                "id-1",
                "/repo/.claude/worktrees/session-x",
                None,
            )]),
            &repo(),
        );

        let prepared = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Existing {
                worktree_id: "id-1".to_string(),
            },
            &index,
            true,
        )
        .unwrap();

        assert_eq!(
            prepared.path,
            PathBuf::from("/repo/.claude/worktrees/session-x")
        );
        assert!(prepared.synced);
    }

    #[test]
    fn an_unknown_or_vanished_worktree_id_is_not_found() {
        let manager = FakeManager {
            entries: vec![main_entry()],
            ..FakeManager::default()
        };
        let index = WorktreeIndex::from_ledger(
            &ledger_with(vec![ledger_worktree(
                "id-1",
                "/repo/.claude/worktrees/gone",
                None,
            )]),
            &repo(),
        );

        let unknown = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Existing {
                worktree_id: "nope".to_string(),
            },
            &index,
            false,
        );
        let vanished = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Existing {
                worktree_id: "id-1".to_string(),
            },
            &index,
            false,
        );

        assert!(matches!(unknown, Err(AppError::NotFound(_))));
        assert!(matches!(vanished, Err(AppError::NotFound(_))));
    }

    #[test]
    fn the_main_reserved_id_resolves_to_the_repository() {
        let manager = FakeManager {
            entries: vec![main_entry()],
            ..FakeManager::default()
        };

        let prepared = prepare_worktree(
            &manager,
            &repo(),
            &WorktreeSpec::Existing {
                worktree_id: MAIN_WORKTREE_ID.to_string(),
            },
            &empty_index(),
            true,
        )
        .unwrap();

        assert!(prepared.is_main && !prepared.synced);
    }

    // ---- 台帳との対応 ----

    #[test]
    fn the_index_maps_paths_to_ids_with_main_and_outside_as_reserved_ids() {
        let ledger = ledger_with(vec![
            ledger_worktree("id-1", "/repo/.claude/worktrees/session-x", None),
            ledger_worktree("id-gone", "/repo/.claude/worktrees/old", Some(5)),
        ]);
        let index = WorktreeIndex::from_ledger(&ledger, &repo());

        assert_eq!(index.id_of(&repo()), MAIN_WORKTREE_ID);
        assert_eq!(
            index.id_of(Path::new("/repo/.claude/worktrees/session-x")),
            "id-1"
        );
        // 削除済みの worktree は引けない。リポジトリの外は outside。
        assert_eq!(
            index.id_of(Path::new("/repo/.claude/worktrees/old")),
            OUTSIDE_WORKTREE_ID
        );
        assert_eq!(index.id_of(Path::new("/elsewhere")), OUTSIDE_WORKTREE_ID);
        assert!(index.knows(Path::new("/repo/.claude/worktrees/session-x")));
        assert!(!index.knows(&repo()));
    }

    #[test]
    fn path_comparison_ignores_separator_style_and_a_trailing_separator() {
        assert!(same_path(
            Path::new("C:\\repo\\wt"),
            Path::new("C:/repo/wt/")
        ));
        assert!(!same_path(Path::new("/repo/a"), Path::new("/repo/b")));
    }
}
