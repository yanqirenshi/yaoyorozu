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
    /// コンポジション(クラス図の`conversation_files`。**0..***。オブジェクトモデル
    /// 実装 第5弾。issue #208。issue #217で1件固定から1..*へ、Phase 2(issue #407・#404)で
    /// 0..*へ変更)。会話本体のファイル群。同じ`session_id`のセッションが途中でworktreeへ
    /// 移動すると、元のプロジェクトフォルダとworktree側の両方にjsonlができる(issue #214)
    /// ため、複数件になりうる。並びは更新時刻の古い順(`User::load_sessions`参照)。
    ///
    /// **空を許す**のは、app が新規作成した会話(`--session-id` で ID を先に決める)が、最初の行が
    /// 書かれてファイルができるまで「IDは決まったがファイルはまだ無い」窓があるため
    /// ([`Self::without_files`]。その間は `RunningSessionByApp` が `Starting` / `Idle` で表す)。
    /// ファイルの走査から組み立てる `User::load_sessions` は、ファイルのある会話だけを作るので
    /// 空にならない(一覧・ハブはファイルのある会話だけを並べ、ファイルの無い新規の会話は
    /// 実行中セッションの一覧(`RunningSessionSummary`)に出る)。
    pub conversation_files: Vec<SessionFile>,
    /// コンポジション(クラス図の`subagent_files`。0..*。issue #208)。
    pub subagent_files: Vec<SessionFile>,
}

impl Session {
    /// 会話ファイルがまだ無い会話(新規作成で ID だけ決まった状態。issue #407)。
    pub fn without_files(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            custom_title: None,
            ai_title: None,
            mode: None,
            slug: None,
            last_prompt: None,
            conversation_files: Vec::new(),
            subagent_files: Vec::new(),
        }
    }

    /// 会話ファイルができているか(`conversation_files` が空でないか)。空の間は会話の内容を
    /// 読めないので、内容を開く操作(ビューアで開く等)はできない。実行中なら送信はできる。
    pub fn has_conversation_file(&self) -> bool {
        !self.conversation_files.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn a_session_can_exist_before_its_conversation_file() {
        let session = Session::without_files("3a392392-0000-4000-8000-000000000001");

        assert_eq!(session.session_id, "3a392392-0000-4000-8000-000000000001");
        assert!(session.conversation_files.is_empty());
        assert!(session.subagent_files.is_empty());
        assert!(!session.has_conversation_file());
    }

    #[test]
    fn a_session_with_a_conversation_file_reports_it() {
        let mut session = Session::without_files("s1");
        session.conversation_files.push(SessionFile {
            file_path: PathBuf::from("/p/s1.jsonl"),
            lines: Vec::new(),
        });

        assert!(session.has_conversation_file());
    }
}
