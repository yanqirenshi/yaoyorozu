//! 認証と Host の確認(DNS rebinding・他サイトからの呼び出し対策)。
//!
//! - 全エンドポイントで `Host` が `127.0.0.1:<port>` / `localhost:<port>` であることを確かめる。
//! - `/health` 以外は `Authorization: Bearer <トークン>` を必須にする(読み取りも含む)。

use crate::error::ApiError;
use crate::AppContext;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap};
use axum::middleware::Next;
use axum::response::Response;

pub fn host_is_allowed(headers: &HeaderMap, port: u16) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    host.eq_ignore_ascii_case(&format!("127.0.0.1:{port}"))
        || host.eq_ignore_ascii_case(&format!("localhost:{port}"))
}

/// 長さ以外の情報を漏らさない比較(タイミング攻撃の対策)。
fn token_matches(given: &str, expected: &str) -> bool {
    let (a, b) = (given.as_bytes(), expected.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn is_authorized(headers: &HeaderMap, expected_token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|given| token_matches(given, expected_token))
}

pub async fn guard(
    State(ctx): State<AppContext>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    if !host_is_allowed(request.headers(), ctx.port) {
        return Err(ApiError::new("forbidden_host", "Host が許可されていません"));
    }
    if request.uri().path() != "/health" && !is_authorized(request.headers(), &ctx.token) {
        return Err(ApiError::new("unauthorized", "認証に失敗しました"));
    }
    Ok(next.run(request).await)
}
