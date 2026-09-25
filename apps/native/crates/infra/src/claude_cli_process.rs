//! claude CLI を**起動したまま**子プロセスとして持つ(issue #391。Phase 1。PoC #382)。
//!
//! `Stdio::piped()` で起動し、標準入力へ JSON 行を書き、標準出力・標準エラーを読み取りスレッドで
//! 読む。標準出力の1行は [`crate::claude_stream_json`] が domain の出来事に写して
//! [`RunningSessionEventSink`] へ流す(順序どおり)。標準入力を閉じると約1秒で終了する。
//! 応答が無ければ kill する(kill だと `~/.claude/sessions/<PID>.json` が残るので最後の手段)。

use crate::claude_cli::{claude_executable, map_spawn_error, DESKTOP_LINEAGE_ENV_VARS};
use crate::claude_stream_json::{
    build_args, build_initialize_line, build_interrupt_line, build_permission_response_line,
    build_user_message_line, map_wire_line,
};
use app::{
    AppError, RunningProcess, RunningSessionEvent, RunningSessionEventSink, RunningSessionLauncher,
    StartRunningSession,
};
use domain::{ImageAttachment, PermissionResponse};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 標準入力を閉じてから、プロセスが終了するのを待つ上限。通常は約1秒で終了する
/// (PoC #382 レポート §6.5)。
const GRACEFUL_EXIT_WAIT: Duration = Duration::from_secs(3);

/// kill したあと、終了を待つ上限。
const KILL_EXIT_WAIT: Duration = Duration::from_secs(2);

/// 終了理由の手がかりとして持つ標準エラーの行数(末尾)。正常系では何も出ない
/// (レポート §6.4)ので、少なくてよい。
const STDERR_TAIL_LINES: usize = 20;

/// Windows で、子プロセスのコンソールウィンドウを出さない(`CREATE_NO_WINDOW`)。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `claude` を起動する [`RunningSessionLauncher`] の実装。
#[derive(Debug, Clone)]
pub struct ClaudeCliProcessLauncher {
    program: String,
    /// `program` の直後に置く引数(テストで `node fake_claude.cjs` のような差し替えに使う)。
    leading_args: Vec<String>,
}

impl ClaudeCliProcessLauncher {
    pub fn new() -> Self {
        Self {
            program: claude_executable().to_string(),
            leading_args: Vec::new(),
        }
    }

    /// 実行ファイルと先頭の引数を差し替える(テスト用)。
    pub fn with_command(program: &str, leading_args: &[&str]) -> Self {
        Self {
            program: program.to_string(),
            leading_args: leading_args.iter().map(|s| s.to_string()).collect(),
        }
    }
}

impl Default for ClaudeCliProcessLauncher {
    fn default() -> Self {
        Self::new()
    }
}

impl RunningSessionLauncher for ClaudeCliProcessLauncher {
    fn start(
        &self,
        request: &StartRunningSession,
        sink: Arc<dyn RunningSessionEventSink>,
    ) -> Result<Arc<dyn RunningProcess>, AppError> {
        if !request.cwd.is_dir() {
            return Err(AppError::CwdMissing(format!(
                "作業ディレクトリが見つかりません: {}",
                request.cwd.display()
            )));
        }

        let mut command = Command::new(&self.program);
        command.args(&self.leading_args);
        command.args(build_args(request));
        command.current_dir(&request.cwd);
        // 親(Claude Desktop 等)由来の起動元の印は引き継がない(既存の1回きり送信と同じ)。
        for var in DESKTOP_LINEAGE_ENV_VARS {
            command.env_remove(var);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| map_spawn_error(&self.program, e))?;
        let pid = child.id();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (Some(stdin), Some(stdout), Some(stderr)) = (stdin, stdout, stderr) else {
            let _ = child.kill();
            return Err(AppError::Io(
                "claude の標準入出力を取得できませんでした".to_string(),
            ));
        };

        let child = Arc::new(Mutex::new(child));
        let exit = Arc::new(ExitSignal::default());
        spawn_reader(child.clone(), stdout, stderr, sink, exit.clone());

        let process = ClaudeCliProcess {
            pid,
            stdin: Mutex::new(Some(stdin)),
            child,
            exit,
            next_request: AtomicU64::new(1),
        };
        // `initialize` を送って、その応答を「起動できた」の合図にする(CLI は最初のターンまで
        // `system/init` を出さないため)。書けなければプロセスがすでに終わりかけており、
        // 読み取りスレッドの `Exited` が知らせるので、ここではエラーにしない。
        let _ = process.write_line(&build_initialize_line());
        Ok(Arc::new(process))
    }
}

