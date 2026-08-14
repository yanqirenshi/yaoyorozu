use app::{AppError, ProjectRepository, SessionRepository};
use domain::{extract_cwd, extract_message, Message, Project};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant, UNIX_EPOCH};

/// `send_message` の待ち上限。ツール実行なしのテキスト応答のみを想定するため、
/// フルツールのエージェント実行を前提とした一般的な目安(600秒)より短く取る。
const SEND_MESSAGE_TIMEOUT: Duration = Duration::from_secs(120);

/// ファイル変更をイベントとして通知するまでのデバウンス時間。
/// 短時間の連続書き込み(1メッセージ分の追記等)をまとめて1回の通知にする。
const WATCH_DEBOUNCE: Duration = Duration::from_millis(400);

/// 起動元(Claude Desktop等)を示す環境変数。子プロセスがこれを引き継ぐと、
/// アプリが新規作成したセッションの記録上の起点が実態と異なる値
/// (`entrypoint: "claude-desktop"`)になってしまう。`claude` 起動前に必ず取り除く。
const DESKTOP_LINEAGE_ENV_VARS: &[&str] = &[
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PID",
];

pub struct FileSystemRepository {
    projects_dir: PathBuf,
}

impl FileSystemRepository {
    pub fn new(projects_dir: PathBuf) -> Self {
        Self { projects_dir }
    }

    pub fn from_home_dir() -> Result<Self, AppError> {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map(PathBuf::from)
            .map_err(|_| AppError::Io("ホームディレクトリが見つかりません".to_string()))?;
        Ok(Self::new(home.join(".claude").join("projects")))
    }

    /// プロジェクトディレクトリ配下の変更を監視し、変更のあったプロジェクト
    /// (直下のフォルダ名)を `on_change` に通知する。
    ///
    /// 戻り値の `Debouncer` を drop すると監視が止まるため、呼び出し側は
    /// 監視を続けたい間、値を保持し続ける必要がある(呼び出し元の tauri 層で
    /// アプリの状態として保持する想定)。
    pub fn watch_projects<F>(
        &self,
        on_change: F,
    ) -> Result<Debouncer<notify::RecommendedWatcher, RecommendedCache>, AppError>
    where
        F: Fn(String) + Send + 'static,
    {
        let watch_root = self.projects_dir.clone();
        let mut debouncer =
            new_debouncer(WATCH_DEBOUNCE, None, move |result: DebounceEventResult| {
                let Ok(events) = result else { return };
                let mut notified = HashSet::new();
                for event in events {
                    for path in &event.paths {
                        if let Some(project) = project_name_from_path(&watch_root, path) {
                            if notified.insert(project.clone()) {
                                on_change(project);
                            }
                        }
                    }
                }
            })
            .map_err(|e| AppError::Io(format!("ファイル監視の初期化に失敗しました: {e}")))?;

        debouncer
            .watch(&self.projects_dir, RecursiveMode::Recursive)
            .map_err(|e| {
                AppError::Io(format!(
                    "{} の監視開始に失敗しました: {e}",
                    self.projects_dir.display()
                ))
            })?;

        Ok(debouncer)
    }
}

/// `path` が `projects_dir` 配下のとき、直下のプロジェクトフォルダ名を返す。
fn project_name_from_path(projects_dir: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(projects_dir).ok()?;
    relative
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
}

