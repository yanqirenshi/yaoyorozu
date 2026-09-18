use crate::LogLine;
use std::path::PathBuf;

/// クラス図(`classes-domain.ts`)の `SessionFile`(オブジェクトモデル実装
/// 第5弾。issue #208)。セッションログの`.jsonl`ファイル1件。会話ファイル
/// (`<フォルダ名>/<セッションID>.jsonl`)とサブエージェントのファイル
/// (`<フォルダ名>/<セッションID>/subagents/agent-<エージェントID>.jsonl`)
/// がある。`Session`にコンポジションで所有される
/// (`Session.conversation_file`/`Session.subagent_files`)。
///
/// `lines`の遅延読み込み状態は、専用のOption/フラグを追加せず**空Vec**で
/// 表す(実装時判断)。クラス図の多重度が`1..*`(SessionFileは必ず1行以上の
/// LogLineを持つ)であるため、「読み込み済みで実際に0行」というケースは
/// 存在しえず、空Vecは常に「まだ読み込んでいない」ことを意味する
/// (モデルに無い補助フィールドを増やさずに済む)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFile {
    /// 個体指定子。ファイルパス。
    pub file_path: PathBuf,
    pub lines: Vec<LogLine>,
}
