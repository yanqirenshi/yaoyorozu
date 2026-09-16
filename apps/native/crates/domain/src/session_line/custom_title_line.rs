use serde::Deserialize;

/// 会話タイトル。同一セッション内に複数回出現しうるため、呼び出し側で
/// 最後に見つかったものを採用すること(`resolve_session_title` 等)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CustomTitleLine {
    pub custom_title: Option<String>,
    pub session_id: Option<String>,
}
