use super::{ChainLineBase, UserMessage};
use serde::Deserialize;

/// ユーザー入力(`content` が文字列)またはツール実行結果
/// (`content` が配列)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UserLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub message: UserMessage,
    pub prompt_id: Option<String>,
    pub permission_mode: Option<String>,
    pub tool_use_result: Option<serde_json::Value>,
    #[serde(rename = "sourceToolAssistantUUID")]
    pub source_tool_assistant_uuid: Option<String>,
}
