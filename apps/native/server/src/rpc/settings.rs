//! 設定・プロファイル系の command。写し元: `tauri/src/lib.rs` の `get_settings`・`update_settings`・
//! `switch_profile`・`create_profile`・`delete_profile`・`rename_profile`。
//!
//! 状態変更の処理順は native.md §3.1: ① ロック取得 → ② 状態更新 → ③ 永続化に要る値を clone して
//! ロック解放 → ④ 永続化 → ⑤ イベント(`settings:updated`)→ ⑥ 最小限の戻り値。

use crate::dto::{
    FolderCheckDto, GithubProjectDto, PendingWarningDto, ProfileSummaryDto, SettingsDto,
    SettingsInputDto,
};
use crate::error::ApiError;
use crate::rpc::{blocking, parse_args};
use crate::state::{describe_effective_projects_dir, resolve_effective_projects_dir};
use crate::watcher::start_session_watcher;
use crate::AppContext;
use app::SettingsStore as _;
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use std::path::PathBuf;

/// 設定を永続化する(Tauri 版 `persist_settings` の置き換え)。
///
/// 保存は**レーン(`ctx.save_lane`)を 1 つずつ**通る。レーンに入ってから、**その時点の最新の状態**を
/// 写して書く(呼び出しの順が前後しても、最後に書かれるのは最新の状態になる)。ロックの順は
/// 「レーン → 状態」の一方向で、状態のロックはレーンに入ったあとの短い間(clone するだけ)しか持たず、
/// 状態のロックを持ったままレーンを待たない・ファイル I/O をしない(native.md §2・§3.1)。
///
/// `protect_existing`(復旧直後の最初の保存で、上書きする前に今のファイルの複製を残す。issue #538)は
/// レーンの中で取り出し、保存に失敗したら戻す(次の保存で複製を残せるように)。
/// 一時ファイルは infra の `write_atomic` が保存ごとに別の名前で新規作成する。
async fn persist_latest(ctx: &AppContext) -> Result<(), ApiError> {
    let _lane = ctx.save_lane.lock().await;
    let (settings, save_path, protect_existing) = {
        let mut guard = ctx.state.lock().await;
        (
            guard.settings.clone(),
            guard.save_path.clone(),
            std::mem::take(&mut guard.settings_recovery_pending),
        )
    };
    let result = blocking(move || {
        let store = infra::FileSettingsStore::new(save_path);
        store.save(&settings, protect_existing)
    })
    .await;
    if result.is_err() && protect_existing {
        ctx.state.lock().await.settings_recovery_pending = true;
    }
    result
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
    let settings_revision = settings.revision;
    let effective = describe_effective_projects_dir(&settings)?;
    let profile = app::resolve_profile(&settings, args.profile_id.as_deref())?.clone();
    let profile_revision = profile.revision;
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
        effective_projects_dir: effective,
        restore_running_sessions: settings.restore_running_sessions,
        revision: profile_revision,
        global_revision: settings_revision,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsArgs {
    input: SettingsInputDto,
    /// 保存先のプロファイル。必須(省略・null は 400。「アクティブへ保存する」動きは、この構成には無い)。
    profile_id: Option<String>,
    /// どの版の設定を元にした変更か(`get_settings` の `revision` = 保存先のプロファイルの版)。必須。今の版と違えば 409。
    expected_revision: Option<u64>,
    /// 全体の欄の版(`get_settings` の `global_revision`)。必須。今の版と違えば 409(全体の欄は、どのプロファイルの
    /// 保存でも書かれるので、別のタブが変えた全体の欄を、古い値で黙って戻さないために比べる)。
    expected_global_revision: Option<u64>,
}

/// `update_settings` の応答。保存後の版(次の保存に使える)。
#[derive(serde::Serialize)]
pub struct UpdateSettingsResultDto {
    /// 保存後の、そのプロファイルの版。
    pub revision: u64,
    /// 保存後の、全体の欄の版。
    pub global_revision: u64,
}

pub async fn update_settings(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<UpdateSettingsResultDto>, ApiError> {
    let args: UpdateSettingsArgs = parse_args(&body)?;
    let Some(expected_revision) = args.expected_revision else {
        return Err(ApiError::new(
            "invalid_input",
            "expectedRevision(どの版を元にした変更か)を指定してください",
        ));
    };
    let Some(expected_global_revision) = args.expected_global_revision else {
        return Err(ApiError::new(
            "invalid_input",
            "expectedGlobalRevision(全体の欄がどの版を元にした変更か)を指定してください",
        ));
    };
    let Some(target_id) = args.profile_id else {
        return Err(ApiError::new(
            "invalid_input",
            "profileId(どのプロファイルへの保存か)を指定してください",
        ));
    };
    let input = args.input;
    // 保存するパスは、状態に触る前に検証する(不正なら何も変えずに 400)。
    let repository_path = optional_folder(input.repository_path)?;
    let github_project = input.github_project.map(domain::GithubProject::from);
    let claude_projects_dir = optional_folder(input.claude_projects_dir)?;

    // ロックの中は候補値の組み立てとバリデーションだけ(I/O はしない)。失敗したときは
    // 状態を書き換えないまま抜ける(無効な値をメモリ上に残さない)。
    let (to_persist, projects_dir_changed, saved_revision) = {
        let mut guard = ctx.state.lock().await;
        let mut candidate = guard.settings.clone();
        let global_before = guard.settings.revision;
        let Some(profile) = candidate.profiles.iter_mut().find(|p| p.id == target_id) else {
            return Err(ApiError::new(
                "not_found",
                "指定されたプロファイルが見つかりません",
            ));
        };
        // 古い版を元にした保存は断る(別のタブが変えた別の欄を、古い値で黙って戻さないため)。比べるのは、保存先の
        // プロファイルの版と、全体の欄の版。別のプロファイルの保存・切替・作成・削除・改名では、どちらも進まない。
        if profile.revision != expected_revision || global_before != expected_global_revision {
            return Err(ApiError::new(
                "settings_conflict",
                "設定がほかで変更されています。取り直してからやり直してください",
            ));
        }
        let profile_changed = profile.repository_path != repository_path
            || profile.github_project != github_project
            || profile.selected_project_folders != input.selected_project_folders;
        profile.repository_path = repository_path;
        profile.github_project = github_project;
        profile.selected_project_folders = input.selected_project_folders;
        // 版は、その欄が実際に変わるときだけ進める(あふれない足し算。人が手で書けるファイルの値)。
        if profile_changed {
            profile.revision = profile.revision.saturating_add(1);
        }
        let saved_revision = profile.revision;
        candidate.claude_projects_dir = claude_projects_dir;
        // 省略(null)は「変えない」(issue #459)。
        if let Some(restore) = input.restore_running_sessions {
            candidate.restore_running_sessions = restore;
        }
        app::validate_settings(&candidate)?;
        let global_changed = guard.settings.claude_projects_dir != candidate.claude_projects_dir
            || guard.settings.restore_running_sessions != candidate.restore_running_sessions;
        if global_changed {
            candidate.revision = global_before.saturating_add(1);
        }

        let projects_dir_changed =
            guard.settings.claude_projects_dir != candidate.claude_projects_dir;
        guard.settings = candidate.clone();
        (candidate, projects_dir_changed, saved_revision)
    };

    persist_latest(&ctx).await?;

    if projects_dir_changed {
        match resolve_effective_projects_dir(&to_persist) {
            Ok(root) => start_session_watcher(&ctx, root),
            Err(e) => eprintln!("セッション監視の張り替えに失敗しました: {e}"),
        }
    }
    ctx.events.emit("settings:updated", &());
    Ok(Json(UpdateSettingsResultDto {
        revision: saved_revision,
        global_revision: to_persist.revision,
    }))
}

/// 設定を変える共通の流れ(ロック → 更新 → 解放 → 永続化 → イベント)。`change` は新しい設定と、
/// 戻り値に使う値を返す。
async fn change_settings<T>(
    ctx: &AppContext,
    change: impl FnOnce(&domain::Settings) -> Result<(domain::Settings, T), app::AppError>,
) -> Result<T, ApiError> {
    let extra = {
        let mut guard = ctx.state.lock().await;
        let (mut updated, extra) = change(&guard.settings)?;
        // この流れの操作(切替・作成・削除・名前の変更)は、`update_settings` が確かめる欄(どのプロファイルの
        // リポジトリ・GitHub・フォルダも)を変えない。保存先は `profileId` で必ず指すので、アクティブが変わっても
        // 版は進めない(別タブの切替で、開いたままの設定画面の保存が 409 にならない)。
        updated.revision = guard.settings.revision;
        guard.settings = updated;
        extra
    };
    persist_latest(ctx).await?;
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
    // 版は進めない(`change_settings`)。
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
    // 作ったプロファイルがアクティブになる(版は進めない。`change_settings`)。
    let created = change_settings(&ctx, |s| {
        let (updated, created) = app::create_profile_checked(s, args.name)?;
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
    // 名前だけの変更。版は進めない。
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
    let dismissed = {
        let mut guard = ctx.state.lock().await;
        guard.dismiss_warning(args.id);
        guard.dismissed_skips.clone()
    };
    // サーバを起動し直しても出し直さないよう、閉じた印を保存する(ロックの外・ファイル I/O)。
    let data_dir = ctx.data_dir.as_ref().clone();
    blocking(move || {
        crate::dismissed::save(&data_dir, &dismissed);
        Ok(())
    })
    .await?;
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
    let path = crate::folders::guard_folder_path(&args.path)?;
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

/// 保存するパス(任意)を検証する。`None`・空白だけは「未設定」として許す(今の仕様)。それ以外は
/// 画面の「パスの確認」(`check_folder`)と同じ規則(`app::validate_folder_path`)に、ドライブの種類(ネットワークのドライブを断る。`folders.rs`)を加えて断る。
fn optional_folder(raw: Option<String>) -> Result<Option<PathBuf>, ApiError> {
    match raw.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(text) => Ok(Some(crate::folders::guard_folder_path(text)?)),
    }
}
