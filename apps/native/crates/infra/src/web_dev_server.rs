//! apps/web の開発サーバ(`npm run web:dev`)の起動・応答確認(issue #530)。
//! `claude` CLI の起動(`claude_cli.rs` / `claude_cli_process.rs`)と同じ流儀: 実行ファイルの
//! 解決・起動失敗の分類・プロセスツリーごとの終了。

use app::{
    AppError, WebAppProbe, WebAppRepositoryProbe, WebDevServerLauncher, WebDevServerProcess,
    WEB_DEV_SERVER_PORT,
};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 起動失敗時のメッセージに添える、標準出力・標準エラーの末尾の行数(issue #554)。
const OUTPUT_TAIL_LINES: usize = 20;

/// `npm run web:dev` を起動する実行ファイル。PATH解決に任せる(`claude_executable` と同じ
/// 考え方。issue #345の申し送り)。
fn npm_executable() -> &'static str {
    "npm"
}

/// `npm run web:dev`(apps/web の開発サーバ)を起動する [`WebDevServerLauncher`] 実装。
pub struct NpmWebDevServerLauncher;

impl NpmWebDevServerLauncher {
    pub fn new() -> Self {
        Self
    }
}

impl Default for NpmWebDevServerLauncher {
    fn default() -> Self {
        Self::new()
    }
}

impl WebDevServerLauncher for NpmWebDevServerLauncher {
    fn start(
        &self,
        repository_path: &Path,
    ) -> Result<std::sync::Arc<dyn WebDevServerProcess>, AppError> {
        if !repository_path.is_dir() {
            return Err(AppError::CwdMissing(format!(
                "リポジトリが見つかりません: {}",
                repository_path.display()
            )));
        }
        let mut command = Command::new(npm_executable());
        command.args(["run", "web:dev"]);
        command.current_dir(repository_path);
        // 標準出力・標準エラーは捨てずに拾う(issue #554)。失敗(例: web:dev を持たない
        // リポジトリで起動してしまった)に即座に気づき、理由をメッセージに添えるため。
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::CliNotFound(
                    "npm コマンドが見つかりません。Node.js がインストールされているか確認してください。"
                        .to_string(),
                )
            } else {
                AppError::Io(format!("npm の起動に失敗しました: {e}"))
            }
        })?;
        let tail = OutputTail::new();
        if let Some(stdout) = child.stdout.take() {
            spawn_tail_reader(stdout, tail.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_tail_reader(stderr, tail.clone());
        }
        Ok(std::sync::Arc::new(NpmWebDevServerProcess {
            pid: child.id(),
            child: Mutex::new(child),
            tail,
        }))
    }
}

/// 標準出力・標準エラーの末尾 [`OUTPUT_TAIL_LINES`] 行を保持するリングバッファ(issue #554)。
/// stdout と stderr の両方の読み取りスレッドから共有して書き込む(混ざった行の前後関係は
/// 保証しないが、失敗原因の手がかりとしては十分)。
struct OutputTail {
    lines: Mutex<VecDeque<String>>,
}

impl OutputTail {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            lines: Mutex::new(VecDeque::new()),
        })
    }

    fn push(&self, line: String) {
        let mut lines = self.lines.lock().unwrap_or_else(|e| e.into_inner());
        if lines.len() >= OUTPUT_TAIL_LINES {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    fn snapshot(&self) -> String {
        self.lines
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// `reader` を1行ずつ読んで `tail` へ流し込むスレッドを起動する。プロセスが終了して
/// パイプが閉じれば自然にスレッドも終わる(join不要。issue #554)。
fn spawn_tail_reader<R: Read + Send + 'static>(reader: R, tail: Arc<OutputTail>) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            tail.push(line);
        }
    });
}

struct NpmWebDevServerProcess {
    pid: u32,
    child: Mutex<Child>,
    tail: Arc<OutputTail>,
}

impl WebDevServerProcess for NpmWebDevServerProcess {
    fn pid(&self) -> u32 {
        self.pid
    }

