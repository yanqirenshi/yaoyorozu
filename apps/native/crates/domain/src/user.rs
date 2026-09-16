/// クラス図の `User`(issue #182)。PC上のOSユーザーアカウント。`Pc` に
/// コンポジションで所有される(`Pc.users`)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    /// 個体指定子。OSのユーザー名(PCの中で一意)。
    pub user_id: String,
    pub user_name: String,
    pub home_directory: std::path::PathBuf,
}