/// プロセスの終了を待つための合図。読み取りスレッドが終了を見届けて立てる。
#[derive(Default)]
struct ExitSignal {
    exited: Mutex<bool>,
    changed: Condvar,
}

impl ExitSignal {
    fn set(&self) {
        *self.exited.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.changed.notify_all();
    }

    fn is_set(&self) -> bool {
        *self.exited.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 終了するか `timeout` が過ぎるまで待つ。終了していれば `true`。
    fn wait(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut exited = self.exited.lock().unwrap_or_else(|e| e.into_inner());
        while !*exited {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            exited = self
                .changed
                .wait_timeout(exited, remaining)
                .map(|(guard, _)| guard)
                .unwrap_or_else(|e| e.into_inner().0);
        }
        true
    }
}

/// 標準出力・標準エラーの読み取りスレッドを起こす。標準出力が閉じたら(=プロセスの
/// 終了)、終了ステータスを確かめて `Exited` を流し、`exit` を立てる。
fn spawn_reader(
    child: Arc<Mutex<Child>>,
    stdout: ChildStdout,
    stderr: ChildStderr,
    sink: Arc<dyn RunningSessionEventSink>,
    exit: Arc<ExitSignal>,
) {
    let stderr_tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_thread: JoinHandle<()> = {
        let tail = stderr_tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut tail = tail.lock().unwrap_or_else(|e| e.into_inner());
                if tail.len() == STDERR_TAIL_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        })
    };

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            for event in map_wire_line(&line, now_ms()) {
                sink.emit(event);
            }
        }
        let exit_code = wait_for_exit(&child);
        let _ = stderr_thread.join();
        let stderr_tail = stderr_tail
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        sink.emit(RunningSessionEvent::Exited {
            exit_code,
            stderr_tail,
        });
        exit.set();
    });
}

