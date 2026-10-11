//! Claude.ai の利用状況(5時間枠・7日枠・モデル別。issue #613)。
//!
//! app が外部(claude.ai)から取得して持っているだけの値で、`RunningSessionByApp` のような
//! 会話の状態遷移とは違い、守るべき不変条件が無い(壊れた取得結果をそのまま捨てればよい)。
//! そのため domain には置かず、ここ(app)に値として置く(判断は issue #613 のコメント参照)。
//! 金額の情報(`extra_usage`/`spend`/`limit_dollars`/`session.total_cost_usd` 等)は読まない
//! (native.md §4)。wire 形式(CLI の `get_usage` 応答)の読み取りは infra の責務。

/// 上限に対する危険度(CLI の応答の `limits[].severity`)。知らない値(版で増える)は
/// `Unknown` にする(domain/app は CLI の文字列をそのまま持たない)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageSeverity {
    Normal,
    Warning,
    Critical,
    Unknown,
}

/// 1つの枠(5時間 / 7日 / モデル別)の使用率。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageLimit {
    /// 0〜100(CLI の `utilization`)。
    pub utilization_percent: u8,
    /// リセット時刻(epoch ms)。読めなければ `None`(画面はリセット時刻を出さないだけで、
    /// 使用率自体は出す)。
    pub resets_at_ms: Option<u64>,
    pub severity: UsageSeverity,
}

/// モデル別の使用率(名前つき。いまは Fable のみ応答に含まれる)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelUsage {
    pub display_name: String,
    pub limit: UsageLimit,
}

/// `get_usage` の応答から読む値。3項目(5時間枠・7日枠・モデル別)のうち、応答に
/// 無かった・形が違ったものは `None`/空(版で項目が増減しても落とさない)。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClaudeUsage {
    pub five_hour: Option<UsageLimit>,
    pub seven_day: Option<UsageLimit>,
    pub model_scoped: Vec<ModelUsage>,
}

/// app が最後に取得した使用状況と、取得した時刻(epoch ms)。CLI が1つも動いていない間は
/// 更新されないため、画面は最後の値を薄く出し取得時刻を添える(issue #613)。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClaudeUsageSnapshot {
    pub usage: Option<ClaudeUsage>,
    pub fetched_at_ms: Option<u64>,
}
