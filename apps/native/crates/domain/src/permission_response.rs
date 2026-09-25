use crate::PermissionBehavior;

/// app が返すツール使用の応答(クラス図 `PermissionResponse`。issue #391。
/// `control_response`。PoC #382 レポート §2.1)。問い合わせとは別の行為(日時が別)なので
/// 別の型にし、問い合わせが 0..1 を持つ関係(個体指定子は `request_id`)。
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionResponse {
    pub request_id: String,
    pub behavior: PermissionBehavior,
    /// 応答日時(epoch ms)。
    pub responded_at: u64,
}

impl PermissionResponse {
    /// 許可。`updated_input` を省略したときは問い合わせの入力をそのまま返す
    /// (`request_input` に問い合わせの `tool_input` を渡す)。
    pub fn allow(
        request_id: &str,
        request_input: &serde_json::Value,
        updated_input: Option<serde_json::Value>,
        updated_permissions: Option<serde_json::Value>,
        responded_at: u64,
    ) -> Self {
        Self {
            request_id: request_id.to_string(),
            behavior: PermissionBehavior::Allow {
                updated_input: updated_input.unwrap_or_else(|| request_input.clone()),
                updated_permissions,
            },
            responded_at,
        }
    }

    /// 拒否。
    pub fn deny(request_id: &str, message: &str, responded_at: u64) -> Self {
        Self {
            request_id: request_id.to_string(),
            behavior: PermissionBehavior::Deny {
                message: message.to_string(),
            },
            responded_at,
        }
    }

    /// 取り消し(CLI が取り下げた問い合わせの決着)。
    pub fn cancelled(request_id: &str, responded_at: u64) -> Self {
        Self {
            request_id: request_id.to_string(),
            behavior: PermissionBehavior::Cancelled,
            responded_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn allow_defaults_the_updated_input_to_the_requested_input() {
        let input = json!({"command":"mkdir x"});

        let response = PermissionResponse::allow("r1", &input, None, None, 5);

        assert_eq!(
            response.behavior,
            PermissionBehavior::Allow {
                updated_input: input,
                updated_permissions: None
            }
        );
        assert_eq!(response.responded_at, 5);
    }

    #[test]
    fn allow_uses_the_rewritten_input_and_permissions_when_given() {
        let response = PermissionResponse::allow(
            "r1",
            &json!({"questions":[]}),
            Some(json!({"questions":[],"answers":{"q":"a"}})),
            Some(json!([{"type":"setMode"}])),
            5,
        );

        assert_eq!(
            response.behavior,
            PermissionBehavior::Allow {
                updated_input: json!({"questions":[],"answers":{"q":"a"}}),
                updated_permissions: Some(json!([{"type":"setMode"}])),
            }
        );
    }

    #[test]
    fn deny_and_cancelled_carry_only_what_they_need() {
        assert_eq!(
            PermissionResponse::deny("r1", "no", 1).behavior,
            PermissionBehavior::Deny {
                message: "no".to_string()
            }
        );
        assert_eq!(
            PermissionResponse::cancelled("r1", 1).behavior,
            PermissionBehavior::Cancelled
        );
    }
}
