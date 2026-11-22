//! `POST /rpc/<command 名>`。本文 = 今の command の引数(キーは camelCase)、応答 = 今の DTO。
//! 写し元: `apps/native/tauri/src/lib.rs` の `list_projects`・`get_settings`。

use crate::dto::{GithubProjectDto, ProfileSummaryDto, ProjectDto, SettingsDto};
use crate::error::ApiError;
use crate::AppContext;
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::path::PathBuf;

/// 本文を引数へ読む。空の本文は `{}` と見なす(引数の無い command のため)。
fn parse_args<T: DeserializeOwned>(body: &Bytes) -> Result<T, ApiError> {
    let slice: &[u8] = if body.iter().all(u8::is_ascii_whitespace) {
        b"{}"
    } else {
        body
    };
    serde_json::from_slice(slice)
        .map_err(|e| ApiError::new("invalid_input", format!("引数を読めません: {e}")))
}

/// ブロッキング処理を専用スレッドで実行する(`tauri::async_runtime::spawn_blocking` 相当)。
async fn blocking<T, F>(f: F) -> Result<T, ApiError>
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

fn effective_projects_dir(settings: &domain::Settings) -> Result<PathBuf, app::AppError> {
    let default = infra::FileSystemRepository::default_projects_dir()?;
    Ok(domain::effective_projects_dir(
        settings.claude_projects_dir.as_deref(),
        &default,
    ))
}

pub async fn list_projects(
    State(ctx): State<AppContext>,
) -> Result<Json<Vec<ProjectDto>>, ApiError> {
    let settings = ctx.state.lock().await.settings.clone();
    let root = effective_projects_dir(&settings)?;
    let projects = blocking(move || {
        let source = infra::FileSystemRepository::new(root);
        let projects = app::list_projects(&source)?;
        Ok(projects.into_iter().map(ProjectDto::from).collect())
    })
    .await?;
    Ok(Json(projects))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GetSettingsArgs {
    profile_id: Option<String>,
}

pub async fn get_settings(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<SettingsDto>, ApiError> {
    let args: GetSettingsArgs = parse_args(&body)?;
    let settings = ctx.state.lock().await.settings.clone();
    let effective = effective_projects_dir(&settings)?;
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

/// 未知の command。
pub async fn unknown_command() -> ApiError {
    ApiError::new("not_found", "その command はありません")
}
