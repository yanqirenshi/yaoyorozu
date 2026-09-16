/// `.claude/rules/` 配下のルールファイル1件分のサマリ(一覧表示用。issue #61)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleSummary {
    pub file_name: String,
    pub modified_at_ms: u64,
}
