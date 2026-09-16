#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GithubProject {
    pub owner: String,
    pub number: u32,
}

impl GithubProject {
    /// owner が空文字のものは不正な入力とみなす(実在確認はスコープ外)。
    pub fn is_valid(&self) -> bool {
        !self.owner.trim().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_project_is_valid_rejects_blank_owner() {
        let project = GithubProject {
            owner: "   ".to_string(),
            number: 1,
        };
        assert!(!project.is_valid());
    }

    #[test]
    fn github_project_is_valid_accepts_non_blank_owner() {
        let project = GithubProject {
            owner: "yanqirenshi".to_string(),
            number: 51,
        };
        assert!(project.is_valid());
    }
}
