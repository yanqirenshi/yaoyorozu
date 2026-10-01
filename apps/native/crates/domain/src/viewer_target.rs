/// ビューアで開く・前面化したウィンドウを移動させる先のセッション1件(issue #422)。
/// 「どのセッションを指すか」を特定するキーだけを持つ(フォルダ名 + セッションID。
/// パスは含まない。native.md §4)。
///
/// もとは「ビューアのセッションタブ」(`ViewerTab`。issue #353)の1件だったが、タブの並びの
/// 保存・復元機能そのものを廃止した(issue #489。ビューアが全セッション一覧 + 検索の方式に
/// 変わったため。issue #487)。開く・前面化・そのセッションへ移動する機能(`open_profile_window` /
/// `focus_window` / `viewer:navigate`)は引き続き使うため、その指定の型として残し、
/// 「タブ」ではなくなった実態に合わせて改名した。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ViewerTarget {
    /// プロジェクトフォルダ名(`~/.claude/projects/` 直下)。
    pub project: String,
    /// セッションID(会話ファイル名の拡張子を除いたもの)。
    pub session_id: String,
}
