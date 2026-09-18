use std::path::PathBuf;

/// `User::load_sessions`(クラス図のメソッド`User.load_sessions`。
/// issue #208)への入力。ファイルI/O・jsonlのパース自体はこの型を組み立てる
/// port(app/infra側)の責務で、この型自体はただのデータ(I/Oを持たない。
/// `git_ledger`の`ObservedGitState`と同じ設計)。
///
/// `Session`の属性(session_id/custom_title/ai_title/mode/slug/last_prompt。
/// issue #197)に加えて、`Session.conversation_files`/`subagent_files`
/// (issue #208)を組み立てるためのファイルパスを持つ。`LogLine`は遅延読み込み
/// のためここには含めない(セッションを開いたときに別途構築する)。
///
/// `modified_at_ms`はこのファイルの最終更新時刻(issue #217)。同じ
/// `session_id`を持つ複数の`ParsedSession`(セッション途中でworktreeへ
/// 移動すると、同じセッションIDのjsonlが元のプロジェクトフォルダと
/// worktree側の両方にできる。issue #214)を1つの`Session`に集約する際、
/// この時刻の古い順に読み進めて属性を解決する(`User::load_sessions`参照)
/// ための値。
///
/// `cwd`/`git_branch`(issue #224)はハブのグラフ表示用の**表示補助データ**。
/// TMの決定により、これらはSessionの属性ではなくLogLineの属性であるため、
/// `domain::Session`には持たせない(`User::load_sessions`では読み捨てる)。
/// `ParsedSession`はただの運搬型なのでここに載せてよい。走査キャッシュ
/// (`infra::session_source`)が既に抽出済みの値をそのまま使うため、新たな
/// ファイル読み直しは発生しない。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSession {
    pub session_id: String,
    pub custom_title: Option<String>,
    pub ai_title: Option<String>,
    pub mode: Option<String>,
    pub slug: Option<String>,
    pub last_prompt: Option<String>,
    pub conversation_file_path: PathBuf,
    pub subagent_file_paths: Vec<PathBuf>,
    pub modified_at_ms: u64,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
}
