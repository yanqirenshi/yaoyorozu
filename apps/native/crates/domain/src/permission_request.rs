use crate::{PermissionRequestKind, PermissionSuggestion};
use std::path::PathBuf;

/// CLI から届くツール使用の問い合わせ(クラス図 `PermissionRequest`。issue #391。
/// `control_request` の `subtype: can_use_tool`。PoC #382 レポート §2.1)。
/// ツールを使ってよいかを app に尋ねる。`AskUserQuestion`(選択肢)と `ExitPlanMode`
/// (計画の承認)も同じ形で届くので、[`Self::request_kind`] で画面を出し分ける。
///
/// 個体指定子は `request_id` と、尋ねてきた実行中セッション(所有する
/// [`crate::RunningSessionByApp`])。
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRequest {
    pub request_id: String,
    pub tool_name: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    /// AI 応答行の `tool_use` ブロックを指す(ブロックは TM の第2弾でモノにするため、
    /// 今は文字列のまま持つ)。
    pub tool_use_id: String,
    /// ツールに渡される引数。ツールごとに形が違うので JSON のまま持つ。
    pub tool_input: serde_json::Value,
    /// Bash のときに付く、ブロックされたパス。
    pub blocked_path: Option<PathBuf>,
    /// 問い合わせが届いた日時(epoch ms)。
    pub requested_at: u64,
    /// 提案(「今後も許可」に使える更新。0..*)。
    pub suggestions: Vec<PermissionSuggestion>,
}

impl PermissionRequest {
    /// 問い合わせの種別(`tool_name` から求める導出値)。
    pub fn request_kind(&self) -> PermissionRequestKind {
        PermissionRequestKind::from_tool_name(&self.tool_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(tool_name: &str) -> PermissionRequest {
        PermissionRequest {
            request_id: "r1".to_string(),
            tool_name: tool_name.to_string(),
            display_name: None,
            description: None,
            tool_use_id: "toolu_1".to_string(),
            tool_input: serde_json::json!({}),
            blocked_path: None,
            requested_at: 1,
            suggestions: Vec::new(),
        }
    }

    #[test]
    fn request_kind_is_derived_from_the_tool_name() {
        assert_eq!(
            request("Write").request_kind(),
            PermissionRequestKind::ToolUse
        );
        assert_eq!(
            request("AskUserQuestion").request_kind(),
            PermissionRequestKind::AskUserQuestion
        );
        assert_eq!(
            request("ExitPlanMode").request_kind(),
            PermissionRequestKind::ExitPlanMode
        );
    }
}
