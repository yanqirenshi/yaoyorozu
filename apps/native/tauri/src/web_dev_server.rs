//! ビューアの「仕様」リンクから、apps/web の開発サーバ(`npm run web:dev`)が動いていなければ
//! 起動してから開く(issue #530)。native.md §1 のとおり、ここは薄い層:
//! 判断(`app::web_app_readiness`)→ 起動・確認(`infra`)の呼び出し → DTO 化のみ。
//!
//! Web アプリの実体は常に yaoyorozu リポジトリに1つだけで、起動先は「仕様」を押した
//! プロファイルの `repository_path` ではなく `web:dev` を持つリポジトリを探して使う
//! (`app::find_web_app_repository`)。開く URL には押したプロファイルのリポジトリ名を
//! 付ける(`app::web_app_spec_url`。issue #554。詳細は両関数のドキュメント参照)。
//!
//! native.md §3.3 は長時間処理に Channel + キャンセル用 command を求めるが、ここでは使わない
//! (意図的な逸脱。理由を明記): この処理は起動を待つだけの単発操作で、せいぜい数十秒
//! (上限 [`START_TIMEOUT`])に収まり、利用者が途中で気を変えても起動済みの開発サーバを
//! 殺す意味が無い(次に「仕様」を押したときにそのまま使える方が望ましい)。フロント側は
//! 1回の `invoke` が返るまでボタンを無効化するだけで「分かるように出す」を満たせる。

use crate::dto::AppWarningEventDto;
use crate::running_session::APP_WARNING_EVENT;
use crate::state::{AppState, WebDevServerSlot};
use app::{WebAppProbe, WebDevServerLauncher};
use infra::HttpWebAppProbe;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

/// 1回の応答確認にかけるタイムアウト(応答が無いときに気づくまでの時間)。
const PROBE_TIMEOUT: Duration = Duration::from_millis(800);
/// 起動を待つ間、確認を繰り返す間隔。
const POLL_INTERVAL: Duration = Duration::from_millis(1500);
/// 起動を待つ上限(初回コンパイルで数十秒かかることがあるため余裕を持たせる。issue #530)。
const START_TIMEOUT: Duration = Duration::from_secs(120);

/// Web アプリ(apps/web の開発サーバ)が応答するまで必要なら起動して待ち、開くべき URL
/// (`app::web_app_spec_url`)を返す。応答していれば何もせずすぐ返る(二重起動しない)。
/// 呼び出し側(フロント)はこれが終わってから戻り値の URL を `openUrl` で開く。
#[tauri::command]
pub async fn ensure_web_app_running(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: Option<String>,
) -> Result<String, crate::dto::AppErrorDto> {
    let settings = state.lock().await.settings.clone();
    let url = app::web_app_spec_url(&settings, profile_id.as_deref())
        .inspect_err(|e| warn(&app_handle, &e.to_string()))?;

    let responding = probe().await;
    let tracked = state.lock().await.web_dev_server.is_some();
    match app::web_app_readiness(responding, tracked) {
        app::WebAppReadiness::AlreadyResponding => return Ok(url),
        app::WebAppReadiness::Starting => {}
        app::WebAppReadiness::NeedsStart => {
            let repository_path = app::find_web_app_repository(
                &settings,
                &infra::PackageJsonWebAppRepositoryProbe::new(),
            )
            .inspect_err(|e| warn(&app_handle, &e.to_string()))?;
            let process = tauri::async_runtime::spawn_blocking(move || {
                infra::NpmWebDevServerLauncher::new().start(&repository_path)
            })
            .await
            .unwrap_or_else(|_| {
                Err(app::AppError::Io(
                    "バックグラウンド処理に失敗しました".to_string(),
                ))
            })
            .inspect_err(|e| warn(&app_handle, &e.to_string()))?;
            state.lock().await.web_dev_server = Some(WebDevServerSlot { process });
        }
    }

    let deadline = std::time::Instant::now() + START_TIMEOUT;
    while std::time::Instant::now() < deadline {
        if probe().await {
            return Ok(url);
        }
        // 追跡中のプロセスがもう終了していたら、タイムアウトまで待たずに失敗にする
        // (issue #554。例: 登録を誤ったリポジトリで `web:dev` が無く即終了した場合)。
        if let Some(output) = exited_output(&state).await {
            stop_tracked(&state).await;
            let message = failure_message(&output);
            warn(&app_handle, &message);
            return Err(app::AppError::CliFailed(message).into());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    // タイムアウトしたら追跡を諦める(issue #530 のレビュー指摘): 残したままだと
    // `web_app_readiness` がずっと `Starting` を返し、次に押しても起動し直せず
    // 固まってしまう。生きていれば(クラッシュではなく単に遅いだけ)止めてから捨てる
    // (捨てるだけで止めないと、次の起動が同じポートに重なる)。次に押せば `NeedsStart`
    // から起動し直せる。
    stop_tracked(&state).await;
    let message =
        "Web アプリ(apps/web)の起動がタイムアウトしました。手動で `npm run web:dev` の様子を確認してください".to_string();
    warn(&app_handle, &message);
    Err(app::AppError::Io(message).into())
}

/// 追跡中のプロセスがもう終了していれば、原因の手がかりになる末尾の出力を返す。
async fn exited_output(state: &tauri::State<'_, Mutex<AppState>>) -> Option<String> {
    state
        .lock()
        .await
        .web_dev_server
        .as_ref()
        .and_then(|slot| slot.process.exited_with_output())
}

/// 追跡中のプロセスを止めて捨てる(無ければ何もしない)。
async fn stop_tracked(state: &tauri::State<'_, Mutex<AppState>>) {
    if let Some(slot) = state.lock().await.web_dev_server.take() {
        slot.process.stop();
    }
}

fn failure_message(output: &str) -> String {
    if output.trim().is_empty() {
        "Web アプリ(apps/web)の起動に失敗しました(終了しました)".to_string()
    } else {
        format!(
            "Web アプリ(apps/web)の起動に失敗しました(終了しました)。出力の末尾:\n{}",
            output.trim()
        )
    }
}

/// 短いタイムアウトで `http://127.0.0.1:<port>/` へ確認する(ブロッキング I/O のため
/// スレッドへ逃がす)。
async fn probe() -> bool {
    tauri::async_runtime::spawn_blocking(|| HttpWebAppProbe::new(PROBE_TIMEOUT).is_responding())
        .await
        .unwrap_or(false)
}

fn warn(app_handle: &tauri::AppHandle, message: &str) {
    eprintln!("{message}");
    let _ = app_handle.emit(
        APP_WARNING_EVENT,
        AppWarningEventDto {
            message: message.to_string(),
        },
    );
}

/// app の終了時に、起動した Web アプリの開発サーバを止める(自分が起動したものだけ。
/// 手動起動分は追跡していないため対象にならない。issue #530)。
pub fn stop_web_dev_server_on_exit(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<Mutex<AppState>>();
    let process =
        tauri::async_runtime::block_on(async { state.lock().await.web_dev_server.take() });
    if let Some(slot) = process {
        slot.process.stop();
    }
}
