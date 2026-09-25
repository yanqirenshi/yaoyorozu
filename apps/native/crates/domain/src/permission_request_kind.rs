/// 権限の問い合わせの種別(クラス図 `PermissionRequestKind`。issue #391)。
/// `tool_name` から求まる導出値([`crate::PermissionRequest::request_kind`])で、
/// 画面の出し分けに使う(PoC #382 レポート §2.4)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionRequestKind {
    /// 通常のツール使用の許可。
    ToolUse,
    /// 選択肢の質問(`AskUserQuestion`)。許可・拒否ではなく、ユーザーの選択を更新後の
    /// 入力に入れて返す。
    AskUserQuestion,
    /// 計画の承認(`ExitPlanMode`)。
    ExitPlanMode,
}

impl PermissionRequestKind {
    /// `tool_name` から種別を求める。
    pub fn from_tool_name(tool_name: &str) -> Self {
        match tool_name {
            "AskUserQuestion" => Self::AskUserQuestion,
            "ExitPlanMode" => Self::ExitPlanMode,
            _ => Self::ToolUse,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_tool_name_distinguishes_the_two_special_tools_and_treats_the_rest_as_tool_use() {
        assert_eq!(
            PermissionRequestKind::from_tool_name("AskUserQuestion"),
            PermissionRequestKind::AskUserQuestion
        );
        assert_eq!(
            PermissionRequestKind::from_tool_name("ExitPlanMode"),
            PermissionRequestKind::ExitPlanMode
        );
        for name in ["Write", "Bash", "mcp__x__y", "askuserquestion", ""] {
            assert_eq!(
                PermissionRequestKind::from_tool_name(name),
                PermissionRequestKind::ToolUse,
                "{name}"
            );
        }
    }
}
