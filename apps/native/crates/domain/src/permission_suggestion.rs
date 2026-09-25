use serde_json::{Map, Value};

/// `permission_suggestions` の1件(クラス図 `PermissionSuggestion`。issue #391。PoC #382
/// レポート §2.1)。SDK の `PermissionUpdate` 型そのもので、許可応答の「更新後の権限」に
/// 入れ返すと「今後も許可」になる。
///
/// 種別(`setMode` / `addRules` / `addDirectories` など)ごとに残りの項目の形が違うため、
/// 種別と適用先以外は `suggestion_content` に JSON のまま持つ。
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionSuggestion {
    /// 提案種別(`type`)。
    pub suggestion_type: String,
    /// 適用先(`destination`。`session` / `localSettings` など)。
    pub suggestion_destination: String,
    /// 内容。`type` と `destination` を除いた残りの項目(JSON オブジェクト)。
    pub suggestion_content: Value,
}

impl PermissionSuggestion {
    /// SDK の `PermissionUpdate` の JSON オブジェクトから作る。`type` か `destination` が
    /// 文字列でなければ `None`(読み飛ばす)。
    pub fn from_update_value(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let suggestion_type = object.get("type")?.as_str()?.to_string();
        let suggestion_destination = object.get("destination")?.as_str()?.to_string();
        let content: Map<String, Value> = object
            .iter()
            .filter(|(key, _)| key.as_str() != "type" && key.as_str() != "destination")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        Some(Self {
            suggestion_type,
            suggestion_destination,
            suggestion_content: Value::Object(content),
        })
    }

    /// SDK の `PermissionUpdate` の JSON オブジェクトへ戻す([`Self::from_update_value`] の逆)。
    /// 許可応答の「更新後の権限」に入れて返すときに使う。
    pub fn to_update_value(&self) -> Value {
        let mut object = Map::new();
        object.insert(
            "type".to_string(),
            Value::String(self.suggestion_type.clone()),
        );
        object.insert(
            "destination".to_string(),
            Value::String(self.suggestion_destination.clone()),
        );
        if let Value::Object(content) = &self.suggestion_content {
            for (key, value) in content {
                object.insert(key.clone(), value.clone());
            }
        }
        Value::Object(object)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrips_the_three_shapes_seen_in_real_output() {
        // PoC #382 レポート §2.1 の実出力
        for original in [
            json!({"destination":"session","mode":"acceptEdits","type":"setMode"}),
            json!({"type":"addRules","behavior":"allow","destination":"localSettings","rules":[{"toolName":"Bash","ruleContent":"mkdir poc382-dir *"}]}),
            json!({"type":"addDirectories","destination":"session","directories":["C:\\ws"]}),
        ] {
            let suggestion = PermissionSuggestion::from_update_value(&original).expect("parse");
            assert_eq!(suggestion.to_update_value(), original);
        }
    }

    #[test]
    fn splits_type_and_destination_from_the_rest() {
        let suggestion = PermissionSuggestion::from_update_value(
            &json!({"type":"setMode","destination":"session","mode":"acceptEdits"}),
        )
        .unwrap();

        assert_eq!(suggestion.suggestion_type, "setMode");
        assert_eq!(suggestion.suggestion_destination, "session");
        assert_eq!(suggestion.suggestion_content, json!({"mode":"acceptEdits"}));
    }

    #[test]
    fn skips_values_without_a_string_type_or_destination() {
        assert!(
            PermissionSuggestion::from_update_value(&json!({"destination":"session"})).is_none()
        );
        assert!(PermissionSuggestion::from_update_value(&json!({"type":"setMode"})).is_none());
        assert!(
            PermissionSuggestion::from_update_value(&json!({"type":1,"destination":"s"})).is_none()
        );
        assert!(PermissionSuggestion::from_update_value(&json!("x")).is_none());
    }
}
