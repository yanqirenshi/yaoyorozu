/// `HubTuning` の現在のスキーマバージョン。まだv1のみでマイグレーションは
/// 無いが、`HubLayout` と同じ流儀(将来のマイグレーションに備える)で最初から
/// 持たせておく(issue #249)。
pub const CURRENT_HUB_TUNING_VERSION: u32 = 1;

/// ハブのグラフ(force シミュレーション)の調整値の永続化(issue #246・#249)。
/// `hub-layout.json`(ノード位置)とは別ファイル(`hub-tuning.json`)に保存する。
/// レイアウトとシミュレーション調整値では関心が違うため分離した。
///
/// 既定値は d3.network 0.6.1 の `Simulation.js`(`DEFAULT_OPTIONS`)と、それが
/// 既定のまま使う d3-force の既定値による。
/// - `link_distance`: 30(d3-force の forceLink の既定)
/// - `link_strength`: `None` = d3-force の既定(1 / min(両端の次数)。定数ではない
///   ため数値では表せない)のまま。画面の「既定」表示に対応し、`None` のときは
///   シミュレーションへ値を渡さない(既定の挙動を上書きしない)
/// - `charge_strength`: -30(d3-force の forceManyBody の既定)
/// - `collide_radius`: 111(d3.network の既定)
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct HubTuning {
    pub version: u32,
    pub link_distance: f64,
    pub link_strength: Option<f64>,
    pub charge_strength: f64,
    pub collide_radius: f64,
}

impl Default for HubTuning {
    fn default() -> Self {
        Self {
            version: CURRENT_HUB_TUNING_VERSION,
            link_distance: 30.0,
            link_strength: None,
            charge_strength: -30.0,
            collide_radius: 111.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_d3_network_defaults_and_current_version() {
        let tuning = HubTuning::default();
        assert_eq!(tuning.version, CURRENT_HUB_TUNING_VERSION);
        assert_eq!(tuning.link_distance, 30.0);
        assert_eq!(tuning.link_strength, None);
        assert_eq!(tuning.charge_strength, -30.0);
        assert_eq!(tuning.collide_radius, 111.0);
    }
}
