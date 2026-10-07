/// ハブのグラフ上でのノードの動き方(issue #558)。`@yanqirenshi/d3.network` の
/// ノード属性 `move`(ライブラリの `Nodes.js` の `makeDataMove`)に対応する3値。
/// フロントはこの値をそのまま `move` 属性として渡すため、シリアライズする
/// 文字列はライブラリの表記(小文字)に揃える。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeMove {
    /// 力学シミュレーションで自動的に動く。
    Will,
    /// 自動では動かず、ドラッグで動かせる。
    Support,
    /// 動かない(ドラッグもできない)。
    Freeze,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_the_lowercase_strings_the_library_expects() {
        assert_eq!(serde_json::to_string(&NodeMove::Will).unwrap(), "\"will\"");
        assert_eq!(
            serde_json::to_string(&NodeMove::Support).unwrap(),
            "\"support\""
        );
        assert_eq!(
            serde_json::to_string(&NodeMove::Freeze).unwrap(),
            "\"freeze\""
        );
    }

    #[test]
    fn rejects_any_other_value() {
        assert!(serde_json::from_str::<NodeMove>("\"Will\"").is_err());
        assert!(serde_json::from_str::<NodeMove>("\"auto\"").is_err());
    }
}
