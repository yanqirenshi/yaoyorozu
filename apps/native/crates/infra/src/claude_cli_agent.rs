use app::{AgentGateway, AgentMode, AppError, Continuation, SendRequest};
use domain::ImageAttachment;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// `Chat` モードの待ち上限。ツール実行なしのテキスト応答のみを想定するため、
/// フルツールのエージェント実行を前提とした一般的な目安(600秒)より短く取る。
const CHAT_TIMEOUT: Duration = Duration::from_secs(120);

/// `Read` モードの待ち上限。読み取り専用とはいえツール実行(ファイル探索等)を
/// 伴う分、`Chat` より長めに取る。
const READ_TIMEOUT: Duration = Duration::from_secs(300);

fn timeout_for(mode: AgentMode) -> Duration {
    match mode {
        AgentMode::Chat => CHAT_TIMEOUT,
        AgentMode::Read => READ_TIMEOUT,
    }
}

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

/// 起動する `claude` 実行ファイル。現状はPATH解決に任せているが、参照箇所を
/// この1関数に閉じておく(Lab (PM)からの申し送り。issue #345)。アプリが
/// 起動する `claude` はWinGet版(2.1.150)で固定されており、Desktop起源
/// セッションへの`--resume`がこの版で応答まで通るかはLab (PoC:検証)が
/// 確認中(B-0)。結果次第では絶対パスなど別の解決方法に差し替える可能性が
/// あるため、呼び出し元は必ずこの関数経由にすること(直接 `"claude"` を
/// 書かない)。
fn claude_executable() -> &'static str {
    "claude"
}

impl AgentGateway for ClaudeCliAgent {
    fn send(&self, req: SendRequest) -> Result<(), AppError> {
        if !req.cwd.is_dir() {
            return Err(AppError::CwdMissing(format!(
                "作業ディレクトリが見つかりません: {}",
                req.cwd.display()
            )));
        }

        if req.images.is_empty() {
            // 画像なし: 従来どおり本文を引数で渡す(回帰を避けるため経路を分ける。issue #349)。
            let command =
                build_send_message_command(&req.cwd, &req.text, req.mode, &req.continuation);
            run_with_timeout(command, timeout_for(req.mode))?;
        } else {
            let command = build_stream_json_command(&req.cwd, req.mode, &req.continuation);
            let payload = build_stream_json_user_message(&req.images, &req.text);
            let stdout = run_with_timeout_and_stdin(
                command,
                timeout_for(req.mode),
                Some(payload.into_bytes()),
            )?;
            check_stream_json_result(&stdout)?;
        }
        Ok(())
    }
}

/// 送信用の `claude` コマンドを組み立てる。
///
/// `continuation`(`Continuation::Resume(session_id)`)で指定したIDへ
/// `--resume <ID>` で追記する(issue #345)。旧実装の `--continue`
/// (カレントディレクトリの最新の会話をそのまま継続)は、フォルダ内で
/// 表示中以外のセッションが作られると誤って別の会話に追記してしまう
/// ため撤廃した。`--resume <ID>` はIDで追記先を直接指定するため、この
/// 種の誤爆が起きない(現行版では entrypoint に関係なく機能することを
/// 確認済み。reports/claude-desktop-session-resume-limitation.md 追記
/// 2026-09-23)。
///
/// モードによる分岐:
/// - `Chat`: `--tools ""` でツール実行(Bash/Edit等)を一切許可しない。
///   GUIのテキスト欄からの入力でファイル操作やコマンド実行まで確認なしに
///   行わせるのは危険なため。
/// - `Read`: `--permission-mode plan` を付け、既定のツールセットを使う。
///   plan モードは変更を伴う操作を提案するのみで実行しない(`--print` の
///   非対話実行では承認手段がないため、変更系操作は事実上常に未実行のまま
///   終わることを実機で確認済み)。
fn build_send_message_command(
    cwd: &Path,
    text: &str,
    mode: AgentMode,
    continuation: &Continuation,
) -> Command {
    let mut command = base_command(cwd, mode, continuation);
    command.arg("--print").arg(text);
    command
}