fn to_millis(time: std::io::Result<std::time::SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// ディレクトリ直下(サブディレクトリは見ない)の *.jsonl を、
/// 最終更新が新しい順に並べて返す。
fn session_files_by_recency(project_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(project_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .collect();
    files.sort_by_key(|path| {
        std::cmp::Reverse(to_millis(fs::metadata(path).and_then(|m| m.modified())))
    });
    files
}

/// ディレクトリ直下の *.jsonl のうち、最終更新が最も新しいものを返す。
fn latest_session_file(project_dir: &Path) -> Option<PathBuf> {
    session_files_by_recency(project_dir).into_iter().next()
}

/// 最新セッションファイルに記録されている、セッション開始時点の作業ディレクトリ(cwd)を返す。
/// `claude` はカレントディレクトリ配下のプロジェクトとしてセッションを保存するため、
/// 元の会話と同じプロジェクトに新規セッションを作るには同じ cwd で起動する必要がある。
/// セッション途中で(Bash の cd 等により)cwd が変わることがあるため、
/// 最後の値ではなく最初に記録された値(＝プロジェクトのルート)を使う。
fn latest_session_cwd(project_dir: &Path) -> Result<PathBuf, AppError> {
    let path = latest_session_file(project_dir)
        .ok_or_else(|| AppError::NotFound("セッションが見つかりません".to_string()))?;

    let file = fs::File::open(&path)
        .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

    let cwd = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .find_map(|value| extract_cwd(&value))
        .ok_or_else(|| {
            AppError::Io("セッションの作業ディレクトリを取得できませんでした".to_string())
        })?;

    Ok(PathBuf::from(cwd))
}

/// `send_message` 用の `claude` コマンドを組み立てる。
/// `continue_session` が true なら `--continue`(カレントディレクトリの最新の
/// 会話をそのまま継続)を付け、false なら新規セッションになる。
///
/// `--continue` は `--resume <id>` と異なり entrypoint に関係なく機能する
/// (Claude Desktop起源のセッションにも追記できる)ため、こちらを使う。
fn build_send_message_command(cwd: &Path, text: &str, continue_session: bool) -> Command {
    let mut command = Command::new("claude");
    command.current_dir(cwd);
    for var in DESKTOP_LINEAGE_ENV_VARS {
        command.env_remove(var);
    }
    // ツール実行(Bash/Edit等)は許可しない。GUIのテキスト欄からの入力で
    // ファイル操作やコマンド実行まで確認なしに行わせるのは危険なため。
    command.arg("--tools").arg("");
    if continue_session {
        command.arg("--continue");
    }
    command.arg("--print").arg(text);
    command
}

/// プロセス起動時の `io::Error` を分類する。
/// 実行ファイル自体が見つからない場合と、それ以外の起動失敗を区別する。
fn map_spawn_error(program: &str, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::Io(format!(
            "{program} コマンドが見つかりません。インストールされているか確認してください。"
        ))
    } else {
        AppError::Io(format!("{program} の起動に失敗しました: {e}"))
    }
}

/// 終了ステータスの短い説明(シークレットを含まない)。
fn describe_exit(status: &ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("終了コード {code}"),
        None => "シグナルにより終了".to_string(),
    }
}

/// `command` をタイムアウト付きで実行し、標準出力を文字列で返す。
///
/// stderr は `Stdio::null()` で握りつぶす。トークンやパス等が含まれうるため、
/// エラーメッセージに生のstderrを埋め込まない(失敗理由は終了ステータスのみ)。
/// 標準出力はブロッキング取得によるパイプ詰まりを避けるため、別スレッドで
/// 待機と並行して読み進める。タイムアウト時はプロセスを kill する。
fn run_with_timeout(mut command: Command, timeout: Duration) -> Result<String, AppError> {
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    let program = command.get_program().to_string_lossy().to_string();
    let mut child = command.spawn().map_err(|e| map_spawn_error(&program, e))?;

    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Io(format!("{program} の標準出力を取得できませんでした")))?;
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout_pipe.read_to_string(&mut buf);
        buf
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return Err(AppError::Io(format!(
                        "{program} がタイムアウトしました({}秒)",
                        timeout.as_secs()
                    )));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = reader.join();
                return Err(AppError::Io(format!("{program} の待機に失敗しました: {e}")));
            }
        }
    };

    let stdout = reader.join().unwrap_or_default();

    if !status.success() {
        return Err(AppError::Io(format!(
            "{program} が失敗しました({})",
            describe_exit(&status)
        )));
    }

    Ok(stdout)
}

impl ProjectRepository for FileSystemRepository {
    fn list_projects(&self) -> Result<Vec<Project>, AppError> {
        let entries = fs::read_dir(&self.projects_dir).map_err(|e| {
            AppError::Io(format!(
                "{} の読み込みに失敗しました: {}",
                self.projects_dir.display(),
                e
            ))
        })?;

        let projects = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .filter_map(|path| {
                let name = path.file_name()?.to_str()?.to_string();
                let updated_at_ms = latest_session_file(&path)
                    .map(|f| to_millis(fs::metadata(&f).and_then(|m| m.modified())))
                    .unwrap_or_else(|| to_millis(fs::metadata(&path).and_then(|m| m.modified())));
                Some(Project {
                    name,
                    updated_at_ms,
                })
            })
            .collect();

        Ok(projects)
    }
}

impl SessionRepository for FileSystemRepository {
    fn latest_session_messages(&self, project: &str) -> Result<Vec<Message>, AppError> {
        let project_dir = self.projects_dir.join(project);
        let path = latest_session_file(&project_dir)
            .ok_or_else(|| AppError::NotFound(format!("{project} にセッションが見つかりません")))?;
        let file = fs::File::open(&path)
            .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

        let messages = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
            .filter_map(|value| extract_message(&value))
            .collect();

        Ok(messages)
    }

