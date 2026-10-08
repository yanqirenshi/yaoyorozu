/// サブエージェントの会話ファイル(`<セッションID>/subagents/agent-*.jsonl`)に
/// 対で置かれる `.meta.json` の中身(issue #567)。`SessionFile.subagent_meta`に
/// 持たせる。会話ファイル(`Session.conversation_files`)には存在しないため
/// 常に`None`。
///
/// `.meta.json`が無い・壊れている場合も会話ファイルの一覧からは落とさず、
/// この型ごと`None`にする(読み込みの責務はinfra。issue本文の指示)。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SubagentMeta {
    /// エージェントの種類(例: `Explore`、`general-purpose`)。
    pub agent_type: Option<String>,
    /// 何を頼まれたか(親が`Agent`ツールに渡した依頼内容)。
    pub description: Option<String>,
    /// 入れ子の深さ(サブエージェントがさらにサブエージェントを起こした場合に増える)。
    pub spawn_depth: Option<u32>,
    /// このサブエージェントを起こした `Agent` ツール呼び出しの ID(issue #570)。
    /// 親セッションの進行中のツール呼び出し(`RunningSessionByApp.running_tool_use_ids`)と
    /// 突き合わせて、いま動いているサブエージェントを見分けるのに使う。古い
    /// `.meta.json`(このフィールドを持たない版で作られたもの)では`None`になり、
    /// その場合は実行中と判定しない(突き合わせようが無いため)。
    pub tool_use_id: Option<String>,
}
