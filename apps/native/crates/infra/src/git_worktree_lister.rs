use app::{AppError, GitWorktreeLister};
use std::path::{Path, PathBuf};
use std::process::Command;

/// `git worktree list --porcelain` を実行して worktree の絶対パス一覧を得る
/// (issue #129)。`repo_root` がリポジトリでない/gitが無い等の失敗は
/// `AppError::Io` として呼び出し側(app層)へ伝え、fail-closed(未登録扱い)
/// にする判断は呼び出し側に委ねる。
pub struct SystemGitWorktreeLister;

impl SystemGitWorktreeLister {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemGitWorktreeLister {
    fn default() -> Self {
        Self::new()
    }
}

impl GitWorktreeLister for SystemGitWorktreeLister {
    fn list_worktree_paths(&self, repo_root: &Path) -> Result<Vec<PathBuf>, AppError> {
        let output = Command::new("git")
            .args(["worktree", "list", "--porcelain"])
            .current_dir(repo_root)
            .output()
            .map_err(|e| AppError::Io(format!("git worktree list の実行に失敗しました: {e}")))?;

        if !output.status.success() {
            return Err(AppError::Io(format!(
                "git worktree list が失敗しました: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        Ok(parse_worktree_paths(&String::from_utf8_lossy(
            &output.stdout,
        )))
    }
}

// `--porcelain` の出力は各worktreeにつき `worktree <絶対パス>` の行を先頭に持つ
// ブロックが空行区切りで並ぶ形式。ここではそのパス行だけを拾う。
fn parse_worktree_paths(porcelain_output: &str) -> Vec<PathBuf> {
    porcelain_output
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .map(PathBuf::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;

    #[test]
    fn parse_worktree_paths_extracts_all_worktree_lines() {
        let output = "worktree C:/Users/yanqi/prj/yaoyorozu\n\
HEAD abc123\n\
branch refs/heads/main\n\
\n\
worktree C:/Users/yanqi/prj/yaoyorozu/.claude/worktrees/foo\n\
HEAD def456\n\
branch refs/heads/feature-x\n";

        let paths = parse_worktree_paths(output);

        assert_eq!(
            paths,
            vec![
                PathBuf::from("C:/Users/yanqi/prj/yaoyorozu"),
                PathBuf::from("C:/Users/yanqi/prj/yaoyorozu/.claude/worktrees/foo"),
            ]
        );
    }

    #[test]
    fn parse_worktree_paths_returns_empty_for_empty_output() {
        assert_eq!(parse_worktree_paths(""), Vec::<PathBuf>::new());
    }

    // 実際に一時ディレクトリへgitリポジトリとworktreeを作り、実プロセス
    // (git)を経由した結果を検証する(native.md §5: 実ユーザーディレクトリは
    // 触らない)。
    #[test]
    fn list_worktree_paths_includes_main_and_linked_worktrees() {
        let repo_dir = tempfile::tempdir().unwrap();
        // `canonicalize()` はWindowsで `\\?\` 拡張長パス接頭辞を付与してしまい、
        // gitが出力する素のドライブレター表記と一致しなくなるため使わない。
        let repo_root = repo_dir.path().to_path_buf();

        let run_git = |args: &[&str], cwd: &Path| {
            let status = StdCommand::new("git")
                .args(args)
                .current_dir(cwd)
                .status()
                .expect("git should be installed");
            assert!(status.success(), "git {args:?} failed");
        };

        run_git(&["init", "--quiet"], &repo_root);
        run_git(&["config", "user.email", "test@example.com"], &repo_root);
        run_git(&["config", "user.name", "test"], &repo_root);
        std::fs::write(repo_root.join("README.md"), "test").unwrap();
        run_git(&["add", "."], &repo_root);
        run_git(&["commit", "--quiet", "-m", "init"], &repo_root);

        let worktree_dir = repo_dir.path().join("linked-worktree");
        run_git(
            &[
                "worktree",
                "add",
                worktree_dir.to_str().unwrap(),
                "-b",
                "feature-x",
            ],
            &repo_root,
        );

        let lister = SystemGitWorktreeLister::new();
        let paths = lister
            .list_worktree_paths(&repo_root)
            .expect("should list worktrees");

        assert!(paths.contains(&repo_root));
        assert!(paths.contains(&worktree_dir));
    }
}