    fn send_message(&self, project: &str, text: &str) -> Result<(), AppError> {
        let project_dir = self.projects_dir.join(project);
        let cwd = latest_session_cwd(&project_dir)?;

        if !cwd.is_dir() {
            return Err(AppError::NotFound(format!(
                "作業ディレクトリが見つかりません: {}",
                cwd.display()
            )));
        }

        // そのプロジェクトの最新セッション(=表示中の会話)を --continue でそのまま
        // 継続する。継続に失敗した場合のみ、新規セッションとして送り直す。
        let command = build_send_message_command(&cwd, text, true);
        if run_with_timeout(command, SEND_MESSAGE_TIMEOUT).is_ok() {
            return Ok(());
        }

        let command = build_send_message_command(&cwd, text, false);
        run_with_timeout(command, SEND_MESSAGE_TIMEOUT)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn watch_projects_notifies_project_name_on_new_session_file() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("some-project");
        fs::create_dir_all(&project_dir).unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let (tx, rx) = std::sync::mpsc::channel();
        let _debouncer = repo
            .watch_projects(move |project| {
                let _ = tx.send(project);
            })
            .expect("should start watching");

        fs::write(project_dir.join("s1.jsonl"), b"{}").unwrap();

        let notified = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("should be notified of the change");
        assert_eq!(notified, "some-project");
    }

    #[test]
    fn build_send_message_command_without_continue_has_no_continue_flag() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(&cwd, "hello", false);
        assert_eq!(args_of(&command), vec!["--tools", "", "--print", "hello"]);
    }

    #[test]
    fn build_send_message_command_with_continue_includes_continue_flag() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(&cwd, "hello", true);
        assert_eq!(
            args_of(&command),
            vec!["--tools", "", "--continue", "--print", "hello"]
        );
    }

    #[test]
    fn build_send_message_command_removes_desktop_lineage_env_vars() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(&cwd, "hello", false);
        let removed: Vec<String> = command
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k.to_string_lossy().to_string())
            .collect();
        for var in DESKTOP_LINEAGE_ENV_VARS {
            assert!(
                removed.contains(&(*var).to_string()),
                "expected {var} to be removed, got {removed:?}"
            );
        }
    }

    /// プラットフォームのシェル経由で `body` を標準出力に書き出すコマンド。
    /// 実際の `claude` を起動せず、プロセス実行の骨格(spawn/wait/timeout/stdout取得)
    /// だけをテストするためのフェイク。
    fn echo_command(body: &str) -> Command {
        if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo", body]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &format!("printf '%s' '{body}'")]);
            c
        }
    }

    fn exit_with(code: i32) -> Command {
        if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "exit", &code.to_string()]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &format!("exit {code}")]);
            c
        }
    }

    fn sleep_command(secs: u64) -> Command {
        if cfg!(windows) {
            // ping の間隔待ちで代用(sleepに相当するコマンドが標準にないため)。
            let mut c = Command::new("cmd");
            c.args([
                "/C",
                "ping",
                "-n",
                &(secs + 1).to_string(),
                "127.0.0.1",
                ">nul",
            ]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &format!("sleep {secs}")]);
            c
        }
    }

    #[test]
    fn run_with_timeout_captures_stdout_on_success() {
        let stdout = run_with_timeout(echo_command("hello"), Duration::from_secs(5))
            .expect("fake echo should succeed");
        assert!(stdout.contains("hello"), "got: {stdout:?}");
    }

    #[test]
    fn run_with_timeout_fails_on_nonzero_exit_without_leaking_stderr() {
        let error = run_with_timeout(exit_with(1), Duration::from_secs(5))
            .expect_err("nonzero exit should be an error");
        let message = match error {
            AppError::Io(message) => message,
            other => panic!("expected Io error, got {other:?}"),
        };
        assert!(message.contains("終了コード"), "got: {message}");
    }

    #[test]
    fn run_with_timeout_kills_overrunning_process() {
        let error = run_with_timeout(sleep_command(5), Duration::from_millis(200))
            .expect_err("should time out");
        let message = match error {
            AppError::Io(message) => message,
            other => panic!("expected Io error, got {other:?}"),
        };
        assert!(message.contains("タイムアウト"), "got: {message}");
    }

    #[test]
    fn run_with_timeout_reports_missing_program_distinctly() {
        let error = run_with_timeout(
            Command::new("definitely-not-a-real-program-xyz-987"),
            Duration::from_secs(5),
        )
        .expect_err("missing program should error");
        let message = match error {
            AppError::Io(message) => message,
            other => panic!("expected Io error, got {other:?}"),
        };
        assert!(message.contains("見つかりません"), "got: {message}");
    }
}
