use crate::Profile;
use std::path::{Path, PathBuf};

/// クラス図(`classes-domain.ts`)の `GitRepository`(オブジェクトモデル実装
/// 第2弾。issue #189)。プロダクト開発の対象として登録したリポジトリ
/// (クローン1つ)。`User` にコンポジションで所有される(`User.repositories`)。
/// フィールド名・構成は `classes-domain.ts` に厳密に合わせる(モデルが正、
/// 実装が従)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRepository {
    /// 個体指定子。リポジトリのパス(Userの中で一意)。
    pub repository_path: PathBuf,
    pub repository_name: String,
    /// 当面は空文字(編集機能は将来)。
    pub description: String,
}

/// パス末尾のフォルダ名を取り出す。ハブの `cwdTail`(フロント側)と同じ発想
/// のdomain側の実装(issue #189)。末尾が取れない(ルート等)場合はパス全体の
/// 文字列表現にフォールバックする。
fn repository_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}

/// 登録済みプロファイルから `GitRepository` の一覧を組み立てる(issue #189)。
/// `GitRepository` の真実の源は settings のプロファイルであり、専用の
/// port(I/O)は持たない純粋ロジック。
///
/// - `repository_path` が未設定のプロファイルは除外する。
/// - 同じパスを持つプロファイルが複数あっても `GitRepository` は1つ
///   (個体指定子はパス。重複排除、初出のプロファイルの並び順を保つ)。
/// - パスの比較は `PathBuf` の完全一致で行う。大文字小文字・区切り文字の
///   表記ゆれの正規化はしない(当面のスコープ外)。
pub fn repositories_from_profiles(profiles: &[Profile]) -> Vec<GitRepository> {
    let mut repositories: Vec<GitRepository> = Vec::new();
    for profile in profiles {
        let Some(path) = &profile.repository_path else {
            continue;
        };
        if repositories.iter().any(|r| &r.repository_path == path) {
            continue;
        }
        repositories.push(GitRepository {
            repository_path: path.clone(),
            repository_name: repository_name_from_path(path),
            description: String::new(),
        });
    }
    repositories
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_with_repository_path(id: &str, path: Option<&str>) -> Profile {
        let mut profile = Profile::new(id.to_string(), id.to_string());
        profile.repository_path = path.map(PathBuf::from);
        profile
    }

    #[test]
    fn repositories_from_profiles_excludes_profiles_without_repository_path() {
        let profiles = vec![profile_with_repository_path("p1", None)];
        assert!(repositories_from_profiles(&profiles).is_empty());
    }

    #[test]
    fn repositories_from_profiles_derives_name_from_path_tail() {
        let profiles = vec![profile_with_repository_path(
            "p1",
            Some(r"C:\Users\yanqi\prj\yaoyorozu"),
        )];

        let repositories = repositories_from_profiles(&profiles);

        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].repository_name, "yaoyorozu");
        assert_eq!(
            repositories[0].repository_path,
            PathBuf::from(r"C:\Users\yanqi\prj\yaoyorozu")
        );
        assert_eq!(repositories[0].description, "");
    }

    #[test]
    fn repositories_from_profiles_deduplicates_same_path_keeping_first_occurrence_order() {
        let profiles = vec![
            profile_with_repository_path("p1", Some(r"C:\repo\a")),
            profile_with_repository_path("p2", Some(r"C:\repo\b")),
            profile_with_repository_path("p3", Some(r"C:\repo\a")),
        ];

        let repositories = repositories_from_profiles(&profiles);

        let paths: Vec<&Path> = repositories
            .iter()
            .map(|r| r.repository_path.as_path())
            .collect();
        assert_eq!(
            paths,
            vec![Path::new(r"C:\repo\a"), Path::new(r"C:\repo\b")]
        );
    }

    #[test]
    fn repositories_from_profiles_mixes_set_and_unset_profiles_correctly() {
        let profiles = vec![
            profile_with_repository_path("p1", None),
            profile_with_repository_path("p2", Some(r"C:\repo\a")),
            profile_with_repository_path("p3", None),
        ];

        let repositories = repositories_from_profiles(&profiles);

        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].repository_path, PathBuf::from(r"C:\repo\a"));
    }
}
