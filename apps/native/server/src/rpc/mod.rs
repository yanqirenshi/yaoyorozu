//! `POST /rpc/<command 名>`。本文 = 今の command の引数(キーは camelCase)、応答 = 今の DTO。
//! 写し元は `apps/native/tauri/src/lib.rs` の各 command。薄い層(引数の変換 → ユースケース(`app`)
//! 呼び出し → DTO 化)だけを持ち、ロジックは `app`・`infra` にある(native.md §1)。
//!
//! command の足し方: ハンドラを書き、`routes()` に 1 行(`.route("/rpc/<名前>", post(...))`)足す。
//! 突き合わせのスクリプト(`scripts/diff-commands.ts`)がこの 1 行を読む。

pub mod claude;
pub mod settings;
pub mod viewer;

use crate::error::ApiError;
use crate::AppContext;
use axum::body::Bytes;
use axum::routing::post;
use axum::Router;
use serde::de::DeserializeOwned;

/// 本文を引数へ読む。空の本文は `{}` と見なす(引数の無い command のため)。
pub(crate) fn parse_args<T: DeserializeOwned>(body: &Bytes) -> Result<T, ApiError> {
    let slice: &[u8] = if body.iter().all(u8::is_ascii_whitespace) {
        b"{}"
    } else {
        body
    };
    serde_json::from_slice(slice)
        .map_err(|e| ApiError::new("invalid_input", format!("引数を読めません: {e}")))
}

/// ブロッキング処理を専用スレッドで実行する(`tauri::async_runtime::spawn_blocking` 相当)。
pub(crate) async fn blocking<T, F>(f: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, app::AppError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .unwrap_or_else(|_| {
            Err(app::AppError::Io(
                "バックグラウンド処理に失敗しました".to_string(),
            ))
        })
        .map_err(ApiError::from)
}

/// 未知の command。
async fn unknown_command() -> ApiError {
    ApiError::new("not_found", "その command はありません")
}

pub fn routes() -> Router<AppContext> {
    Router::new()
        .route("/rpc/list_projects", post(viewer::list_projects))
        .route("/rpc/get_settings", post(settings::get_settings))
        .route("/rpc/update_settings", post(settings::update_settings))
        .route("/rpc/switch_profile", post(settings::switch_profile))
        .route("/rpc/create_profile", post(settings::create_profile))
        .route("/rpc/delete_profile", post(settings::delete_profile))
        .route("/rpc/rename_profile", post(settings::rename_profile))
        .route(
            "/rpc/list_pending_warnings",
            post(settings::list_pending_warnings),
        )
        .route(
            "/rpc/dismiss_pending_warning",
            post(settings::dismiss_pending_warning),
        )
        .route("/rpc/check_folder", post(settings::check_folder))
        .route("/rpc/list_sessions", post(viewer::list_sessions))
        .route("/rpc/get_session", post(viewer::get_session))
        .route(
            "/rpc/get_session_line_raw",
            post(viewer::get_session_line_raw),
        )
        .route(
            "/rpc/get_session_line_images",
            post(viewer::get_session_line_images),
        )
        .route(
            "/rpc/check_image_attachment",
            post(viewer::check_image_attachment),
        )
        .route(
            "/rpc/get_project_claude_md",
            post(viewer::get_project_claude_md),
        )
        .route(
            "/rpc/save_project_claude_md",
            post(viewer::save_project_claude_md),
        )
        .route("/rpc/list_rules", post(viewer::list_rules))
        .route("/rpc/get_rule", post(viewer::get_rule))
        .route("/rpc/list_skills", post(viewer::list_skills))
        .route("/rpc/get_skill", post(viewer::get_skill))
        .route(
            "/rpc/get_project_settings_file",
            post(viewer::get_project_settings_file),
        )
        .route(
            "/rpc/save_project_settings_file",
            post(viewer::save_project_settings_file),
        )
        .route(
            "/rpc/get_yyz_scaffold_status",
            post(viewer::get_yyz_scaffold_status),
        )
        .route(
            "/rpc/create_yyz_scaffold",
            post(viewer::create_yyz_scaffold),
        )
        .route("/rpc/get_user_claude_md", post(claude::get_user_claude_md))
        .route(
            "/rpc/save_user_claude_md",
            post(claude::save_user_claude_md),
        )
        .route(
            "/rpc/get_claude_settings_file",
            post(claude::get_claude_settings_file),
        )
        .route(
            "/rpc/save_claude_settings_file",
            post(claude::save_claude_settings_file),
        )
        .route("/rpc/list_claude_dir", post(claude::list_claude_dir))
        .route("/rpc/{command}", post(unknown_command))
}
