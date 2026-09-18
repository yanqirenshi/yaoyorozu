use crate::SessionFile;

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
    /// コンポジション(クラス図の`conversation_files`。1..*。オブジェクトモデル
    /// 実装 第5弾。issue #208。issue #217で1件固定から1..*へ変更)。会話本体の
    /// ファイル群。同じ`session_id`のセッションが途中でworktreeへ移動すると、
    /// 元のプロジェクトフォルダとworktree側の両方にjsonlができる(issue #214)
    /// ため、複数件になりうる。並びは更新時刻の古い順(`User::load_sessions`
    /// 参照)。
    pub conversation_files: Vec<SessionFile>,
    /// コンポジション(クラス図の`subagent_files`。0..*。issue #208)。
    pub subagent_files: Vec<SessionFile>,
}
