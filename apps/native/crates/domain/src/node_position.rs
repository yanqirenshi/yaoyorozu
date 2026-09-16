/// ハブのグラフ上でユーザーがドラッグ固定したノード1件分の座標(issue #121)。
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}
