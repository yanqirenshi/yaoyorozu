//! 設定画面から、リポジトリに `yyz/`(issue #543)を作る(issue #547)。native.md §1 のとおり、
//! ここは薄い層: `repository_path` の解決(フロントからパスを受け取らない。native.md §4)→
//! ユースケース(`app`)呼び出し → DTO 化のみ。

use crate::dto::{AppErrorDto, YyzScaffoldStatusDto};
use crate::state::AppState;
use infra::FileYyzScaffoldWriter;
use tokio::sync::Mutex;

/// 今の `yyz/` の状態を確かめる(副作用なし)。`repository_path` が未設定のプロファイルは
/// `resolve_repository_dir` がエラーを返す。
#[tauri::command]
pub async fn get_yyz_scaffold_status(
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: Option<String>,
) -> Result<YyzScaffoldStatusDto, AppErrorDto> {
    let settings = state.lock().await.settings.clone();
    let repository_path = app::resolve_repository_dir(&settings, profile_id.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        app::yyz_scaffold_status(&FileYyzScaffoldWriter::new(), &repository_path)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map(Into::into)
    .map_err(Into::into)
}

/// `yyz/` のうち足りないものだけ作る。既存のファイルは絶対に上書きしない
/// (`app::create_yyz_scaffold` のドキュメント参照)。
#[tauri::command]
pub async fn create_yyz_scaffold(
    state: tauri::State<'_, Mutex<AppState>>,
    profile_id: Option<String>,
) -> Result<YyzScaffoldStatusDto, AppErrorDto> {
    let settings = state.lock().await.settings.clone();
    let repository_path = app::resolve_repository_dir(&settings, profile_id.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        app::create_yyz_scaffold(&FileYyzScaffoldWriter::new(), &repository_path)
    })
    .await
    .unwrap_or_else(|_| {
        Err(app::AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    })
    .map(Into::into)
    .map_err(Into::into)
}
