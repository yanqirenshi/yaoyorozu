use super::UserContentBlock;
use serde::Deserialize;

/// `user.message.content` は文字列(人間の入力)または配列
/// (ツール実行結果・画像添付等)のどちらか。
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    Blocks(Vec<UserContentBlock>),
}
