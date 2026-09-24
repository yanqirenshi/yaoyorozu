/// ビューアのセッションタブ1件(issue #353)。「どのセッションのタブか」を特定する
/// キーだけを持つ(タイトル等の表示情報は保存しない。開くたびに一覧から引く)。
///
/// キーは `(project, series_key)`。`series_key` はフォーク系列(issue #345。
/// `SessionSummary::root_uuid`)の鍵で、`root_uuid` が取れないセッションは自分自身の
/// `session_id`(単独の系列。`collapse_session_series` と同じ規則)。
/// 一覧が系列ごとの最新ファイルを返す(#345)ため、フォークすると最新ファイルの
/// `session_id` が変わる。`session_id` をキーにするとフォーク後に保存したタブが
/// 古いファイルを指したまま外れてしまうので、フォークしても変わらない系列の鍵を
/// 保存する。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ViewerTab {
    /// プロジェクトフォルダ名(`~/.claude/projects/` 直下)。
    pub project: String,
    /// フォーク系列の鍵(`root_uuid`、無ければ `session_id`)。
    pub series_key: String,
}
