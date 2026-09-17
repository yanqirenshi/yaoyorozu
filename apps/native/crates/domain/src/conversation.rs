use crate::{AgentKind, Message};

/// ビューアに表示する会話内容(メッセージ列)の入れ物(`.jsonl` 1ファイル分)。
/// `id` は送信時の一致検証に使う。
///
/// オブジェクトモデル実装 第4弾(issue #197)で、クラス図の新しい `Session`
/// (session_id/custom_title/ai_title/mode/slug/last_prompt)と名前が衝突する
/// ため `Conversation` に改名した(プロトタイプ側。挙動は変えていない)。
/// 第5〜6弾(SessionFile/LogLine)の実装後、ビューアがそちらのモデルへ
/// 移行すればこの型と `Message` は退役する見込み。
#[derive(Debug, Clone)]
pub struct Conversation {
    pub id: String,
    pub messages: Vec<Message>,
    pub agent: AgentKind,
}
