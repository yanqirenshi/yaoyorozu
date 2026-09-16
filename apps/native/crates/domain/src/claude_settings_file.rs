/// `~/.claude/settings.json` の内容。`modified_at_ms` はアプリ外での変更を
/// 検知する楽観ロックに使う(issue #53)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeSettingsFile {
    pub content: String,
    pub modified_at_ms: u64,
}
