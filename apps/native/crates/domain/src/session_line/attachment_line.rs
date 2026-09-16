use super::ChainLineBase;
use serde::Deserialize;

/// 実行環境が会話に注入した付帯情報。`attachment.type` で23種に分かれるが
/// (issue #39時点で)未使用のため構造は緩くJSON値のまま持つ。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AttachmentLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub attachment: serde_json::Value,
}
