/// クラス図(`classes-domain.ts`)の `Session`(オブジェクトモデル実装
/// 第4弾。issue #197)。1つの会話。TM: セッション(リソース)。`User` に
/// コンポジションで所有される(`User.sessions`)。フィールド名・構成は
/// `classes-domain.ts` に厳密に合わせる(モデルが正、実装が従)。
///
/// プロトタイプの `Conversation`(旧`Session`。ビューアに表示する会話内容
/// そのものの入れ物)とは別物。こちらは会話の属性(タイトル・モード等)だけを
/// 持ち、メッセージ本文は持たない。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    /// 個体指定子。会話開始時に発番されるUUID v4(`.jsonl`のファイル名にも
    /// なるが、ファイルは識別しない)。
    pub session_id: String,
    /// `custom-title`行(最後の行が有効)。
    pub custom_title: Option<String>,
    pub ai_title: Option<String>,
    pub mode: Option<String>,
    /// TM: セッション別名。
    pub slug: Option<String>,
    /// クラス図上は導出属性(`/last_prompt`)。ログ(`last-prompt`行)から
    /// 導出する値であり、アプリが独自に発行する値ではない。
    pub last_prompt: Option<String>,
}
