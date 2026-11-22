//! ビューア(閲覧と編集)系の command。段階 2 の C で `get_session` などを足していく。

use crate::dto::ProjectDto;
use crate::error::ApiError;
use crate::rpc::blocking;
use crate::state::resolve_effective_projects_dir;
use crate::AppContext;
use axum::extract::State;
use axum::Json;

/// 写し元: `tauri/src/lib.rs` の `list_projects`。
pub async fn list_projects(
    State(ctx): State<AppContext>,
) -> Result<Json<Vec<ProjectDto>>, ApiError> {
    let settings = ctx.state.lock().await.settings.clone();
    let root = resolve_effective_projects_dir(&settings)?;
    let projects = blocking(move || {
        let source = infra::FileSystemRepository::new(root);
        let projects = app::list_projects(&source)?;
        Ok(projects.into_iter().map(ProjectDto::from).collect())
    })
    .await?;
    Ok(Json(projects))
}
