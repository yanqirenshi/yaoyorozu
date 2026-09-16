/// ウィンドウ内の1タブの表示状態(ハブ化 その1。issue #83)。ハブ画面
/// (別issue)が PC → Window → profile → session のグラフを描くための
/// 最小限の情報。永続化はしない(`AppState` のランタイム状態。ウィンドウを
/// 閉じれば消える)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowTab {
    pub profile_id: String,
    pub session_id: Option<String>,
    /// 表示用のセッションタイトル。非アクティブなタブ(画面がマウントされて
    /// おらずタイトルを解決できない)では `None` になりうる。
    pub session_title: Option<String>,
}
