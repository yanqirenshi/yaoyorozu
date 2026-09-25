//! worktree の作成・最新化を `git` コマンドで行う(issue #437。Phase 3)。
//!
//! `git worktree list` / `git worktree add` / `git fetch origin` / `git merge` / `git merge --abort`。
//! どこにどの順で行うか(規則)は `app::prepare_worktree` にあり、ここはコマンドの実行と出力の
//! 解釈だけ。認証の入力待ちで固まらないよう `GIT_TERMINAL_PROMPT=0` を付け、ネットワークを使う
//! コマンドには時間の上限を付ける。

use app::{AppError, GitWorktreeManager, MergeOutcome, WorktreeEntry};
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// ネットワークを使う・時間のかかりうるコマンドの上限。
const NETWORK_TIMEOUT: Duration = Duration::from_secs(120);

/// 失敗の説明に含める出力の長さ(文字数)。
const DETAIL_CHARS: usize = 600;

/// Windows で、子プロセスのコンソールウィンドウを出さない(`CREATE_NO_WINDOW`)。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `git` コマンドで worktree を扱う [`GitWorktreeManager`] の実装。
#[derive(Debug, Clone, Default)]
pub struct SystemGitWorktreeManager;

impl SystemGitWorktreeManager {
    pub fn new() -> Self {
        Self
    }
}

/// `git` の実行結果。
struct GitOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

impl GitOutput {
    /// 失敗の説明(標準エラーを優先し、無ければ標準出力。長ければ切る)。
    fn detail(&self) -> String {
        let text = if self.stderr.trim().is_empty() {
            &self.stdout
        } else {
            &self.stderr
        };
        text.trim().chars().take(DETAIL_CHARS).collect()
    }
}

fn run_git(dir: &Path, args: &[&str], timeout: Duration) -> Result<GitOutput, AppError> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(dir)
        // 認証の入力待ちで固まらない(失敗として返す)。merge のメッセージ編集も開かない。
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| AppError::Io(format!("git {} の実行に失敗しました: {e}", args.join(" "))))?;

    // 出力はパイプが詰まらないよう別スレッドで読む。
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_thread = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut text);
        }
        text
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut text);
        }
        text
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::Timeout(format!(
                    "git {} が時間内に終わりませんでした",
                    args.join(" ")
                )));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                return Err(AppError::Io(format!(
                    "git {} の終了を確かめられませんでした: {e}",
                    args.join(" ")
                )))
            }
        }
    };
    Ok(GitOutput {
        success: status.success(),
        stdout: stdout_thread.join().unwrap_or_default(),
        stderr: stderr_thread.join().unwrap_or_default(),
    })
}

/// 失敗したら `AppError::Io`(説明つき)にする。
fn run_git_ok(dir: &Path, args: &[&str], timeout: Duration) -> Result<GitOutput, AppError> {
    let output = run_git(dir, args, timeout)?;
    if output.success {
        Ok(output)
    } else {
        Err(AppError::Io(format!(
            "git {} が失敗しました: {}",
            args.join(" "),
            output.detail()
        )))
    }
}

/// `git worktree list --porcelain` の出力を [`WorktreeEntry`] の列にする。各ブロックは
/// `worktree <パス>` の行で始まり、`branch refs/heads/<名前>`(detached は `detached`)を持つ。
/// 先頭のブロックがリポジトリ本体。
fn parse_worktree_entries(porcelain: &str) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    for line in porcelain.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            entries.push(WorktreeEntry {
                path: path.into(),
                branch_name: None,
                is_main: entries.is_empty(),
            });
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(entry) = entries.last_mut() {
                entry.branch_name = Some(
                    branch
                        .strip_prefix("refs/heads/")
                        .unwrap_or(branch)
                        .to_string(),
                );
            }
        }
    }
    entries
}

impl GitWorktreeManager for SystemGitWorktreeManager {
    fn list(&self, repo: &Path) -> Result<Vec<WorktreeEntry>, AppError> {
        let output = run_git_ok(
            repo,
            &["worktree", "list", "--porcelain"],
            Duration::from_secs(30),
        )?;
        Ok(parse_worktree_entries(&output.stdout))
    }

    fn branch_exists(&self, repo: &Path, branch: &str) -> Result<bool, AppError> {
        let reference = format!("refs/heads/{branch}");
        let output = run_git(
            repo,
            &["show-ref", "--verify", "--quiet", &reference],
            Duration::from_secs(30),
        )?;
        Ok(output.success)
    }

