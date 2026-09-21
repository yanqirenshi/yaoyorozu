use crate::{Camera, NodePosition};

/// `HubLayout` の現在のスキーマバージョン。`Settings` と同じ流儀で、
/// マイグレーションが必要になったら上げ、infra 側で旧バージョンからの変換を
/// 行う(issue #121)。
/// v1 -> v2: 視点(`camera`)を追加(issue #268)。v1 は視点を持たないので
/// `None` とし、`positions` は変えない。
pub const CURRENT_HUB_LAYOUT_VERSION: u32 = 2;

/// ハブのグラフの見た目の状態の永続化(issue #121・#268)。`settings.json` とは
/// 別ファイル(`hub-layout.json`)に保存する。ノードIDはドラッグのたびに
/// 上書きされる高頻度・低重要度データであり、設定本体のスキーマ・
/// マイグレーション履歴を汚さないため分離した。キーはノードの安定ID
/// (`app::save_hub_layout` の呼び出し元がグラフ構築時の識別子と対応させる)。
/// `camera` は視点(パン・ズーム)で、ノード位置と同じ「ハブの見た目の状態」。
/// force シミュレーションの調整値(`HubTuning`)とは関心が違うため別ファイル。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct HubLayout {
    pub version: u32,
    pub positions: std::collections::HashMap<String, NodePosition>,
    /// 保存された視点。`None` はまだ動かしていない(初期表示のまま)。
    /// `#[serde(default)]` は v1 のJSON(このフィールドを持たない)を読めるように
    /// するため。
    #[serde(default)]
    pub camera: Option<Camera>,
}

impl Default for HubLayout {
    fn default() -> Self {
        Self {
            version: CURRENT_HUB_LAYOUT_VERSION,
            positions: std::collections::HashMap::new(),
            camera: None,
        }
    }
}
