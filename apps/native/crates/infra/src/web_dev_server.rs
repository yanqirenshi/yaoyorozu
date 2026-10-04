//! apps/web の開発サーバ(`npm run web:dev`)の起動・応答確認(issue #530)。
//! `claude` CLI の起動(`claude_cli.rs` / `claude_cli_process.rs`)と同じ流儀: 実行ファイルの
//! 解決・起動失敗の分類・プロセスツリーごとの終了。

use app::{AppError, WebAppProbe, WebDevServerLauncher, WebDevServerProcess, WEB_DEV_SERVER_PORT};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

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
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::CliNotFound(
                    "npm コマンドが見つかりません。Node.js がインストールされているか確認してください。"
                        .to_string(),
                )
            } else {
                AppError::Io(format!("npm の起動に失敗しました: {e}"))
            }
        })?;
        Ok(std::sync::Arc::new(NpmWebDevServerProcess {
            pid: child.id(),
            child: Mutex::new(child),
        }))
    }
}

struct NpmWebDevServerProcess {
    pid: u32,
    child: Mutex<Child>,
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
