//! 設定・プロファイル系の command。写し元: `tauri/src/lib.rs` の `get_settings`・`update_settings`・
//! `switch_profile`・`create_profile`・`delete_profile`・`rename_profile`。
//!
//! 状態変更の処理順は native.md §3.1: ① ロック取得 → ② 状態更新 → ③ 永続化に要る値を clone して
//! ロック解放 → ④ 永続化 → ⑤ イベント(`settings:updated`)→ ⑥ 最小限の戻り値。

use crate::data_files::remove_stale_tmp;
use crate::dto::{
    FolderCheckDto, GithubProjectDto, PendingWarningDto, ProfileSummaryDto, SettingsDto,
    SettingsInputDto,
};
use crate::error::ApiError;
use crate::rpc::{blocking, parse_args};
use crate::state::resolve_effective_projects_dir;
use crate::watcher::start_session_watcher;
use crate::AppContext;
use app::SettingsStore as _;
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use std::path::{Component, Path, PathBuf};

/// 設定をバックグラウンドで永続化する(Tauri 版 `persist_settings`)。
/// `protect_existing` が真なら、復旧直後の最初の保存として、上書きする前に今のファイルの複製を残す
/// (issue #538)。保存の直前に、固定名の古い一時ファイル(`settings.json.tmp`)のエントリを消す
/// (ハードリンクなどで残っていても、リンク先を書き換えないため。infra の保存は `File::create` を使う)。
async fn persist_settings(
    settings: domain::Settings,
    save_path: PathBuf,
    protect_existing: bool,
) -> Result<(), ApiError> {
    blocking(move || {
        remove_stale_tmp(&save_path);
        let store = infra::FileSettingsStore::new(save_path);
        store.save(&settings, protect_existing)
    })
    .await
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIdArgs {
    profile_id: Option<String>,
}

pub async fn get_settings(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<SettingsDto>, ApiError> {
    let args: ProfileIdArgs = parse_args(&body)?;
    let settings = ctx.state.lock().await.settings.clone();
    let effective = resolve_effective_projects_dir(&settings)?;
    let profile = app::resolve_profile(&settings, args.profile_id.as_deref())?.clone();
    Ok(Json(SettingsDto {
        active_profile_id: settings.active_profile_id,
        profiles: settings
            .profiles
            .into_iter()
            .map(|p| ProfileSummaryDto {
                id: p.id,
                name: p.name,
            })
            .collect(),
        repository_path: profile.repository_path.map(|p| p.display().to_string()),
        github_project: profile.github_project.map(GithubProjectDto::from),
        selected_project_folders: profile.selected_project_folders,
        claude_projects_dir: settings
            .claude_projects_dir
            .map(|p| p.display().to_string()),
        effective_projects_dir: effective.display().to_string(),
        restore_running_sessions: settings.restore_running_sessions,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsArgs {
    input: SettingsInputDto,
    profile_id: Option<String>,
}

pub async fn update_settings(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: UpdateSettingsArgs = parse_args(&body)?;
    let input = args.input;
    let repository_path = input.repository_path.map(PathBuf::from);
    let github_project = input.github_project.map(domain::GithubProject::from);
    let claude_projects_dir = input.claude_projects_dir.map(PathBuf::from);

    // ロックの中は候補値の組み立てとバリデーションだけ(I/O はしない)。失敗したときは
    // 状態を書き換えないまま抜ける(無効な値をメモリ上に残さない)。
    let (to_persist, save_path, projects_dir_changed, protect_existing) = {
        let mut guard = ctx.state.lock().await;
        let mut candidate = guard.settings.clone();
        let target_id = args
            .profile_id
            .unwrap_or_else(|| candidate.active_profile_id.clone());
        let Some(profile) = candidate.profiles.iter_mut().find(|p| p.id == target_id) else {
            return Err(ApiError::new(
                "not_found",
                "指定されたプロファイルが見つかりません",
            ));
        };
        profile.repository_path = repository_path;
        profile.github_project = github_project;
        profile.selected_project_folders = input.selected_project_folders;
        candidate.claude_projects_dir = claude_projects_dir;
        // 省略(null)は「変えない」(issue #459)。
        if let Some(restore) = input.restore_running_sessions {
            candidate.restore_running_sessions = restore;
        }
        app::validate_settings(&candidate)?;

        let projects_dir_changed =
            guard.settings.claude_projects_dir != candidate.claude_projects_dir;
        guard.settings = candidate.clone();
        (
            candidate,
            guard.save_path.clone(),
            projects_dir_changed,
            std::mem::take(&mut guard.settings_recovery_pending),
        )
    };

    persist_settings(to_persist.clone(), save_path, protect_existing).await?;

    if projects_dir_changed {
        match resolve_effective_projects_dir(&to_persist) {
            Ok(root) => start_session_watcher(&ctx, root),
            Err(e) => eprintln!("セッション監視の張り替えに失敗しました: {e}"),
        }
    }
    ctx.events.emit("settings:updated", &());
    Ok(Json(()))
}

/// 設定を変える共通の流れ(ロック → 更新 → 解放 → 永続化 → イベント)。`change` は新しい設定と、
/// 戻り値に使う値を返す。
async fn change_settings<T>(
    ctx: &AppContext,
    change: impl FnOnce(&domain::Settings) -> Result<(domain::Settings, T), app::AppError>,
) -> Result<T, ApiError> {
    let (to_persist, save_path, protect_existing, extra) = {
        let mut guard = ctx.state.lock().await;
        let (updated, extra) = change(&guard.settings)?;
        guard.settings = updated.clone();
        (
            updated,
            guard.save_path.clone(),
            std::mem::take(&mut guard.settings_recovery_pending),
            extra,
        )
    };
    persist_settings(to_persist, save_path, protect_existing).await?;
    ctx.events.emit("settings:updated", &());
    Ok(extra)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIdRequired {
    profile_id: String,
}

pub async fn switch_profile(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: ProfileIdRequired = parse_args(&body)?;
    change_settings(&ctx, |s| {
        Ok((app::switch_profile(s, &args.profile_id)?, ()))
    })
    .await?;
    Ok(Json(()))
}

#[derive(Deserialize, Default)]
pub struct CreateProfileArgs {
    name: Option<String>,
}

pub async fn create_profile(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<ProfileSummaryDto>, ApiError> {
    let args: CreateProfileArgs = parse_args(&body)?;
    let created = change_settings(&ctx, |s| {
        let (updated, created) = app::create_profile(s, args.name);
        Ok((updated, created))
    })
    .await?;
    Ok(Json(ProfileSummaryDto {
        id: created.id,
        name: created.name,
    }))
}

pub async fn delete_profile(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: ProfileIdRequired = parse_args(&body)?;
    change_settings(&ctx, |s| {
        Ok((app::delete_profile(s, &args.profile_id)?, ()))
    })
    .await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProfileArgs {
    profile_id: String,
    name: String,
}

pub async fn rename_profile(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: RenameProfileArgs = parse_args(&body)?;
    change_settings(&ctx, |s| {
        Ok((app::rename_profile(s, &args.profile_id, &args.name)?, ()))
    })
    .await?;
    Ok(Json(()))
}

/// 起動直後に出て、画面が取りこぼした警告の控え(この構成だけの Query)。
pub async fn list_pending_warnings(
    State(ctx): State<AppContext>,
) -> Result<Json<Vec<PendingWarningDto>>, ApiError> {
    Ok(Json(ctx.state.lock().await.warnings.clone()))
}

#[derive(Deserialize)]
pub struct DismissArgs {
    id: u64,
}

/// 警告を閉じる(控えから取り除く)。存在しない ID は何もしない。
pub async fn dismiss_pending_warning(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: DismissArgs = parse_args(&body)?;
    ctx.state.lock().await.warnings.retain(|w| w.id != args.id);
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct CheckFolderArgs {
    path: String,
}

/// パスの手入力の確認(Tauri 版のフォルダ選択ダイアログの代わり。この構成だけの Query)。
/// 存在・フォルダか・リポジトリか(直下に `.git`)だけを返す。読み書きはしない。
/// 絶対パスだけを受け付け、`..` や `:`(代替データストリーム)を含む形は拒否する。
pub async fn check_folder(body: Bytes) -> Result<Json<FolderCheckDto>, ApiError> {
    let args: CheckFolderArgs = parse_args(&body)?;
    let path = validate_folder_input(&args.path)?;
    let dto = blocking(move || {
        let meta = std::fs::metadata(&path).ok();
        let is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
        Ok(FolderCheckDto {
            path: path.display().to_string(),
            exists: meta.is_some(),
            is_dir,
            is_git_repository: is_dir && path.join(".git").exists(),
        })
    })
    .await?;
    Ok(Json(dto))
}

fn validate_folder_input(raw: &str) -> Result<PathBuf, ApiError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new("invalid_input", "パスを入力してください"));
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(ApiError::new("invalid_input", "絶対パスで入力してください"));
    }
    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(ApiError::new(
                    "invalid_input",
                    "「..」を含むパスは使えません",
                ))
            }
            Component::Normal(name) if name.to_string_lossy().contains(':') => {
                return Err(ApiError::new(
                    "invalid_input",
                    "「:」を含む名前は使えません",
                ))
            }
            _ => {}
        }
    }
    Ok(path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_input_must_be_absolute_without_dotdot_or_streams() {
        assert!(validate_folder_input("").is_err());
        assert!(validate_folder_input("relative\\dir").is_err());
        assert!(validate_folder_input(r"C:\a\..\b").is_err());
        assert!(validate_folder_input(r"C:\a\b::$DATA").is_err());
        assert!(validate_folder_input(r" C:\a\b ").is_ok());
    }
}
