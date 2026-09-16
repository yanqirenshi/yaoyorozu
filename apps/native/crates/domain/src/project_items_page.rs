use crate::{ProjectItem, ProjectStatusOption};

/// `list_project_items` の1ページ分。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectItemsPage {
    /// `ProjectV2` のノードID。Status変更mutationの `projectId` に使う。
    pub project_id: String,
    /// Statusフィールドのノード ID。Status変更mutationの `fieldId` に使う。
    /// プロジェクトにStatusフィールドが無い場合は `None`(かんばんの
    /// カラム操作はできない)。
    pub status_field_id: Option<String>,
    pub items: Vec<ProjectItem>,
    pub next_cursor: Option<String>,
    /// Status フィールドの選択肢(id + 表示名)。かんばんのカラム順に使う。
    pub status_options: Vec<ProjectStatusOption>,
}