    fn stop(&self) {
        // `npm run web:dev` は npm(シム) → node(Next.js)と子を持つため、`Child::kill` だけでは
        // 直接の子(npm)しか止まらず、実際にポートを握っている子孫が残る。ツリーごと終わらせる
        // (`claude_cli_process.rs::kill_process_tree` と同じ考え方。issue #530)。
        kill_process_tree(self.pid);
        let _ = self.child.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }

    fn exited_with_output(&self) -> Option<String> {
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        match child.try_wait() {
            Ok(Some(_status)) => Some(self.tail.snapshot()),
            _ => None,
        }
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// Web アプリ(`http://127.0.0.1:<WEB_DEV_SERVER_PORT>/`)への短いタイムアウトの GET で
/// 応答を確かめる [`WebAppProbe`] 実装。ステータスコードは問わない(応答そのものが
/// 「動いている」の合図。issue #530)。接続できなければ応答無しとみなす。
pub struct HttpWebAppProbe {
    client: reqwest::blocking::Client,
    url: String,
}

impl HttpWebAppProbe {
    /// `timeout` は1回の確認にかける時間。初回の確認(短く)と、起動を待つ間の繰り返し確認
    /// (呼び出し側がループする)の両方で、このインスタンスをそのまま使ってよい。
    pub fn new(timeout: Duration) -> Self {
        Self {
            client: reqwest::blocking::Client::builder()
                .timeout(timeout)
                .build()
                .unwrap_or_else(|_| reqwest::blocking::Client::new()),
            url: format!("http://127.0.0.1:{WEB_DEV_SERVER_PORT}/"),
        }
    }
}

impl WebAppProbe for HttpWebAppProbe {
    fn is_responding(&self) -> bool {
        self.client.get(&self.url).send().is_ok()
    }
}

/// `repository_path/package.json` を読み、`scripts.web:dev` の有無で Web アプリ(apps/web)
/// を持つかを確かめる [`WebAppRepositoryProbe`] 実装(issue #554)。読めない・JSON として
/// 壊れている等はすべて「持たない」として扱う(多数のリポジトリを順に見るだけの判定に
/// エラーを伝播させる必要はない)。
pub struct PackageJsonWebAppRepositoryProbe;

impl PackageJsonWebAppRepositoryProbe {
    pub fn new() -> Self {
        Self
    }
}

impl Default for PackageJsonWebAppRepositoryProbe {
    fn default() -> Self {
        Self::new()
    }
}

impl WebAppRepositoryProbe for PackageJsonWebAppRepositoryProbe {
    fn has_web_dev_script(&self, repository_path: &Path) -> bool {
        let Ok(content) = std::fs::read_to_string(repository_path.join("package.json")) else {
            return false;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
            return false;
        };
        value
            .get("scripts")
            .and_then(|scripts| scripts.get("web:dev"))
            .is_some()
    }
}

#[cfg(test)]
mod package_json_probe_tests {
    use super::*;

    #[test]
    fn detects_the_web_dev_script_when_present() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("package.json"),
            r#"{"scripts":{"web:dev":"npm run tokens && npm run dev --workspace=web"}}"#,
        )
        .expect("write package.json");

        assert!(PackageJsonWebAppRepositoryProbe::new().has_web_dev_script(dir.path()));
    }

    #[test]
    fn reports_false_when_the_script_is_absent() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("package.json"),
            r#"{"scripts":{"build":"tsc"}}"#,
        )
        .expect("write package.json");

        assert!(!PackageJsonWebAppRepositoryProbe::new().has_web_dev_script(dir.path()));
    }

    #[test]
    fn reports_false_when_package_json_is_missing() {
        let dir = tempfile::tempdir().expect("tempdir");

        assert!(!PackageJsonWebAppRepositoryProbe::new().has_web_dev_script(dir.path()));
    }

    #[test]
    fn reports_false_when_package_json_is_not_valid_json() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("package.json"), "not json").expect("write package.json");

        assert!(!PackageJsonWebAppRepositoryProbe::new().has_web_dev_script(dir.path()));
    }
}
