use app::{AppError, GitStateSource};
use domain::{ObservedGitState, ObservedWorktree};
use std::path::{Path, PathBuf};
use std::process::Command;

/// `git`コマンドを実行してリポジトリの現在状態(ブランチ名一覧・worktree
/// 一覧)を観測する(オブジェクトモデル実装 第3弾。issue #193)。
///
/// 既存の`SystemGitWorktreeLister`(issue #129)を拡張せず、専用のportとして
/// 新設した。理由は`app::GitStateSource`のドキュメントコメント参照。
pub struct SystemGitStateSource;

impl SystemGitStateSource {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemGitStateSource {
    fn default() -> Self {
        Self::new()
    }
}

impl GitStateSource for SystemGitStateSource {
    fn observe(&self, repo_root: &Path) -> Result<ObservedGitState, AppError> {
        let branch_names = list_local_branch_names(repo_root)?;
        let worktree_output = run_git(repo_root, &["worktree", "list", "--porcelain"])?;
        let worktrees = parse_worktree_blocks(&worktree_output)
            .into_iter()
            // 先頭ブロックはメインの作業ツリー自身であり、`GitWorktree`としては
            // 記録しない(issue本文の明示的な指示)。
            .skip(1)
            .map(|block| ObservedWorktree {
                git_file_path: block.path.join(".git"),
                folder_path: block.path,
                checked_out_branch_name: block.branch_name,
            })
            .collect();

        Ok(ObservedGitState {
            branch_names,
            worktrees,
        })
    }
}

fn run_git(repo_root: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|e| AppError::Io(format!("git {} の実行に失敗しました: {e}", args.join(" "))))?;

    if !output.status.success() {
        return Err(AppError::Io(format!(
            "git {} が失敗しました: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn list_local_branch_names(repo_root: &Path) -> Result<Vec<String>, AppError> {
    let output = run_git(
        repo_root,
        &["for-each-ref", "refs/heads", "--format=%(refname:short)"],
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

struct WorktreeBlock {
    path: PathBuf,
    branch_name: Option<String>,
}

// `git worktree list --porcelain` の出力を、worktreeごとのブロック
// (`worktree <path>`行で始まり、空行で区切られる)に分けてパースする。
// `branch refs/heads/<name>`行があればブランチ名を、`detached`(または
// branch行自体が無い)なら`None`を記録する。`locked`/`prunable`等その他の
// 行は読み飛ばす。既存の`parse_worktree_paths`(issue #129。
// `git_worktree_lister.rs`)はパス一覧だけを拾う狭い用途のため、こちらは
// 台帳突き合わせに必要なブランチ情報も拾う専用のパーサとして分離した。
fn parse_worktree_blocks(porcelain_output: &str) -> Vec<WorktreeBlock> {
    let mut blocks = Vec::new();
    let mut current_path: Option<PathBuf> = None;
    let mut current_branch: Option<String> = None;

    let flush = |path: &mut Option<PathBuf>,
                 branch: &mut Option<String>,
                 blocks: &mut Vec<WorktreeBlock>| {
        if let Some(path) = path.take() {
            blocks.push(WorktreeBlock {
                path,
                branch_name: branch.take(),
            });
        }
    };

    for line in porcelain_output.lines() {
        if line.is_empty() {
            flush(&mut current_path, &mut current_branch, &mut blocks);
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            flush(&mut current_path, &mut current_branch, &mut blocks);
            current_path = Some(PathBuf::from(path));
        } else if let Some(branch_ref) = line.strip_prefix("branch ") {
            current_branch = Some(
                branch_ref
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch_ref)
                    .to_string(),
            );
        }
    }
    flush(&mut current_path, &mut current_branch, &mut blocks);

    blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;

    #[test]
    fn parse_worktree_blocks_extracts_path_and_branch_for_each_block() {
        let output = "worktree C:/repo/main\n\
HEAD abc123\n\
branch refs/heads/main\n\
\n\
worktree C:/repo/worktrees/feature-x\n\
HEAD def456\n\
branch refs/heads/feature-x\n\
\n\
worktree C:/repo/worktrees/detached-one\n\
HEAD ghi789\n\
detached\n";

        let blocks = parse_worktree_blocks(output);

        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0].path, PathBuf::from("C:/repo/main"));
        assert_eq!(blocks[0].branch_name, Some("main".to_string()));
        assert_eq!(blocks[1].path, PathBuf::from("C:/repo/worktrees/feature-x"));
        assert_eq!(blocks[1].branch_name, Some("feature-x".to_string()));
        assert_eq!(
            blocks[2].path,
            PathBuf::from("C:/repo/worktrees/detached-one")
        );
        assert_eq!(blocks[2].branch_name, None, "detachedはNoneになる");
    }

    #[test]
    fn parse_worktree_blocks_returns_empty_for_empty_output() {
        assert!(parse_worktree_blocks("").is_empty());
    }

    // 実際に一時ディレクトリへgitリポジトリとworktreeを作り、実プロセス
    // (git)を経由した結果を検証する(native.md §5)。
    #[test]
    fn observe_excludes_main_worktree_and_reports_branch_names_and_worktrees() {
        let repo_dir = tempfile::tempdir().unwrap();
        let repo_root = repo_dir.path().to_path_buf();

        let run = |args: &[&str], cwd: &Path| {
            let status = StdCommand::new("git")
                .args(args)
                .current_dir(cwd)
                .status()
                .expect("git should be installed");
            assert!(status.success(), "git {args:?} failed");
        };

        run(&["init", "--quiet"], &repo_root);
        run(&["config", "user.email", "test@example.com"], &repo_root);
        run(&["config", "user.name", "test"], &repo_root);
        std::fs::write(repo_root.join("README.md"), "test").unwrap();
        run(&["add", "."], &repo_root);
        run(&["commit", "--quiet", "-m", "init"], &repo_root);
        run(&["branch", "develop"], &repo_root);

        let worktree_dir = repo_dir.path().join("linked-worktree");
        run(
            &[
                "worktree",
                "add",
                worktree_dir.to_str().unwrap(),
                "-b",
                "feature-x",
            ],
            &repo_root,
        );

        let source = SystemGitStateSource::new();
        let observed = source.observe(&repo_root).expect("should observe");

        assert!(observed.branch_names.contains(&"develop".to_string()));
        assert!(observed.branch_names.contains(&"feature-x".to_string()));
        assert_eq!(observed.worktrees.len(), 1, "メインの作業ツリーは含めない");
        assert_eq!(observed.worktrees[0].folder_path, worktree_dir);
        assert_eq!(
            observed.worktrees[0].checked_out_branch_name,
            Some("feature-x".to_string())
        );
    }

    #[test]
    fn observe_returns_err_when_repo_root_is_not_a_git_repository() {
        let dir = tempfile::tempdir().unwrap();
        let source = SystemGitStateSource::new();

        let result = source.observe(dir.path());

        assert!(result.is_err());
    }
}