/// 標準出力が閉じたあと、終了ステータスが確定するのを待って終了コードを返す。
fn wait_for_exit(child: &Mutex<Child>) -> Option<i32> {
    loop {
        {
            let mut child = child.lock().unwrap_or_else(|e| e.into_inner());
            match child.try_wait() {
                Ok(Some(status)) => return status.code(),
                Ok(None) => {}
                Err(_) => return None,
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// `pid` のプロセスをツリーごと強制終了する(Windows: `taskkill /T /F`)。失敗しても
/// 呼び出し側が `Child::kill` を続けて試すので、結果は見ない。PATH 上の実行ファイルが
/// 別のプロセスを起こして中身を動かす形(ラッパー・シム)でも、孫を残さないため。
#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// pid が有効な範囲(`<OS>:<ホスト名>`)。ホスト名が取れなければ `unknown`。
fn pid_domain() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    format!("{}:{host}", std::env::consts::OS)
}

/// 起動済みの `claude` 子プロセス。
struct ClaudeCliProcess {
    pid: u32,
    /// 標準入力。`stop` で閉じる(`None`)。書き込みは行の途中で混ざらないよう
    /// このロックの中で1行ずつ行う。
    stdin: Mutex<Option<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    exit: Arc<ExitSignal>,
    /// 中断の要求の `request_id` の連番。
    next_request: AtomicU64,
}

impl ClaudeCliProcess {
    /// 標準入力へ1行書く。閉じている・書けないときはエラー(プロセスの終了)。
    fn write_line(&self, line: &str) -> Result<(), AppError> {
        let mut guard = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        let stdin = guard
            .as_mut()
            .ok_or_else(|| AppError::Io("実行中のセッションは終了しています".to_string()))?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|e| {
                AppError::Io(format!(
                    "実行中のセッションへ書き込めませんでした(終了した可能性があります): {e}"
                ))
            })
    }
}

impl RunningProcess for ClaudeCliProcess {
    fn pid(&self) -> u32 {
        self.pid
    }

    fn pid_domain(&self) -> String {
        pid_domain()
    }

    fn send_user_message(&self, text: &str, images: &[ImageAttachment]) -> Result<(), AppError> {
        self.write_line(&build_user_message_line(images, text))
    }

    fn respond_permission(&self, response: &PermissionResponse) -> Result<(), AppError> {
        match build_permission_response_line(response) {
            Some(line) => self.write_line(&line),
            None => Ok(()),
        }
    }

    fn interrupt(&self) -> Result<(), AppError> {
        let id = self.next_request.fetch_add(1, Ordering::Relaxed);
        self.write_line(&build_interrupt_line(&format!("app-interrupt-{id}")))
    }

    fn stop(&self) {
        // 標準入力を閉じる(CLI は約1秒で終了する)。
        drop(self.stdin.lock().unwrap_or_else(|e| e.into_inner()).take());
        if self.exit.wait(GRACEFUL_EXIT_WAIT) {
            return;
        }
        // 応答が無い: 強制終了(台帳が残ることは承知の上。次に別の claude が起動したとき掃除される)。
        // `claude` が起動した孫プロセス(フック・MCP サーバなど)を残さないよう、可能なら
        // プロセスツリーごと止める。
        kill_process_tree(self.pid);
        let _ = self.child.lock().unwrap_or_else(|e| e.into_inner()).kill();
        self.exit.wait(KILL_EXIT_WAIT);
    }
}

/// app が終了する・値を落とすときに子プロセスを残さない。
impl Drop for ClaudeCliProcess {
    fn drop(&mut self) {
        if !self.exit.is_set() {
            self.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app::RunningPermissionMode;
    use domain::{PermissionBehavior, ProgressEvent};
    use std::path::PathBuf;
    use std::sync::mpsc::{channel, Receiver, Sender};

    struct ChannelSink(Mutex<Sender<RunningSessionEvent>>);

    impl RunningSessionEventSink for ChannelSink {
        fn emit(&self, event: RunningSessionEvent) {
            let _ = self.0.lock().unwrap().send(event);
        }
    }

    fn sink() -> (
        Arc<dyn RunningSessionEventSink>,
        Receiver<RunningSessionEvent>,
    ) {
        let (tx, rx) = channel();
        (Arc::new(ChannelSink(Mutex::new(tx))), rx)
    }

    fn request(cwd: &std::path::Path) -> StartRunningSession {
        StartRunningSession {
            session_id: "s1".to_string(),
            cwd: cwd.to_path_buf(),
            mode: RunningPermissionMode::Default,
        }
    }

    /// 条件を満たす出来事が来るまで読む(それまでの出来事は捨てず `seen` に貯める)。
    fn wait_for(
        rx: &Receiver<RunningSessionEvent>,
        seen: &mut Vec<RunningSessionEvent>,
        pred: impl Fn(&RunningSessionEvent) -> bool,
    ) -> RunningSessionEvent {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let event = rx
                .recv_timeout(remaining)
                .unwrap_or_else(|_| panic!("timeout. seen so far: {seen:#?}"));
            seen.push(event.clone());
            if pred(&event) {
                return event;
            }
        }
    }

    fn fake_launcher() -> ClaudeCliProcessLauncher {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fake_claude.cjs");
        ClaudeCliProcessLauncher::with_command("node", &[script.to_str().unwrap()])
    }

    #[test]
    fn start_fails_with_cwd_missing_when_the_directory_does_not_exist() {
        let (sink, _rx) = sink();
        let launcher = ClaudeCliProcessLauncher::with_command("this-command-does-not-exist", &[]);

        let error = launcher
            .start(&request(&PathBuf::from("Z:/no/such/dir")), sink)
            .err()
            .expect("should fail");

        assert!(matches!(error, AppError::CwdMissing(_)));
    }

    #[test]
    fn start_fails_with_cli_not_found_when_the_executable_is_missing() {
        let (sink, _rx) = sink();
        let dir = tempfile::tempdir().unwrap();
        let launcher = ClaudeCliProcessLauncher::with_command("this-command-does-not-exist", &[]);

        let error = launcher
            .start(&request(dir.path()), sink)
            .err()
            .expect("should fail");

        assert!(matches!(error, AppError::CliNotFound(_)));
    }

    // 以下は実際に子プロセス(node)を起動する統合テスト。`cargo test` の既定では走らせず
    // (`#[ignore]`)、`cargo test -p infra -- --ignored fake_claude` で走らせる。CLI の代わりに
    // `tests/fake_claude.cjs`(stream-json を話す使い捨ての偽 CLI。PoC #382 レポートの実出力の
    // 形)を使うので、認証・課金・実際の会話ファイルには一切触れない。

    #[test]
    #[ignore]
    fn fake_claude_roundtrip_streams_progress_and_finishes_the_turn() {
        let dir = tempfile::tempdir().unwrap();
        let (sink, rx) = sink();
        let process = fake_launcher().start(&request(dir.path()), sink).unwrap();
        let mut seen = Vec::new();

        process.send_user_message("こんにちは", &[]).unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });

        assert!(seen.contains(&RunningSessionEvent::Initialized));
        assert!(seen.iter().any(|e| matches!(
            e,
            RunningSessionEvent::Progress(ProgressEvent::SentLineConfirmed { .. })
        )));
        assert!(seen.iter().any(|e| matches!(
            e,
            RunningSessionEvent::Progress(ProgressEvent::TextDelta { text }) if text.contains("こんにちは")
        )));
        assert!(matches!(
            seen.last(),
            Some(RunningSessionEvent::Progress(ProgressEvent::TurnFinished {
                succeeded: true
            }))
        ));

        // 2往復目(プロセスは生きたまま)
        process.send_user_message("もう一度", &[]).unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });
        process.stop();
    }

    #[test]
    #[ignore]
    fn fake_claude_permission_request_is_answered_and_the_tool_result_arrives() {
        let dir = tempfile::tempdir().unwrap();
        let (sink, rx) = sink();
        let process = fake_launcher().start(&request(dir.path()), sink).unwrap();
        let mut seen = Vec::new();

        process.send_user_message("PERM please", &[]).unwrap();
        let asked = wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::PermissionRequested(_))
        });
        let RunningSessionEvent::PermissionRequested(request) = asked else {
            unreachable!()
        };
        assert_eq!(request.tool_name, "Write");
        assert_eq!(request.suggestions.len(), 1);

        // 許可を返す(問い合わせの入力をそのまま)
        let response =
            PermissionResponse::allow(&request.request_id, &request.tool_input, None, None, 1);
        assert!(matches!(
            response.behavior,
            PermissionBehavior::Allow { .. }
        ));
        process.respond_permission(&response).unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });

        assert!(seen.iter().any(|e| matches!(
            e,
            RunningSessionEvent::Progress(ProgressEvent::ToolResultArrived {
                is_error: false,
                ..
            })
        )));

        // 拒否(2回目)
        process.send_user_message("PERM again", &[]).unwrap();
        let asked = wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::PermissionRequested(_))
        });
        let RunningSessionEvent::PermissionRequested(request) = asked else {
            unreachable!()
        };
        process
            .respond_permission(&PermissionResponse::deny(&request.request_id, "だめ", 2))
            .unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::ToolResultArrived {
                    is_error: true,
                    ..
                })
            )
        });
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });
        process.stop();
    }

    #[test]
    #[ignore]
    fn fake_claude_interrupt_during_generation_and_during_a_permission_request() {
        let dir = tempfile::tempdir().unwrap();
        let (sink, rx) = sink();
        let process = fake_launcher().start(&request(dir.path()), sink).unwrap();
        let mut seen = Vec::new();

        // 生成中の中断
        process.send_user_message("SLOW count", &[]).unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TextDelta { .. })
            )
        });
        process.interrupt().unwrap();
        let finished = wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });
        assert_eq!(
            finished,
            RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: false })
        );

        // 中断のあとも、次の質問を送れる(プロセスは生きている)
        process.send_user_message("after", &[]).unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: true })
            )
        });

        // 権限待ち中の中断: 取り下げが届く
        process
            .send_user_message("PERM then interrupt", &[])
            .unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::PermissionRequested(_))
        });
        process.interrupt().unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::PermissionCancelled { .. })
        });
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });
        process.stop();
    }

    #[test]
    #[ignore]
    fn fake_claude_stop_closes_stdin_and_reports_a_clean_exit() {
        let dir = tempfile::tempdir().unwrap();
        let (sink, rx) = sink();
        let process = fake_launcher().start(&request(dir.path()), sink).unwrap();
        let mut seen = Vec::new();
        process.send_user_message("hi", &[]).unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });

        let started = Instant::now();
        process.stop();

        assert!(
            started.elapsed() < Duration::from_secs(3),
            "標準入力を閉じれば速やかに終わる"
        );
        let exited = wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::Exited { .. })
        });
        assert!(matches!(
            exited,
            RunningSessionEvent::Exited {
                exit_code: Some(0),
                ..
            }
        ));
        // 終了後の書き込みはエラー、stop の再呼び出しは何もしない
        assert!(matches!(
            process.send_user_message("late", &[]),
            Err(AppError::Io(_))
        ));
        process.stop();
    }

    #[test]
    #[ignore]
    fn fake_claude_that_never_exits_is_killed_after_the_grace_period() {
        let dir = tempfile::tempdir().unwrap();
        let (sink, rx) = sink();
        let process = fake_launcher().start(&request(dir.path()), sink).unwrap();
        let mut seen = Vec::new();
        // 標準入力を閉じても終了しない挙動(HANG)
        process.send_user_message("HANG", &[]).unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });

        process.stop();

        let exited = wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::Exited { .. })
        });
        assert!(matches!(exited, RunningSessionEvent::Exited { .. }));
    }

    #[test]
    #[ignore]
    fn fake_claude_that_fails_at_startup_reports_exit_with_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let (sink, rx) = sink();
        let process = fake_launcher().start(&request(dir.path()), sink).unwrap();
        let mut seen = Vec::new();
        process.send_user_message("DIE", &[]).unwrap();

        let exited = wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::Exited { .. })
        });

        let RunningSessionEvent::Exited {
            exit_code,
            stderr_tail,
        } = exited
        else {
            unreachable!()
        };
        assert_eq!(exit_code, Some(3));
        assert!(
            stderr_tail.contains("No conversation found"),
            "{stderr_tail}"
        );
    }

    /// 実物の `claude` を、隔離した設定フォルダ(未ログイン)で起動して往復する。実アカウント・
    /// 実際の会話ファイルには触れない(未ログインなので、AI の応答は "Not logged in" の
    /// エラー行になる)。環境変数で対象を渡す:
    /// `YAOYOROZU_LIVE_CLAUDE_CONFIG_DIR`(隔離した設定フォルダ)、`YAOYOROZU_LIVE_CWD`、
    /// `YAOYOROZU_LIVE_SESSION_ID`(その設定フォルダに作った会話)。未指定なら何もしない。
    #[test]
    #[ignore]
    fn live_claude_in_an_isolated_logged_out_config_starts_answers_and_stops() {
        let (Ok(config_dir), Ok(cwd), Ok(session_id)) = (
            std::env::var("YAOYOROZU_LIVE_CLAUDE_CONFIG_DIR"),
            std::env::var("YAOYOROZU_LIVE_CWD"),
            std::env::var("YAOYOROZU_LIVE_SESSION_ID"),
        ) else {
            println!("YAOYOROZU_LIVE_* が未指定のためスキップします");
            return;
        };
        std::env::set_var("CLAUDE_CONFIG_DIR", &config_dir);
        let (sink, rx) = sink();
        let launcher = ClaudeCliProcessLauncher::new();
        let process = launcher
            .start(
                &StartRunningSession {
                    session_id,
                    cwd: PathBuf::from(cwd),
                    mode: RunningPermissionMode::Default,
                },
                sink,
            )
            .expect("claude should start");
        let mut seen = Vec::new();

        process
            .send_user_message("テスト質問です(実CLI・未ログイン)", &[])
            .unwrap();
        wait_for(&rx, &mut seen, |e| {
            matches!(
                e,
                RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. })
            )
        });
        println!("受け取った出来事: {seen:#?}");
        assert!(seen.contains(&RunningSessionEvent::Initialized));
        assert!(seen.iter().any(|e| matches!(
            e,
            RunningSessionEvent::Progress(ProgressEvent::SentLineConfirmed { .. })
        )));
        // 未ログインなので、ターンは失敗で終わる
        assert!(matches!(
            seen.last(),
            Some(RunningSessionEvent::Progress(ProgressEvent::TurnFinished {
                succeeded: false
            }))
        ));

        let started = Instant::now();
        process.stop();
        println!("stop に要した時間: {:?}", started.elapsed());
        let exited = wait_for(&rx, &mut seen, |e| {
            matches!(e, RunningSessionEvent::Exited { .. })
        });
        println!("終了: {exited:?}");
        assert!(matches!(exited, RunningSessionEvent::Exited { .. }));
    }
}
