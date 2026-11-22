//! ハブの command。写し元: `tauri/src/lib.rs` の `get_pc`・`reconcile_git_state`・`get_hub_layout`・`save_hub_layout`・
//! `get_hub_tuning`・`save_hub_tuning`。
//!
//! Tauri 版との違い(#639 の決定):
//! - `reconcile_git_state` は、**始めたらすぐ応える**(終わりは `pc:data_loaded`)。走っている最中の 2 回目は、新しく始めずに応える。
//! - レイアウトとチューニングの保存に**版(`revision`)**を付ける。`get_*` が返し、`save_*` は `expectedRevision` を必須で受け、
//!   合わなければ 409(`hub_conflict`)。保存は専用のレーンと `write_atomic` を通り、保存したら `hub-layout:updated`・
//!   `hub-tuning:updated`(新しいイベント)を出す。
//!
//! 版は、**ファイルの中身の指紋**(FNV-1a 64 の下位 52 ビット。JavaScript の数として正確に扱える)。ファイルが無いときは、
//! 空の中身の指紋。サーバを起動し直しても、別の書き手が書いても、中身が変われば版も変わるので、古い版での保存は必ず断られる。

use crate::dto::{CameraDto, HubLayoutDto, HubTuningDto, NodeMoveDto, NodePositionDto, PcDto};
use crate::error::ApiError;
use crate::rpc::{blocking, parse_args};
use crate::AppContext;
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use infra::{FileArchivedSessionsStore, FileHubLayoutStore, FileHubTuningStore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const HUB_LAYOUT_UPDATED_EVENT: &str = "hub-layout:updated";
pub const HUB_TUNING_UPDATED_EVENT: &str = "hub-tuning:updated";

/// ファイルの中身の指紋(版)。無いファイルは空の中身と同じ。
pub fn file_revision(path: &Path) -> u64 {
    let bytes = std::fs::read(path).unwrap_or_default();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash & ((1u64 << 52) - 1)
}

fn conflict(what: &str) -> ApiError {
    ApiError::new(
        "hub_conflict",
        format!("{what}がほかで変更されています。取り直してからやり直してください"),
    )
}

/// 現在の PC・ユーザーと、常駐しているセッションのツリー(`ServerState.pc`)。組み立ても走査もしない。
pub async fn get_pc(State(ctx): State<AppContext>) -> Result<Json<PcDto>, ApiError> {
    let mut dto = {
        let guard = ctx.state.lock().await;
        let pc = app::current_pc_with_repositories(guard.pc.clone(), &guard.settings);
        let pc = app::pc_with_git_ledger(pc, &guard.git_ledger);
        let pc = app::pc_with_loaded_lines(pc, &guard.loaded_log_lines);
        let mut dto = PcDto::from(pc);
        dto.data_loaded = guard.pc_data_loaded;
        apply_session_display_hints(&mut dto, &guard.user_sessions);
        dto
    };
    // アーカイブの印は、状態の外の独立ファイル。ロックの外・ブロッキングスレッドで読む。
    let path = ctx.data_dir.join("archived-sessions.json");
    let archived =
        blocking(move || app::load_archived_sessions(&FileArchivedSessionsStore::new(path)))
            .await?;
    for user in &mut dto.users {
        for session in &mut user.sessions {
            session.archived = archived.is_archived(&session.session_id);
        }
    }
    Ok(Json(dto))
}

/// 表示補助データ(`cwd`・`git_branch`)を差し込む。解決規則は `app::resolve_session_display_hints`(純粋関数)。
fn apply_session_display_hints(dto: &mut PcDto, parsed: &[domain::ParsedSession]) {
    let hints = app::resolve_session_display_hints(parsed);
    for user in &mut dto.users {
        for session in &mut user.sessions {
            if let Some(hint) = hints.get(&session.session_id) {
                session.cwd = hint.cwd.clone();
                session.git_branch = hint.git_branch.clone();
            }
        }
    }
}

/// 登録済み全リポジトリの Git の状態を観測して台帳を更新し、全件を走査し直す。**始めたらすぐ応える**。
/// 走っている最中なら、新しく始めずに応える。終わりは `pc:data_loaded` で知らせる。
pub async fn reconcile_git_state(State(ctx): State<AppContext>) -> Result<Json<()>, ApiError> {
    crate::scan::begin_reload(&ctx).await;
    Ok(Json(()))
}

#[derive(Serialize)]
pub struct HubLayoutResponse {
    #[serde(flatten)]
    layout: HubLayoutDto,
    revision: u64,
}

pub async fn get_hub_layout(
    State(ctx): State<AppContext>,
) -> Result<Json<HubLayoutResponse>, ApiError> {
    let path = ctx.data_dir.join("hub-layout.json");
    let response = blocking(move || {
        let layout = app::load_hub_layout(&FileHubLayoutStore::new(path.clone()))?;
        Ok(HubLayoutResponse {
            layout: layout.into(),
            // 読み込みが壊れたファイルを退避した(または版を上げて書き戻した)あとの、いまのファイルの版。
            revision: file_revision(&path),
        })
    })
    .await?;
    Ok(Json(response))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLayoutArgs {
    positions: HashMap<String, NodePositionDto>,
    camera: Option<CameraDto>,
    moves: HashMap<String, NodeMoveDto>,
    /// 必須。読み込んだときの版(合わなければ 409)。
    expected_revision: u64,
}

#[derive(Serialize)]
pub struct SavedRevision {
    revision: u64,
}

/// ハブグラフのノード位置・動き方の上書きを、丸ごと置き換えて保存する(Tauri 版と同じ形。版で守る)。
pub async fn save_hub_layout(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<SavedRevision>, ApiError> {
    let args: SaveLayoutArgs = parse_args(&body)?;
    let path = ctx.data_dir.join("hub-layout.json");
    let _lane = ctx.running.hub_lane.lock().await;
    let saved = blocking(move || {
        if file_revision(&path) != args.expected_revision {
            return Ok(None);
        }
        let store = FileHubLayoutStore::new(path.clone());
        app::save_hub_layout(
            &store,
            args.positions
                .into_iter()
                .map(|(key, position)| (key, position.into()))
                .collect(),
            args.camera.map(Into::into),
            args.moves
                .into_iter()
                .map(|(key, value)| (key, value.into()))
                .collect(),
        )?;
        Ok(Some(file_revision(&path)))
    })
    .await?;
    let Some(revision) = saved else {
        return Err(conflict("ハブのレイアウト"));
    };
    ctx.events.emit(
        HUB_LAYOUT_UPDATED_EVENT,
        &serde_json::json!({ "revision": revision }),
    );
    Ok(Json(SavedRevision { revision }))
}

#[derive(Serialize)]
pub struct HubTuningResponse {
    #[serde(flatten)]
    tuning: HubTuningDto,
    revision: u64,
}

pub async fn get_hub_tuning(
    State(ctx): State<AppContext>,
) -> Result<Json<HubTuningResponse>, ApiError> {
    let path = ctx.data_dir.join("hub-tuning.json");
    let response = blocking(move || {
        let tuning = app::load_hub_tuning(&FileHubTuningStore::new(path.clone()))?;
        Ok(HubTuningResponse {
            tuning: tuning.into(),
            revision: file_revision(&path),
        })
    })
    .await?;
    Ok(Json(response))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTuningArgs {
    tuning: HubTuningDto,
    /// 必須。読み込んだときの版(合わなければ 409)。
    expected_revision: u64,
}

pub async fn save_hub_tuning(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<SavedRevision>, ApiError> {
    let args: SaveTuningArgs = parse_args(&body)?;
    let path = ctx.data_dir.join("hub-tuning.json");
    let _lane = ctx.running.hub_lane.lock().await;
    let saved = blocking(move || {
        if file_revision(&path) != args.expected_revision {
            return Ok(None);
        }
        app::save_hub_tuning(&FileHubTuningStore::new(path.clone()), args.tuning.into())?;
        Ok(Some(file_revision(&path)))
    })
    .await?;
    let Some(revision) = saved else {
        return Err(conflict("ハブのチューニング"));
    };
    ctx.events.emit(
        HUB_TUNING_UPDATED_EVENT,
        &serde_json::json!({ "revision": revision }),
    );
    Ok(Json(SavedRevision { revision }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_revision_follows_the_file_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.json");
        let missing = file_revision(&path);
        std::fs::write(&path, "").unwrap();
        assert_eq!(file_revision(&path), missing, "無いファイルは空と同じ");
        std::fs::write(&path, "a").unwrap();
        let a = file_revision(&path);
        std::fs::write(&path, "b").unwrap();
        let b = file_revision(&path);
        assert_ne!(a, b);
        assert_ne!(a, missing);
        assert!(a < (1u64 << 52) && b < (1u64 << 52));
        std::fs::write(&path, "a").unwrap();
        assert_eq!(file_revision(&path), a, "同じ中身は同じ版");
    }
}
