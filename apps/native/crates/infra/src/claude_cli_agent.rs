use app::{AgentGateway, AppError, SendRequest};
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// 送信の待ち上限。ツール実行なしのテキスト応答のみを想定するため、
/// フルツールのエージェント実行を前提とした一般的な目安(600秒)より短く取る。
const SEND_MESSAGE_TIMEOUT: Duration = Duration::from_secs(120);

/// 起動元(Claude Desktop等)を示す環境変数。子プロセスがこれを引き継ぐと、
/// アプリが新規作成したセッションの記録上の起点が実態と異なる値
/// (`entrypoint: "claude-desktop"`)になってしまう。`claude` 起動前に必ず取り除く。
const DESKTOP_LINEAGE_ENV_VARS: &[&str] = &[
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PID",
];

/// `claude` CLI を headless(`--print`)で起動する `AgentGateway` 実装。
/// `SendRequest.cwd` は既に呼び出し側([`app::send_message`])が
/// `SessionSource` を通じて解決済みの値を受け取るだけで、
/// `~/.claude/projects/` の構造を自ら解釈することはない。
#[derive(Debug, Default, Clone, Copy)]
pub struct ClaudeCliAgent;

impl ClaudeCliAgent {
    pub fn new() -> Self {
        Self
    }
}

impl AgentGateway for ClaudeCliAgent {
    fn send(&self, req: SendRequest) -> Result<(), AppError> {
        if !req.cwd.is_dir() {
            return Err(AppError::CwdMissing(format!(
                "作業ディレクトリが見つかりません: {}",
                req.cwd.display()
            )));
        }

        // mode(AgentMode::Chat)/continuation(Continuation::Continue)は現状
        // それぞれ単一のバリアントしか存在しないため分岐は設けていない。
        // 送信対象が最新セッションと一致するかどうかは app::send_message が
        // 事前に検証済み。ここでは --continue でそのまま継続するのみで、
        // 失敗時に新規セッションへ暗黙にフォールバックすることはしない
        // (無言で別の会話が生まれる事故を防ぐため)。
        let command = build_send_message_command(&req.cwd, &req.text);
        run_with_timeout(command, SEND_MESSAGE_TIMEOUT)?;
        Ok(())
    }
}

/// 送信用の `claude` コマンドを組み立てる。
/// `--continue`(カレントディレクトリの最新の会話をそのまま継続)は常に付ける。
///
/// `--continue` は `--resume <id>` と異なり entrypoint に関係なく機能する
/// (Claude Desktop起源のセッションにも追記できる)ため、こちらを使う。
fn build_send_message_command(cwd: &Path, text: &str) -> Command {
    let mut command = Command::new("claude");
    command.current_dir(cwd);
    for var in DESKTOP_LINEAGE_ENV_VARS {
        command.env_remove(var);
    }
    // ツール実行(Bash/Edit等)は許可しない。GUIのテキスト欄からの入力で
    // ファイル操作やコマンド実行まで確認なしに行わせるのは危険なため。
    command.arg("--tools").arg("");
    command.arg("--continue");
    command.arg("--print").arg(text);
    command
}

/// プロセス起動時の `io::Error` を分類する。
/// 実行ファイル自体が見つからない場合と、それ以外の起動失敗を区別する。
fn map_spawn_error(program: &str, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::CliNotFound(format!(
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
                    return Err(AppError::Timeout(format!(
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
        return Err(AppError::CliFailed(format!(
            "{program} が失敗しました({})",
            describe_exit(&status)
        )));
    }

    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use app::AgentMode;
    use app::Continuation;

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn build_send_message_command_always_includes_continue_flag() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(&cwd, "hello");
        assert_eq!(
            args_of(&command),
            vec!["--tools", "", "--continue", "--print", "hello"]
        );
    }

    #[test]
    fn build_send_message_command_removes_desktop_lineage_env_vars() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(&cwd, "hello");
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

    #[test]
    fn send_fails_with_cwd_missing_when_directory_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let missing_cwd = dir.path().join("this-directory-does-not-exist-surely-987");

        let agent = ClaudeCliAgent::new();
        let error = agent
            .send(SendRequest {
                cwd: missing_cwd,
                text: "hello".to_string(),
                mode: AgentMode::Chat,
                continuation: Continuation::Continue,
            })
            .expect_err("should fail when cwd is missing");

        assert!(matches!(error, AppError::CwdMissing(_)), "got: {error:?}");
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
            AppError::CliFailed(message) => message,
            other => panic!("expected CliFailed error, got {other:?}"),
        };
        assert!(message.contains("終了コード"), "got: {message}");
    }

    #[test]
    fn run_with_timeout_kills_overrunning_process() {
        let error = run_with_timeout(sleep_command(5), Duration::from_millis(200))
            .expect_err("should time out");
        let message = match error {
            AppError::Timeout(message) => message,
            other => panic!("expected Timeout error, got {other:?}"),
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
            AppError::CliNotFound(message) => message,
            other => panic!("expected CliNotFound error, got {other:?}"),
        };
        assert!(message.contains("見つかりません"), "got: {message}");
    }
}
