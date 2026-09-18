use std::path::PathBuf;

/// `User::load_sessions`(クラス図のメソッド`User.load_sessions`。
/// issue #208)への入力。ファイルI/O・jsonlのパース自体はこの型を組み立てる
/// port(app/infra側)の責務で、この型自体はただのデータ(I/Oを持たない。
/// `git_ledger`の`ObservedGitState`と同じ設計)。
///
/// `Session`の属性(session_id/custom_title/ai_title/mode/slug/last_prompt。
/// issue #197)に加えて、`Session.conversation_file`/`subagent_files`
/// (issue #208)を組み立てるためのファイルパスを持つ。`LogLine`は遅延読み込み
/// のためここには含めない(セッションを開いたときに別途構築する)。
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
}