    fn add_worktree(
        &self,
        repo: &Path,
        path: &Path,
        branch: &str,
        create_from: Option<&str>,
    ) -> Result<(), AppError> {
        // 置き場所の親(`.claude/worktrees`)が無ければ作る。
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!(
                    "worktree の置き場所を作れませんでした({}): {e}",
                    parent.display()
                ))
            })?;
        }
        let path_text = path.to_string_lossy().to_string();
        let args: Vec<&str> = match create_from {
            Some(base) => vec!["worktree", "add", "-b", branch, &path_text, base],
            None => vec!["worktree", "add", &path_text, branch],
        };
        run_git_ok(repo, &args, NETWORK_TIMEOUT)?;
        Ok(())
    }

    fn fetch_origin(&self, dir: &Path) -> Result<(), AppError> {
        run_git_ok(dir, &["fetch", "origin"], NETWORK_TIMEOUT)?;
        Ok(())
    }

    fn merge(&self, dir: &Path, rev: &str) -> Result<MergeOutcome, AppError> {
        let output = run_git(dir, &["merge", "--no-edit", rev], NETWORK_TIMEOUT)?;
        if !output.success {
            return Ok(MergeOutcome::Conflict {
                detail: output.detail(),
            });
        }
        Ok(if output.stdout.contains("Already up to date") {
            MergeOutcome::UpToDate
        } else {
            MergeOutcome::Merged
        })
    }

    fn abort_merge(&self, dir: &Path) {
        // 進行中の merge が無ければ失敗するが、それでよい(結果は見ない)。
        let _ = run_git(dir, &["merge", "--abort"], Duration::from_secs(30));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 隔離した一時リポジトリの組(origin / 作業用のクローン)。実ユーザーのリポジトリには触れない。
    struct Fixture {
        _dir: tempfile::TempDir,
        origin: PathBuf,
        work: PathBuf,
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()
            .expect("git should run");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).to_string()
    }

    /// マージのコミットに要る作者情報(テストのプロセスだけ。実ユーザーの git 設定には触れない)。
    fn set_identity() {
        for (key, value) in [
            ("GIT_AUTHOR_NAME", "t"),
            ("GIT_AUTHOR_EMAIL", "t@example.com"),
            ("GIT_COMMITTER_NAME", "t"),
            ("GIT_COMMITTER_EMAIL", "t@example.com"),
        ] {
            std::env::set_var(key, value);
        }
    }

    fn fixture() -> Fixture {
        set_identity();
        let dir = tempfile::tempdir().unwrap();
        let origin = dir.path().join("origin.git");
        let work = dir.path().join("work");
        std::fs::create_dir_all(&origin).unwrap();
        git(&origin, &["init", "--bare", "-b", "main"]);
        git(dir.path(), &["clone", origin.to_str().unwrap(), "work"]);
        // git のバージョンによる既定のブランチ名の違いを避ける。
        git(&work, &["checkout", "-B", "main"]);
        std::fs::write(work.join("a.txt"), "base\n").unwrap();
        git(&work, &["add", "."]);
        git(&work, &["commit", "-m", "base"]);
        git(&work, &["push", "-u", "origin", "main"]);
        Fixture {
            _dir: dir,
            origin,
            work,
        }
    }

    /// origin の main に、別のクローンから新しいコミットを足す。
    fn push_to_origin(fixture: &Fixture, file: &str, content: &str) {
        let other = fixture._dir.path().join("other");
        if !other.exists() {
            git(
                fixture._dir.path(),
                &["clone", fixture.origin.to_str().unwrap(), "other"],
            );
        }
        git(&other, &["pull", "origin", "main"]);
        std::fs::write(other.join(file), content).unwrap();
        git(&other, &["add", "."]);
        git(&other, &["commit", "-m", "upstream change"]);
        git(&other, &["push", "origin", "HEAD:main"]);
    }

    fn manager() -> SystemGitWorktreeManager {
        SystemGitWorktreeManager::new()
    }

    #[test]
    fn parses_porcelain_output_with_the_first_block_as_the_main_worktree() {
        let output = "worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/repo/.claude/worktrees/x\nHEAD def\nbranch refs/heads/session/x\n\nworktree C:/repo/.claude/worktrees/d\nHEAD 123\ndetached\n";

        let entries = parse_worktree_entries(output);

        assert_eq!(entries.len(), 3);
        assert!(entries[0].is_main && entries[0].branch_name.as_deref() == Some("main"));
        assert!(!entries[1].is_main);
        assert_eq!(entries[1].branch_name.as_deref(), Some("session/x"));
        assert_eq!(
            entries[2].branch_name, None,
            "detached HEAD にブランチは無い"
        );
    }

    #[test]
    fn a_new_worktree_is_created_from_origin_main_and_listed() {
        let f = fixture();
        let path = f.work.join(".claude").join("worktrees").join("session-x");

        manager()
            .add_worktree(&f.work, &path, "session/x", Some("origin/main"))
            .unwrap();

        assert!(path.join("a.txt").exists());
        let entries = manager().list(&f.work).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_main);
        assert_eq!(entries[1].branch_name.as_deref(), Some("session/x"));
        assert!(manager().branch_exists(&f.work, "session/x").unwrap());
        assert!(!manager().branch_exists(&f.work, "nope").unwrap());
    }

    #[test]
    fn an_existing_branch_can_be_checked_out_into_a_new_worktree() {
        let f = fixture();
        git(&f.work, &["branch", "topic"]);
        let path = f.work.join(".claude").join("worktrees").join("topic");

        manager()
            .add_worktree(&f.work, &path, "topic", None)
            .unwrap();

        let entries = manager().list(&f.work).unwrap();
        assert!(entries
            .iter()
            .any(|e| e.branch_name.as_deref() == Some("topic")));
    }

    #[test]
    fn adding_a_worktree_for_a_branch_that_does_not_exist_fails_with_the_reason() {
        let f = fixture();
        let path = f.work.join(".claude").join("worktrees").join("nope");

        let error = manager()
            .add_worktree(&f.work, &path, "nope", None)
            .unwrap_err();

        assert!(matches!(error, AppError::Io(m) if m.contains("worktree add")));
    }

    #[test]
    fn merging_when_already_up_to_date_says_so_and_merging_new_commits_brings_them_in() {
        let f = fixture();
        let path = f.work.join(".claude").join("worktrees").join("session-x");
        manager()
            .add_worktree(&f.work, &path, "session/x", Some("origin/main"))
            .unwrap();

        manager().fetch_origin(&path).unwrap();
        assert_eq!(
            manager().merge(&path, "origin/main").unwrap(),
            MergeOutcome::UpToDate
        );

        push_to_origin(&f, "b.txt", "from upstream\n");
        manager().fetch_origin(&path).unwrap();
        assert_eq!(
            manager().merge(&path, "origin/main").unwrap(),
            MergeOutcome::Merged
        );
        assert!(path.join("b.txt").exists());
    }

    #[test]
    fn a_conflicting_merge_is_reported_and_can_be_aborted_back_to_a_clean_tree() {
        let f = fixture();
        let path = f.work.join(".claude").join("worktrees").join("session-x");
        manager()
            .add_worktree(&f.work, &path, "session/x", Some("origin/main"))
            .unwrap();
        // 同じファイルの同じ行を、branch 側と upstream 側で別の内容にする。
        std::fs::write(path.join("a.txt"), "branch side\n").unwrap();
        git(&path, &["add", "."]);
        git(&path, &["commit", "-m", "branch change"]);
        push_to_origin(&f, "a.txt", "upstream side\n");
        manager().fetch_origin(&path).unwrap();

        let outcome = manager().merge(&path, "origin/main").unwrap();

        let MergeOutcome::Conflict { detail } = outcome else {
            panic!("expected a conflict, got {outcome:?}");
        };
        assert!(
            detail.contains("a.txt") || detail.contains("CONFLICT"),
            "{detail}"
        );
        manager().abort_merge(&path);
        assert_eq!(
            git(&path, &["status", "--porcelain"]).trim(),
            "",
            "abort のあとは作業ツリーが元どおり"
        );
        // (Windows の autocrlf で改行が CRLF になることがあるので、改行の違いは見ない)
        assert_eq!(
            std::fs::read_to_string(path.join("a.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "branch side\n"
        );
        // 進行中の merge が無い状態での abort は、何も起こさない(パニックしない)。
        manager().abort_merge(&path);
    }

    #[test]
    fn fetching_without_an_origin_fails_instead_of_hanging() {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "-b", "main"]);

        let error = manager().fetch_origin(dir.path()).unwrap_err();

        assert!(matches!(error, AppError::Io(_)));
    }
}
