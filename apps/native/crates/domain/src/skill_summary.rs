/// `.claude/skills/<name>/SKILL.md` 1件分のサマリ(一覧表示用。issue #65)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillSummary {
    pub name: String,
    pub modified_at_ms: u64,
}
