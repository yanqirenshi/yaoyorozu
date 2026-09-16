use crate::NodePosition;

/// `HubLayout` の現在のスキーマバージョン。まだv1のみでマイグレーションは
/// 無いが、`Settings` と同じ流儀(将来のマイグレーションに備える)で最初から
/// 持たせておく(issue #121)。
pub const CURRENT_HUB_LAYOUT_VERSION: u32 = 1;

/// ハブのグラフのノード位置の永続化(issue #121)。`settings.json` とは別
/// ファイル(`hub-layout.json`)に保存する。ノードIDはドラッグのたびに
/// 上書きされる高頻度・低重要度データであり、設定本体のスキーマ・
/// マイグレーション履歴を汚さないため分離した。キーはノードの安定ID
/// (`app::save_hub_layout` の呼び出し元がグラフ構築時の識別子と対応させる)。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct HubLayout {
    pub version: u32,
    pub positions: std::collections::HashMap<String, NodePosition>,
}

impl Default for HubLayout {
    fn default() -> Self {
        Self {
            version: CURRENT_HUB_LAYOUT_VERSION,
            positions: std::collections::HashMap::new(),
        }
    }
}
