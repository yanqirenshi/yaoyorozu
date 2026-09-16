use crate::{AgentKind, Message};

/// 1つのセッション(`.jsonl` 1ファイル)。`id` は送信時の一致検証に使う。
#[derive(Debug, Clone)]
pub struct Session {
    pub id: String,
    pub messages: Vec<Message>,
    pub agent: AgentKind,
}
