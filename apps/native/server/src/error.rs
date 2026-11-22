//! エラーの HTTP 表現。
//!
//! 本文は今の `AppErrorDto`(`{code, message}`)のまま。HTTP ステータスは `code` から決める。
//! フロントは必ず本文の `code` で分岐する(ステータスは補助)。
//!
//! | code | status |
//! |---|---|
//! | `invalid_input` | 400 |
//! | `unauthorized`(サーバの認証失敗。`AppError` には無い) | 401 |
//! | `forbidden_host`(Host 違い。同上) | 403 |
//! | `github_unauthenticated` `github_auth_expired` `github_scope_insufficient` | 403(401 はサーバの認証失敗専用に空けておく) |
//! | `not_found` | 404 |
//! | `session_busy` `file_conflict` `claude_md_conflict` `settings_conflict`(設定の版が古い) | 409 |
//! | `cwd_missing` | 422 |
//! | `github_api_failed` | 502 |
//! | `timeout` | 504 |
//! | `io` `cli_not_found` `cli_failed` `worktree_sync_failed` ほか | 500 |

use crate::dto::AppErrorDto;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

pub fn status_for_code(code: &str) -> StatusCode {
    match code {
        "invalid_input" => StatusCode::BAD_REQUEST,
        "unauthorized" => StatusCode::UNAUTHORIZED,
        "settings_conflict" => StatusCode::CONFLICT,
        "forbidden_host"
        | "github_unauthenticated"
        | "github_auth_expired"
        | "github_scope_insufficient" => StatusCode::FORBIDDEN,
        "not_found" => StatusCode::NOT_FOUND,
        "session_busy" | "file_conflict" | "claude_md_conflict" => StatusCode::CONFLICT,
        "cwd_missing" => StatusCode::UNPROCESSABLE_ENTITY,
        "github_api_failed" => StatusCode::BAD_GATEWAY,
        "timeout" => StatusCode::GATEWAY_TIMEOUT,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// ハンドラの失敗。本文は `AppErrorDto`。
pub struct ApiError(pub AppErrorDto);

impl ApiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self(AppErrorDto {
            code: code.to_string(),
            message: message.into(),
        })
    }
}

impl From<app::AppError> for ApiError {
    fn from(error: app::AppError) -> Self {
        Self(error.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (status_for_code(&self.0.code), Json(self.0)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_app_error_code_maps_to_a_non_401_status() {
        for code in [
            "not_found",
            "io",
            "invalid_input",
            "session_busy",
            "cli_not_found",
            "cli_failed",
            "timeout",
            "cwd_missing",
            "github_unauthenticated",
            "github_auth_expired",
            "github_api_failed",
            "github_scope_insufficient",
            "claude_md_conflict",
            "file_conflict",
            "worktree_sync_failed",
        ] {
            assert_ne!(status_for_code(code), StatusCode::UNAUTHORIZED, "{code}");
        }
    }

    #[test]
    fn statuses_follow_the_table() {
        assert_eq!(status_for_code("not_found"), StatusCode::NOT_FOUND);
        assert_eq!(status_for_code("invalid_input"), StatusCode::BAD_REQUEST);
        assert_eq!(status_for_code("io"), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(status_for_code("unauthorized"), StatusCode::UNAUTHORIZED);
    }
}
