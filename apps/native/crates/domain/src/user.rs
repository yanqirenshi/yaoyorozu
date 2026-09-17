use crate::{GitRepository, Session};

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
    /// コンポジション(クラス図の `sessions`。0..*。オブジェクトモデル実装
    /// 第4弾。issue #197)。真実の源はセッションログ(`.jsonl`)であり、
    /// `ExecutionEnvironmentSource`はこれを知らないため常に空で組み立てる。
    /// `GitLedger`(第3弾)と同様、gitコマンドほどではないがjsonl走査コストが
    /// あるため、クエリのたびには再構築せず起動時・ハブ再読み込み時に
    /// `AppState`へ組み立てて保持する。
    pub sessions: Vec<Session>,
}
