use crate::GitRepository;

/// クラス図の `User`(issue #182)。PC上のOSユーザーアカウント。`Pc` に
/// コンポジションで所有される(`Pc.users`)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    /// 個体指定子。OSのユーザー名(PCの中で一意)。
    pub user_id: String,
    pub user_name: String,
    pub home_directory: std::path::PathBuf,
    /// コンポジション(クラス図の `repositories`。0..*。issue #189)。
    /// 真実の源は settings のプロファイルであり、`ExecutionEnvironmentSource`
    /// はこれを知らないため常に空で組み立てる。`app::current_pc_with_repositories`
    /// が settings から都度組み立てて差し込む。
    pub repositories: Vec<GitRepository>,
}
