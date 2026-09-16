use crate::GithubProject;

/// 1件の「プロファイル」。対象リポジトリ・GitHubプロジェクト・対象フォルダの
/// 組を名前付きで複数保存できるようにする(issue #72)。`id` は名前変更に
/// 耐える安定IDで、生成は呼び出し側(`app`)の責務(`Date.now` 系に依存しない
/// 方法を使うこと。domain を純粋に保つため、ここでは生成しない)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub repository_path: Option<std::path::PathBuf>,
    pub github_project: Option<GithubProject>,
    #[serde(default)]
    pub selected_project_folders: Vec<String>,
}

impl Profile {
    /// 内容が空のプロファイルを作る(`create_profile` ユースケース用)。
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            repository_path: None,
            github_project: None,
            selected_project_folders: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_new_has_empty_fields() {
        let profile = Profile::new("id1".to_string(), "name1".to_string());
        assert_eq!(profile.id, "id1");
        assert_eq!(profile.name, "name1");
        assert_eq!(profile.repository_path, None);
        assert_eq!(profile.github_project, None);
        assert!(profile.selected_project_folders.is_empty());
    }
}
