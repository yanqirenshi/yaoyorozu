use crate::state::AppState;
use app::AppError;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use infra::{FileLayoutStore, FileLocalApiTokenStore, SystemGitWorktreeLister};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

/// ローカルAPIサーバ(native.md §7)のハンドラが共有する状態。`app_handle`
/// 経由で既存の `tauri::State<Mutex<AppState>>`(§2 のSSoT)をそのまま
/// 参照する(`#[tauri::command]` と同じ実体を見る。専用の複製は持たない)。
#[derive(Clone)]
struct LocalApiState {
    app_handle: tauri::AppHandle,
    token: Arc<String>,
    version: Arc<String>,
}

#[derive(Serialize)]
struct HealthResponseDto {
    ok: bool,
    version: String,
}

#[derive(Deserialize)]
struct SaveLayoutRequestDto {
    repo_root: String,
    overrides: serde_json::Value,
}

async fn health_handler(State(state): State<LocalApiState>) -> Json<HealthResponseDto> {
    Json(HealthResponseDto {
        ok: true,
        version: (*state.version).clone(),
    })
}

fn is_authorized(headers: &HeaderMap, expected_token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        == Some(expected_token)
}

/// `POST /layout/{diagram}`。認証・検証(diagram許可リスト・repo_root一致)・
/// 書き込みは全て `app::save_layout` に委譲する(native.md §7・issue #122)。
/// このハンドラの役割は引数変換とHTTPステータスへのマッピングのみ。
async fn save_layout_handler(
    State(state): State<LocalApiState>,
    AxumPath(diagram): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<SaveLayoutRequestDto>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !is_authorized(&headers, &state.token) {
        return Err((StatusCode::UNAUTHORIZED, "認証に失敗しました".to_string()));
    }

    let app_state = state.app_handle.state::<Mutex<AppState>>();
    let settings = app_state.lock().await.settings.clone();
    let repo_root = PathBuf::from(body.repo_root);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let store = FileLayoutStore::new();
        let worktrees = SystemGitWorktreeLister::new();
        app::save_layout(
            &store,
            &worktrees,
            &settings,
            &diagram,
            &repo_root,
            &body.overrides,
        )
    })
    .await
    .unwrap_or_else(|_| {
        Err(AppError::Io(
            "バックグラウンド処理に失敗しました".to_string(),
        ))
    });

    match result {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(AppError::NotFound(message)) => Err((StatusCode::NOT_FOUND, message)),
        Err(AppError::InvalidInput(message)) => Err((StatusCode::FORBIDDEN, message)),
        Err(AppError::Io(_)) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "レイアウトの保存に失敗しました".to_string(),
        )),
        Err(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "予期しないエラーが発生しました".to_string(),
        )),
    }
}

fn router(state: LocalApiState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/layout/{diagram}", post(save_layout_handler))
        .with_state(state)
}

/// ローカルAPIサーバを起動する(native.md §7)。トークンは起動のたびに
/// 新規生成して `app_data_dir/local-api-token` へ上書き保存し(前回分は
/// 無効化)、127.0.0.1 の固定ポート(`app::LOCAL_API_PORT`)で listen する。
/// ポート使用中等の起動失敗はアプリを止めず、既存のウォッチャー起動失敗
/// (`start_session_watcher`)と同じ流儀で警告ログに留める。
pub fn start(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let token_path = app.path().app_data_dir()?.join("local-api-token");
    let token = app::generate_local_api_token();
    let token_store = FileLocalApiTokenStore::new(token_path);
    if let Err(e) = app::save_local_api_token(&token_store, &token) {
        eprintln!("ローカルAPIトークンの保存に失敗しました: {e}");
    }

    let state = LocalApiState {
        app_handle: app.handle().clone(),
        token: Arc::new(token),
        version: Arc::new(app.package_info().version.to_string()),
    };

    tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::from(([127, 0, 0, 1], app::LOCAL_API_PORT));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, router(state)).await {
                    eprintln!("ローカルAPIサーバが停止しました: {e}");
                }
            }
            Err(e) => {
                eprintln!("ローカルAPIサーバの起動に失敗しました({addr}): {e}");
            }
        }
    });

    Ok(())
}