/// 画像付き送信用の `claude` コマンドを組み立てる(issue #349)。本文と画像は引数では
/// なく標準入力の stream-json(1行)で渡すため、`--print` に本文は付けない。
/// `--output-format stream-json` は `--verbose` が無いと exit 1 になる(#345 の B-2 で
/// 確認済み)。既存の引数(`--tools ""`/`--permission-mode plan`/`--resume <ID>`)と
/// Desktop 由来の環境変数の除去は本文のみの送信と共通(`base_command`)。
fn build_stream_json_command(cwd: &Path, mode: AgentMode, continuation: &Continuation) -> Command {
    let mut command = base_command(cwd, mode, continuation);
    command.arg("--print");
    command.arg("--input-format").arg("stream-json");
    command.arg("--output-format").arg("stream-json");
    command.arg("--verbose");
    command
}

/// 送信方式によらず共通の部分: 作業ディレクトリ・Desktop由来の環境変数の除去・
/// モードごとの権限引数・`--resume <ID>`。
fn base_command(cwd: &Path, mode: AgentMode, continuation: &Continuation) -> Command {
    let mut command = Command::new(claude_executable());
    command.current_dir(cwd);
    for var in DESKTOP_LINEAGE_ENV_VARS {
        command.env_remove(var);
    }
    match mode {
        AgentMode::Chat => {
            command.arg("--tools").arg("");
        }
        AgentMode::Read => {
            command.arg("--permission-mode").arg("plan");
        }
    }
    let Continuation::Resume(session_id) = continuation;
    command.arg("--resume").arg(session_id);
    command
}

/// stream-json 入力の `content` の要素。Desktop が貼り付けで記録する形
/// (`image` ブロックのあとに `text`)と同じ並びにする。
#[derive(Serialize)]
#[serde(tag = "type")]
enum InputBlock<'a> {
    #[serde(rename = "image")]
    Image { source: ImageSource<'a> },
    #[serde(rename = "text")]
    Text { text: &'a str },
}

#[derive(Serialize)]
struct ImageSource<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    media_type: &'static str,
    data: &'a str,
}

#[derive(Serialize)]
struct InputMessage<'a> {
    role: &'static str,
    content: Vec<InputBlock<'a>>,
}

#[derive(Serialize)]
struct InputLine<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    message: InputMessage<'a>,
}

/// stdin に流す user メッセージ1行(末尾に改行)を組み立てる。ブロックは
/// `[image..., text]` の順。本文が空(画像だけの送信)なら text ブロックは付けない
/// (API は空の text ブロックを拒否するため)。画像データは借用のままシリアライズし、
/// 数MBの文字列を複製しない。
fn build_stream_json_user_message(images: &[ImageAttachment], text: &str) -> String {
    let mut content: Vec<InputBlock> = images
        .iter()
        .map(|image| InputBlock::Image {
            source: ImageSource {
                kind: "base64",
                media_type: image.media_type.as_mime(),
                data: &image.data_base64,
            },
        })
        .collect();
    if !text.trim().is_empty() {
        content.push(InputBlock::Text { text });
    }
    let line = InputLine {
        kind: "user",
        message: InputMessage {
            role: "user",
            content,
        },
    };
    // 借用した文字列のシリアライズは失敗しない(キーは文字列のみ)。
    let mut json = serde_json::to_string(&line).unwrap_or_default();
    json.push('\n');
    json
}

/// stream-json の標準出力から `type: "result"` の行を探し、`is_error: true` なら失敗にする。
/// 出力の先頭に来る `hook_started`/`hook_response` 行は一時的な別の session_id を持つため
/// (#345 の B-2)、session_id を読む場合は `system/init` か `result` の行からにすること。
/// 本実装は送信先を `--resume <ID>` で固定しており session_id を出力から読まないので、
/// 見るのは `result` 行の `is_error` のみ。エラー本文は出さない(秘匿情報を含みうるため)。
fn check_stream_json_result(stdout: &str) -> Result<(), AppError> {
    let result = stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .rfind(|value| value.get("type").and_then(|t| t.as_str()) == Some("result"));
    if let Some(result) = result {
        if result.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
            let subtype = result
                .get("subtype")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");
            return Err(AppError::CliFailed(format!(
                "claude がエラーを返しました({subtype})"
            )));
        }
    }
    Ok(())
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
fn run_with_timeout(command: Command, timeout: Duration) -> Result<String, AppError> {
    run_with_timeout_and_stdin(command, timeout, None)
}

