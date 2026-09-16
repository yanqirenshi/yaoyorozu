/// 会話を生成しているエージェントの種類。現時点では Claude Code のみ。
/// 将来 Gemini / Codex 等を追加する際、一覧・会話に「どのエージェントか」を
/// 表示できるよう先んじて用意する(値は当面 `ClaudeCode` のみ)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    ClaudeCode,
}
