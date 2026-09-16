/// リポジトリ直下(または作業ディレクトリ直下)の `CLAUDE.md` の内容。
/// `modified_at_ms` はアプリ外での変更を検知する楽観ロックに使う
/// (issue #27)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeMdFile {
    pub content: String,
    pub modified_at_ms: u64,
}