/// [`run_with_timeout`] に、標準入力へ書き込むデータを渡せるようにしたもの
/// (`stdin_data` が `None` なら標準入力は空)。数十MBの画像を含みうるため、書き込みは
/// 別スレッドで行い(パイプが詰まっても子の出力読み取り・待機を止めない)、
/// 書き終えたら閉じる。子が先に終了して書き込みが失敗しても、結果は終了
/// ステータスで判断する。
fn run_with_timeout_and_stdin(
    mut command: Command,
    timeout: Duration,
    stdin_data: Option<Vec<u8>>,
) -> Result<String, AppError> {
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(if stdin_data.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });

    let program = command.get_program().to_string_lossy().to_string();
    let mut child = command.spawn().map_err(|e| map_spawn_error(&program, e))?;

    let writer = stdin_data.and_then(|data| {
        child.stdin.take().map(|mut pipe| {
            std::thread::spawn(move || {
                let _ = pipe.write_all(&data);
                // pipe をここで drop して標準入力を閉じる。
            })
        })
    });

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
                    if let Some(writer) = writer {
                        let _ = writer.join();
                    }
                    return Err(AppError::Timeout(format!(
                        "{program} がタイムアウトしました({}秒)",
                        timeout.as_secs()
                    )));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = reader.join();
                if let Some(writer) = writer {
                    let _ = writer.join();
                }
                return Err(AppError::Io(format!("{program} の待機に失敗しました: {e}")));
            }
        }
    };

    let stdout = reader.join().unwrap_or_default();
    if let Some(writer) = writer {
        let _ = writer.join();
    }

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

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn build_send_message_command_chat_mode_disables_all_tools() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(
            &cwd,
            "hello",
            AgentMode::Chat,
            &Continuation::Resume("s1".to_string()),
        );
        assert_eq!(
            args_of(&command),
            vec!["--tools", "", "--resume", "s1", "--print", "hello"]
        );
    }

    #[test]
    fn build_send_message_command_read_mode_uses_plan_permission_mode() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(
            &cwd,
            "hello",
            AgentMode::Read,
            &Continuation::Resume("s1".to_string()),
        );
        assert_eq!(
            args_of(&command),
            vec![
                "--permission-mode",
                "plan",
                "--resume",
                "s1",
                "--print",
                "hello"
            ]
        );
    }

    #[test]
    fn build_send_message_command_resumes_the_given_session_id() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(
            &cwd,
            "hello",
            AgentMode::Chat,
            &Continuation::Resume("target-session".to_string()),
        );
        assert_eq!(
            args_of(&command),
            vec![
                "--tools",
                "",
                "--resume",
                "target-session",
                "--print",
                "hello"
            ]
        );
    }

    #[test]
    fn build_send_message_command_removes_desktop_lineage_env_vars() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_send_message_command(
            &cwd,
            "hello",
            AgentMode::Chat,
            &Continuation::Resume("s1".to_string()),
        );
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

    fn png(data: &str) -> ImageAttachment {
        ImageAttachment {
            media_type: domain::ImageMediaType::Png,
            data_base64: data.to_string(),
        }
    }

    #[test]
    fn build_stream_json_command_keeps_existing_args_and_adds_stream_json_flags() {
        // issue #349: 既存の引数(--tools ""/--permission-mode/--resume)は維持し、
        // 本文は引数ではなく stdin で渡す(--print に本文を付けない)。
        let cwd = std::env::current_dir().unwrap();
        let resume = Continuation::Resume("s1".to_string());

        let chat = build_stream_json_command(&cwd, AgentMode::Chat, &resume);
        assert_eq!(
            args_of(&chat),
            vec![
                "--tools",
                "",
                "--resume",
                "s1",
                "--print",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose"
            ]
        );
        let read = build_stream_json_command(&cwd, AgentMode::Read, &resume);
        assert_eq!(
            &args_of(&read)[..4],
            &["--permission-mode", "plan", "--resume", "s1"]
        );
    }

    #[test]
    fn build_stream_json_command_removes_desktop_lineage_env_vars() {
        let cwd = std::env::current_dir().unwrap();
        let command = build_stream_json_command(
            &cwd,
            AgentMode::Chat,
            &Continuation::Resume("s1".to_string()),
        );
        let removed: Vec<String> = command
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k.to_string_lossy().to_string())
            .collect();
        for var in DESKTOP_LINEAGE_ENV_VARS {
            assert!(removed.contains(&(*var).to_string()), "{var}: {removed:?}");
        }
    }

    #[test]
    fn stream_json_user_message_puts_images_before_text_on_a_single_line() {
        let json = build_stream_json_user_message(&[png("AAAA"), png("BBBB")], "見て");

        assert!(json.ends_with('\n'));
        assert_eq!(json.matches('\n').count(), 1, "stdin に流すのは1行だけ");
        let value: serde_json::Value = serde_json::from_str(json.trim_end()).unwrap();
        assert_eq!(value["type"], "user");
        assert_eq!(value["message"]["role"], "user");
        let content = value["message"]["content"].as_array().unwrap();
        let types: Vec<&str> = content
            .iter()
            .map(|b| b["type"].as_str().unwrap())
            .collect();
        assert_eq!(types, vec!["image", "image", "text"]);
        assert_eq!(content[0]["source"]["type"], "base64");
        assert_eq!(content[0]["source"]["media_type"], "image/png");
        assert_eq!(content[0]["source"]["data"], "AAAA");
        assert_eq!(content[1]["source"]["data"], "BBBB");
        assert_eq!(content[2]["text"], "見て");
    }

    #[test]
    fn stream_json_user_message_omits_the_text_block_when_text_is_blank() {
        let json = build_stream_json_user_message(&[png("AAAA")], "   ");
        let value: serde_json::Value = serde_json::from_str(json.trim_end()).unwrap();
        let content = value["message"]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "image");
    }

    #[test]
    fn check_stream_json_result_fails_only_on_an_error_result_line() {
        // 先頭の hook 行は別の session_id を持つが、判定には使わない。
        let ok = [
            r#"{"type":"system","subtype":"hook_started","session_id":"tmp"}"#,
            r#"{"type":"system","subtype":"init","session_id":"s1"}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"session_id":"s1"}"#,
        ]
        .join("\n");
        assert!(check_stream_json_result(&ok).is_ok());

        let failed = [
            r#"{"type":"system","subtype":"init","session_id":"s1"}"#,
            r#"{"type":"result","subtype":"error_during_execution","is_error":true}"#,
        ]
        .join("\n");
        let error = check_stream_json_result(&failed).expect_err("error result");
        assert!(matches!(&error, AppError::CliFailed(m) if m.contains("error_during_execution")));

        // result 行が無い・JSONでない出力は、終了ステータスに任せて成功扱い。
        assert!(check_stream_json_result("").is_ok());
        assert!(check_stream_json_result("not json").is_ok());
    }

    #[test]
    fn run_with_timeout_and_stdin_delivers_large_stdin_without_deadlock() {
        // パイプのバッファより大きいデータを流し、子が同時に出力しても詰まらないこと。
        let mut command = if cfg!(windows) {
            let mut c = Command::new("findstr");
            c.arg("^");
            c
        } else {
            Command::new("cat")
        };
        command.env_remove("NOTHING");
        let line_count = 200_000;
        let data = "x\n".repeat(line_count).into_bytes();

        let stdout =
            run_with_timeout_and_stdin(command, Duration::from_secs(30), Some(data)).unwrap();

        assert_eq!(stdout.lines().count(), line_count);
    }

    #[test]
    fn timeout_for_read_mode_is_longer_than_chat_mode() {
        assert!(timeout_for(AgentMode::Read) > timeout_for(AgentMode::Chat));
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
                images: vec![],
                continuation: Continuation::Resume("s1".to_string()),
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
