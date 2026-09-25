/// 権限の問い合わせの決着種別(クラス図 `PermissionBehavior`。issue #391)。
///
/// クラス図では Allow / Deny / Cancelled の3値だが、決着種別ごとに持つ値が違う
/// (Allow は更新後の入力、Deny は拒否メッセージ、Cancelled はどれも持たない)ので、
/// クラス図の注記どおり値を持つバリアントにした。平らなフィールド(更新後の入力・拒否
/// メッセージ・更新後の権限)にすると起こる「Deny なのに更新後の入力がある」ような矛盾を、
/// 型で作れなくするため。
#[derive(Debug, Clone, PartialEq)]
pub enum PermissionBehavior {
    /// 許可。`updated_input` はツールへ渡す入力(そのまま、または書き換えた引数)。
    /// `updated_permissions` は「今後も許可」にする更新(SDK の `PermissionUpdate` の列。
    /// [`crate::PermissionSuggestion::to_update_value`] の JSON の配列)。
    Allow {
        updated_input: serde_json::Value,
        updated_permissions: Option<serde_json::Value>,
    },
    /// 拒否。`message` がそのままモデルへの tool_result になる。
    Deny { message: String },
    /// 取り消し(中断による `control_cancel_request`)。app は応答せずに終わる。
    Cancelled,
}
