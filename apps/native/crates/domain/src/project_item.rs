/// GitHub Projects(v2) アイテムの種別(ビューアの「GitHub Project」タブ表示に
/// 使う。issue #34)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectItemKind {
    Issue,
    PullRequest,
    DraftIssue,
}

/// GitHub Projects(v2)の1アイテム。`repository`/`number`/`url` は
/// `DraftIssue`(プロジェクト内下書き。実体のIssue/PRを持たない)には
/// 存在しないため `None` になる。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectItem {
    /// `ProjectV2Item` のノードID。Status変更mutationの `itemId` に使う
    /// (issue #50)。
    pub id: String,
    pub title: String,
    pub kind: ProjectItemKind,
    pub repository: Option<String>,
    pub number: Option<u32>,
    pub assignees: Vec<String>,
    /// Status フィールドの値(表示名)。未設定のアイテムは `None`。
    pub status: Option<String>,
    /// ブラウザで開くURL(`DraftIssue` には無い)。
    pub url: Option<String>,
}
