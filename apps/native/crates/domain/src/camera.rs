/// ハブのグラフの視点(パン・ズーム。issue #268)。d3-zoom の transform に
/// 対応する(`screen = world * k + (x, y)`)。`x`/`y` は平行移動、`k` は拡大率。
/// `HubLayout.camera` として `hub-layout.json` に保存する。
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub k: f64,
}
