//! `~/.claude` 系の command(/claude 画面)。写し元: `tauri/src/lib.rs` の `get_user_claude_md`・
//! `save_user_claude_md`・`get_claude_settings_file`・`save_claude_settings_file`・`list_claude_dir`。
//!
//! 対象のパスはサーバ側で `~/.claude` に固定解決し、クライアントからパスやファイル名は受け取らない
//! (native.md §4)。対象は CLAUDE.md と settings.json だけで、`.claude` 配下の他のファイル(特に
//! `.credentials.json`)への経路は作らない。Explorer は `~/.claude` からの相対パスだけを受け取り、
//! パス形式の検証は `app::list_claude_dir`、リンク経由での逸脱の検出は `FileClaudeDirStore` が行う。

use crate::dto::{ClaudeDirPageDto, ClaudeMdDto, ClaudeSettingsDto};
use crate::error::ApiError;
use crate::rpc::{blocking, parse_args};
use crate::AppContext;
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;

pub async fn get_user_claude_md() -> Result<Json<ClaudeMdDto>, ApiError> {
    let dto = blocking(|| {
        let claude_dir = infra::claude_home_dir()?;
        let store = infra::FileClaudeMdStore::new();
        Ok(ClaudeMdDto::from(app::read_claude_md(&store, &claude_dir)?))
    })
    .await?;
    Ok(Json(dto))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveArgs {
    content: String,
    expected_modified_at_ms: Option<u64>,
}

pub async fn save_user_claude_md(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SaveArgs = parse_args(&body)?;
    // 「更新時刻を確かめる → 書く」を、ほかの保存に割り込まれずにひとまとまりで行う。
    let _lane = ctx.file_lane.lock().await;
    blocking(move || {
        let claude_dir = infra::claude_home_dir()?;
        let store = infra::FileClaudeMdStore::new();
        app::save_claude_md(
            &store,
            &claude_dir,
            &args.content,
            args.expected_modified_at_ms,
        )
    })
    .await?;
    Ok(Json(()))
}

pub async fn get_claude_settings_file() -> Result<Json<ClaudeSettingsDto>, ApiError> {
    let dto = blocking(|| {
        let store = infra::FileClaudeSettingsStore::new();
        Ok(ClaudeSettingsDto::from(app::read_claude_settings(&store)?))
    })
    .await?;
    Ok(Json(dto))
}

pub async fn save_claude_settings_file(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SaveArgs = parse_args(&body)?;
    let _lane = ctx.file_lane.lock().await;
    blocking(move || {
        let store = infra::FileClaudeSettingsStore::new();
        app::save_claude_settings(&store, &args.content, args.expected_modified_at_ms)
    })
    .await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct ListClaudeDirArgs {
    path: String,
    offset: usize,
    limit: usize,
}

pub async fn list_claude_dir(body: Bytes) -> Result<Json<ClaudeDirPageDto>, ApiError> {
    let args: ListClaudeDirArgs = parse_args(&body)?;
    let dto = blocking(move || {
        let store = infra::FileClaudeDirStore::new(infra::claude_home_dir()?);
        let page = app::list_claude_dir(&store, &args.path, args.offset, args.limit)?;
        Ok(ClaudeDirPageDto::from(page))
    })
    .await?;
    Ok(Json(dto))
}
