/// ビューアのセッションタブ1件(issue #353)。「どのセッションのタブか」を特定する
/// キーだけを持つ(タイトル等の表示情報は保存しない。開くたびに一覧から引く)。
///
/// キーは `(project, session_id)`。1つのタブ = 1セッション(セッションID = 会話
/// ファイル。issue #369)。フォークや圧縮で別のIDのファイルに分かれた会話は、
/// 別のセッションなので別のタブになる(issue #353 で入れた「フォーク系列の鍵」は
/// #369 で廃止した)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ViewerTab {
    /// プロジェクトフォルダ名(`~/.claude/projects/` 直下)。
    pub project: String,
    /// セッションID(会話ファイル名の拡張子を除いたもの)。
    pub session_id: String,
}
