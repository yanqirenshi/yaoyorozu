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
    /// このプロファイルの設定の版(ローカルサーバが使う。`repository_path`・`github_project`・
    /// `selected_project_folders` が実際に変わるときだけ 1 つ増える)。`update_settings` は、保存先のプロファイルの
    /// この版と比べる(別のプロファイルの保存・切替・作成・削除・改名では進まない)。
    ///
    /// スキーマの `version` は上げない: `#[serde(default)]` により、この項目の無い既存の `settings.json` は版 0 として読める。
    #[serde(default)]
    pub revision: u64,
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
            revision: 0,
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

    #[test]
    fn a_profile_saved_before_the_per_profile_revision_is_read_as_revision_zero() {
        let old = r#"{"id":"p","name":"n","repository_path":null,"github_project":null,"selected_project_folders":["a"]}"#;
        let profile: Profile = serde_json::from_str(old).unwrap();
        assert_eq!(profile.revision, 0);
        assert_eq!(profile.selected_project_folders, vec!["a".to_string()]);
    }
}
