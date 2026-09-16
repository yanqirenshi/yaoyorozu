/// GitHub Projects(v2)の一覧表示用サマリ(設定画面のプロジェクト選択に使う)。
/// 永続化される `GithubProject`(owner + number)とは異なり、選択肢一覧の
/// 表示にのみ使う値。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubProjectSummary {
    pub number: u32,
    pub title: String,
    pub closed: bool,
}
