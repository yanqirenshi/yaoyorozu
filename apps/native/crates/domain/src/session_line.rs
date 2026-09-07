//! Claude Code のセッションログ(`.jsonl`)1行分の型付きデシリアライズ。
//!
//! 型定義は実データの実測調査(`reports/claude-session-jsonl-format.md` §5)
//! に基づく。**公式スキーマではない**ため、以下を徹底する(issue #39):
//!
//! - `deny_unknown_fields` は付けない(未知フィールドは無視する)
//! - 欠損しうるフィールドは `Option` + `#[serde(default)]` にする
//! - 未知の `type`(将来のバージョンで増える可能性がある)は
//!   `#[serde(other)]` で `Unknown` バリアントへ落とし、読み飛ばす
//!
//! ここで得られる値はビューアの会話表示に必要な範囲(`user`/`assistant` の
//! 本文、`cwd`、`sessionId`、`customTitle`)の抽出にのみ使う。他の型
//! (`system`/`pr-link` 等)は将来の機能拡張に備えて構造だけ用意してある
//! (issue #39 の時点では未使用)。

use crate::{Message, Role};
use serde::Deserialize;

// ============ message.content のブロック(レポート§6) ============

#[derive(Debug, Clone, Deserialize)]
pub struct TextBlock {
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ThinkingBlock {
    pub thinking: String,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolUseBlock {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolResultBlock {
    #[serde(default, rename = "tool_use_id")]
    pub tool_use_id: String,
    #[serde(default)]
    pub content: serde_json::Value,
    #[serde(default, rename = "is_error")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImageBlock {
    #[serde(default)]
    pub source: serde_json::Value,
}

/// `assistant.message.content` の要素。表示対象は `Text` のみ
/// (`Thinking`/`ToolUse` は非表示。issue #39 の制約: 現行方針を維持)。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum AssistantContentBlock {
    #[serde(rename = "text")]
    Text(TextBlock),
    #[serde(rename = "thinking")]
    Thinking(ThinkingBlock),
    #[serde(rename = "tool_use")]
    ToolUse(ToolUseBlock),
    #[serde(other)]
    Unknown,
}

/// `user.message.content` が配列の場合の要素。表示対象は `Text` のみ
/// (`ToolResult`/`Image` は非表示。現行方針を維持)。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum UserContentBlock {
    #[serde(rename = "tool_result")]
    ToolResult(ToolResultBlock),
    #[serde(rename = "text")]
    Text(TextBlock),
    #[serde(rename = "image")]
    Image(ImageBlock),
    #[serde(other)]
    Unknown,
}

/// `user.message.content` は文字列(人間の入力)または配列
/// (ツール実行結果・画像添付等)のどちらか。
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    Blocks(Vec<UserContentBlock>),
}

// ============ 会話チェーンの共通フィールド ============

/// 会話チェーンを構成する行(`user`/`assistant`/`system`/`attachment`)の
/// 共通フィールド。実データでは常に揃っているが、将来のバージョンでの
/// 増減に備えてすべて `Option` + `#[serde(default)]` にする。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChainLineBase {
    pub uuid: Option<String>,
    pub parent_uuid: Option<String>,
    pub is_sidechain: Option<bool>,
    pub session_id: Option<String>,
    pub timestamp: Option<String>,
    pub cwd: Option<String>,
    pub entrypoint: Option<String>,
    pub version: Option<String>,
    pub git_branch: Option<String>,
    pub user_type: Option<String>,
    pub slug: Option<String>,
    pub agent_id: Option<String>,
}

// ============ 会話本体 ============

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct UserMessage {
    pub role: Option<String>,
    pub content: Option<UserContent>,
}

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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub service_tier: Option<String>,
    pub cache_creation: Option<CacheCreation>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CacheCreation {
    pub ephemeral_1h_input_tokens: u64,
    pub ephemeral_5m_input_tokens: u64,
}

/// `assistant.message`。Anthropic Messages API のレスポンス形式のため、
/// フィールド名はAPI側のsnake_case規約に従う(Claude Code独自の
/// ラッパーフィールド(`ChainLineBase`等)のcamelCaseとは別系統)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AssistantMessage {
    pub id: Option<String>,
    pub role: Option<String>,
    pub model: Option<String>,
    pub content: Vec<AssistantContentBlock>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub usage: Option<Usage>,
}

/// AIの応答。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AssistantLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub request_id: Option<String>,
    pub message: AssistantMessage,
}

// ============ 内部イベント(system) ============

/// `system.level`。将来値が増える可能性があるため `Unknown` を用意する。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SystemLevel {
    Info,
    Warning,
    Error,
    Suggestion,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HookInfo {
    pub command: Option<String>,
    pub duration_ms: Option<u64>,
}

/// ターン終了時に実行されたフックの結果。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StopHookSummaryLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub level: Option<SystemLevel>,
    pub hook_count: Option<u64>,
    pub hook_infos: Vec<HookInfo>,
    pub prevented_continuation: Option<bool>,
    pub stop_reason: Option<String>,
    pub has_output: Option<bool>,
    #[serde(rename = "toolUseID")]
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApiErrorDetail {
    pub message: Option<String>,
    pub formatted: Option<String>,
    pub is_network_down: Option<bool>,
}

/// API 呼び出しの失敗とリトライ。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApiErrorLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub error: ApiErrorDetail,
    pub retry_in_ms: Option<u64>,
    pub retry_attempt: Option<u64>,
    pub max_retries: Option<u64>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompactMetadata {
    pub trigger: Option<String>,
    pub pre_tokens: Option<u64>,
    pub post_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
}

/// `/compact` による履歴圧縮の境界。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompactBoundaryLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub logical_parent_uuid: Option<String>,
    pub content: Option<String>,
    pub is_meta: Option<bool>,
    pub compact_metadata: CompactMetadata,
}

/// 情報通知(スキル引数の警告など)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InformationalLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub content: Option<String>,
    pub is_meta: Option<bool>,
}

/// `system` 行は `subtype` でさらに4種に分かれる。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "subtype")]
pub enum SystemLine {
    #[serde(rename = "stop_hook_summary")]
    StopHookSummary(StopHookSummaryLine),
    #[serde(rename = "api_error")]
    ApiError(ApiErrorLine),
    #[serde(rename = "compact_boundary")]
    CompactBoundary(CompactBoundaryLine),
    #[serde(rename = "informational")]
    Informational(InformationalLine),
    #[serde(other)]
    Unknown,
}

impl SystemLine {
    fn base(&self) -> Option<&ChainLineBase> {
        match self {
            SystemLine::StopHookSummary(l) => Some(&l.base),
            SystemLine::ApiError(l) => Some(&l.base),
            SystemLine::CompactBoundary(l) => Some(&l.base),
            SystemLine::Informational(l) => Some(&l.base),
            SystemLine::Unknown => None,
        }
    }
}

/// 実行環境が会話に注入した付帯情報。`attachment.type` で23種に分かれるが
/// (issue #39時点で)未使用のため構造は緩くJSON値のまま持つ。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AttachmentLine {
    #[serde(flatten)]
    pub base: ChainLineBase,
    pub attachment: serde_json::Value,
}

// ============ セッションメタ(parentUuid を持たない) ============

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QueueOperationLine {
    pub operation: Option<String>,
    pub timestamp: Option<String>,
    pub session_id: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LastPromptLine {
    pub last_prompt: Option<String>,
    pub leaf_uuid: Option<String>,
    pub session_id: Option<String>,
}

/// 会話タイトル。同一セッション内に複数回出現しうるため、呼び出し側で
/// 最後に見つかったものを採用すること(`resolve_session_title` 等)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CustomTitleLine {
    pub custom_title: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiTitleLine {
    pub ai_title: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ModeLine {
    pub mode: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PrLinkLine {
    pub session_id: Option<String>,
    pub pr_number: Option<u64>,
    pub pr_url: Option<String>,
    pub pr_repository: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AtisLatchLine {
    pub atis: Option<String>,
    pub session_id: Option<String>,
}

// ============ 全11種の行の合併型 ============

/// セッションログ(`.jsonl`)1行分。未知の `type`(将来のバージョンで
/// 増える可能性がある)は `Unknown` に落とし、読み飛ばす。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum SessionLine {
    #[serde(rename = "user")]
    User(UserLine),
    #[serde(rename = "assistant")]
    Assistant(AssistantLine),
    #[serde(rename = "system")]
    System(SystemLine),
    #[serde(rename = "attachment")]
    Attachment(AttachmentLine),
    #[serde(rename = "queue-operation")]
    QueueOperation(QueueOperationLine),
    #[serde(rename = "last-prompt")]
    LastPrompt(LastPromptLine),
    #[serde(rename = "custom-title")]
    CustomTitle(CustomTitleLine),
    #[serde(rename = "ai-title")]
    AiTitle(AiTitleLine),
    #[serde(rename = "mode")]
    Mode(ModeLine),
    #[serde(rename = "pr-link")]
    PrLink(PrLinkLine),
    #[serde(rename = "atis-latch")]
    AtisLatch(AtisLatchLine),
    #[serde(other)]
    Unknown,
}

impl SessionLine {
    fn base(&self) -> Option<&ChainLineBase> {
        match self {
            SessionLine::User(l) => Some(&l.base),
            SessionLine::Assistant(l) => Some(&l.base),
            SessionLine::System(l) => l.base(),
            SessionLine::Attachment(l) => Some(&l.base),
            _ => None,
        }
    }

    /// `sessionId`。会話チェーン行・セッションメタ行のどちらにも
    /// 存在する(未知の行 type のみ `None`)。
    pub fn session_id(&self) -> Option<&str> {
        match self {
            SessionLine::User(l) => l.base.session_id.as_deref(),
            SessionLine::Assistant(l) => l.base.session_id.as_deref(),
            SessionLine::System(l) => l.base().and_then(|b| b.session_id.as_deref()),
            SessionLine::Attachment(l) => l.base.session_id.as_deref(),
            SessionLine::QueueOperation(l) => l.session_id.as_deref(),
            SessionLine::LastPrompt(l) => l.session_id.as_deref(),
            SessionLine::CustomTitle(l) => l.session_id.as_deref(),
            SessionLine::AiTitle(l) => l.session_id.as_deref(),
            SessionLine::Mode(l) => l.session_id.as_deref(),
            SessionLine::PrLink(l) => l.session_id.as_deref(),
            SessionLine::AtisLatch(l) => l.session_id.as_deref(),
            SessionLine::Unknown => None,
        }
    }

    /// `cwd`。会話チェーン行のみが持つ(セッションメタ行・未知の行は
    /// `None`)。
    pub fn cwd(&self) -> Option<&str> {
        self.base().and_then(|b| b.cwd.as_deref())
    }

    /// `gitBranch`。会話チェーン行のみが持つ(セッションメタ行・未知の行は
    /// `None`)。値が `"HEAD"` はデタッチ状態を表す(issue #104)。
    pub fn git_branch(&self) -> Option<&str> {
        self.base().and_then(|b| b.git_branch.as_deref())
    }
}

fn user_content_text(content: &Option<UserContent>) -> String {
    match content {
        Some(UserContent::Text(s)) => s.clone(),
        Some(UserContent::Blocks(blocks)) => blocks
            .iter()
            .filter_map(|b| match b {
                UserContentBlock::Text(t) => Some(t.text.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        None => String::new(),
    }
}

fn assistant_content_text(blocks: &[AssistantContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|b| match b {
            AssistantContentBlock::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// 1行分のJSONLエントリから、会話として表示すべきメッセージを取り出す。
/// thinking / tool_use / tool_result などの内部情報は読み飛ばす
/// (表示対象の抽出ルールは従来と同じ。issue #39)。
pub fn extract_message(value: &serde_json::Value) -> Option<Message> {
    let line: SessionLine = serde_json::from_value(value.clone()).ok()?;
    let (role, text, timestamp) = match &line {
        SessionLine::User(l) => (
            Role::User,
            user_content_text(&l.message.content),
            l.base.timestamp.clone().unwrap_or_default(),
        ),
        SessionLine::Assistant(l) => (
            Role::Assistant,
            assistant_content_text(&l.message.content),
            l.base.timestamp.clone().unwrap_or_default(),
        ),
        _ => return None,
    };

    if text.trim().is_empty() {
        return None;
    }

    Some(Message {
        role,
        text,
        timestamp,
    })
}

/// 1行分のJSONLエントリから、そのセッションの作業ディレクトリ(cwd)を取り出す。
pub fn extract_cwd(value: &serde_json::Value) -> Option<String> {
    serde_json::from_value::<SessionLine>(value.clone())
        .ok()?
        .cwd()
        .map(String::from)
}

/// 1行分のJSONLエントリから `gitBranch` を取り出す(issue #104)。セッション中の
/// checkout に追従して複数回出現しうるため、呼び出し側で最後に見つかった
/// ものを採用すること(`custom-title` と同じ流儀)。
pub fn extract_git_branch(value: &serde_json::Value) -> Option<String> {
    serde_json::from_value::<SessionLine>(value.clone())
        .ok()?
        .git_branch()
        .map(String::from)
}

/// 1行分のJSONLエントリから、そのセッションのID(`sessionId`)を取り出す。
/// 送信前後の一致検証に使う(表示中のセッション ≠ 追記先セッション、を防ぐため)。
pub fn extract_session_id(value: &serde_json::Value) -> Option<String> {
    serde_json::from_value::<SessionLine>(value.clone())
        .ok()?
        .session_id()
        .map(String::from)
}

/// 1行分のJSONLエントリから `type=custom-title` の `customTitle` を取り出す。
/// 実データでは同一セッション内に複数回出現しうる(タイトル変更のたびに
/// 追記される。1セッションに12行観測された例がある)ため、呼び出し側で
/// 最後に見つかったものを採用すること(issue #33)。
pub fn extract_custom_title(value: &serde_json::Value) -> Option<String> {
    match serde_json::from_value::<SessionLine>(value.clone()).ok()? {
        SessionLine::CustomTitle(l) => l.custom_title,
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_message_reads_string_content() {
        let value = json!({
            "type": "user",
            "timestamp": "2026-01-01T00:00:00Z",
            "message": { "role": "user", "content": "hello" }
        });

        let message = extract_message(&value).expect("should extract message");
        assert_eq!(message.role, Role::User);
        assert_eq!(message.text, "hello");
        assert_eq!(message.timestamp, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn extract_message_joins_text_blocks_and_skips_others() {
        let value = json!({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    { "type": "thinking", "thinking": "internal reasoning", "signature": "sig" },
                    { "type": "text", "text": "first" },
                    { "type": "tool_use", "id": "toolu_1", "name": "some_tool", "input": {} },
                    { "type": "text", "text": "second" }
                ]
            }
        });

        let message = extract_message(&value).expect("should extract message");
        assert_eq!(message.role, Role::Assistant);
        assert_eq!(message.text, "first\n\nsecond");
    }

    #[test]
    fn extract_message_reads_text_blocks_within_user_array_content() {
        // 実データで観測された形式(画像添付と併用時など。§4.1(b))。
        let value = json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    { "type": "text", "text": "画像を見てください" },
                    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
                ]
            }
        });

        let message = extract_message(&value).expect("should extract message");
        assert_eq!(message.role, Role::User);
        assert_eq!(message.text, "画像を見てください");
    }

    #[test]
    fn extract_message_skips_user_tool_result_only_content() {
        let value = json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    { "type": "tool_result", "tool_use_id": "toolu_1", "content": "done" }
                ]
            }
        });

        assert!(extract_message(&value).is_none());
    }

    #[test]
    fn extract_message_skips_non_conversation_entry_types() {
        for entry_type in ["queue-operation", "custom-title", "summary"] {
            let value = json!({
                "type": entry_type,
                "message": { "content": "hello" }
            });
            assert!(extract_message(&value).is_none());
        }
    }

    #[test]
    fn extract_message_skips_when_text_is_empty() {
        let value = json!({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    { "type": "tool_use", "id": "toolu_1", "name": "some_tool", "input": {} }
                ]
            }
        });

        assert!(extract_message(&value).is_none());
    }

    #[test]
    fn extract_message_skips_when_message_field_missing() {
        let value = json!({ "type": "user" });
        assert!(extract_message(&value).is_none());
    }

    #[test]
    fn extract_message_returns_none_for_unknown_line_type() {
        // 将来バージョンで増える可能性がある未知の type は読み飛ばす。
        let value = json!({
            "type": "totally-new-future-type",
            "message": { "content": "hello" },
            "sessionId": "s1"
        });
        assert!(extract_message(&value).is_none());
    }

    #[test]
    fn extract_cwd_reads_field_when_present() {
        let value = json!({
            "type": "user",
            "cwd": "C:\\Users\\yanqi\\prj\\yaoyorozu",
            "message": { "role": "user", "content": "hello" }
        });
        assert_eq!(
            extract_cwd(&value).as_deref(),
            Some("C:\\Users\\yanqi\\prj\\yaoyorozu")
        );
    }

    #[test]
    fn extract_cwd_returns_none_when_missing() {
        let value = json!({ "type": "user", "message": { "content": "hello" } });
        assert!(extract_cwd(&value).is_none());
    }

    #[test]
    fn extract_cwd_returns_none_for_session_meta_lines() {
        // custom-title 等はChainLineBaseを持たないためcwdが無い。
        let value = json!({
            "type": "custom-title",
            "customTitle": "タイトル",
            "sessionId": "s1"
        });
        assert!(extract_cwd(&value).is_none());
    }

    #[test]
    fn extract_git_branch_reads_field_when_present() {
        let value = json!({
            "type": "user",
            "gitBranch": "feature/hub-cwd-branch",
            "message": { "role": "user", "content": "hello" }
        });
        assert_eq!(
            extract_git_branch(&value).as_deref(),
            Some("feature/hub-cwd-branch")
        );
    }

    #[test]
    fn extract_git_branch_returns_none_when_missing() {
        let value = json!({ "type": "user", "message": { "content": "hello" } });
        assert!(extract_git_branch(&value).is_none());
    }

    #[test]
    fn extract_git_branch_returns_head_verbatim_for_detached_state() {
        let value = json!({
            "type": "user",
            "gitBranch": "HEAD",
            "message": { "role": "user", "content": "hello" }
        });
        assert_eq!(extract_git_branch(&value).as_deref(), Some("HEAD"));
    }

    #[test]
    fn extract_git_branch_returns_none_for_session_meta_lines() {
        let value = json!({
            "type": "custom-title",
            "customTitle": "タイトル",
            "sessionId": "s1"
        });
        assert!(extract_git_branch(&value).is_none());
    }

    #[test]
    fn extract_session_id_reads_field_when_present() {
        let value = json!({
            "type": "user",
            "sessionId": "a36bcf64-6d83-4043-a1e5-e9eecd3bba80",
            "message": { "role": "user", "content": "hello" }
        });
        assert_eq!(
            extract_session_id(&value).as_deref(),
            Some("a36bcf64-6d83-4043-a1e5-e9eecd3bba80")
        );
    }

    #[test]
    fn extract_session_id_reads_field_from_session_meta_lines() {
        let value = json!({
            "type": "custom-title",
            "customTitle": "タイトル",
            "sessionId": "s1"
        });
        assert_eq!(extract_session_id(&value).as_deref(), Some("s1"));
    }

    #[test]
    fn extract_session_id_returns_none_when_missing() {
        let value = json!({ "type": "user" });
        assert!(extract_session_id(&value).is_none());
    }

    #[test]
    fn extract_custom_title_reads_field_when_type_matches() {
        let value = json!({
            "type": "custom-title",
            "customTitle": "yaoyorozu (デザイン)",
            "sessionId": "396a54d0-0000-0000-0000-000000000000"
        });
        assert_eq!(
            extract_custom_title(&value).as_deref(),
            Some("yaoyorozu (デザイン)")
        );
    }

    #[test]
    fn extract_custom_title_returns_none_for_other_types() {
        let value = json!({ "type": "ai-title", "aiTitle": "ignored", "sessionId": "s1" });
        assert!(extract_custom_title(&value).is_none());
    }

    #[test]
    fn session_line_deserializes_all_eleven_known_types_without_error() {
        let samples = [
            json!({
                "type": "user",
                "uuid": "u1", "parentUuid": null, "isSidechain": false,
                "sessionId": "s1", "timestamp": "2026-01-01T00:00:00Z",
                "cwd": "/tmp", "entrypoint": "cli", "version": "2.1.150",
                "gitBranch": "main", "userType": "external",
                "message": { "role": "user", "content": "hi" }
            }),
            json!({
                "type": "assistant",
                "sessionId": "s1", "requestId": "req_1",
                "message": {
                    "id": "msg_1", "type": "message", "role": "assistant", "model": "claude",
                    "content": [{ "type": "text", "text": "hi" }],
                    "stop_reason": "end_turn", "stop_sequence": null,
                    "usage": {
                        "input_tokens": 1, "output_tokens": 1,
                        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0
                    }
                }
            }),
            json!({
                "type": "system", "subtype": "stop_hook_summary", "sessionId": "s1",
                "level": "info", "hookCount": 1, "hookInfos": [], "hookErrors": [],
                "hookAdditionalContext": [], "preventedContinuation": false,
                "stopReason": "done", "hasOutput": false
            }),
            json!({
                "type": "system", "subtype": "api_error", "sessionId": "s1",
                "level": "error",
                "error": { "message": "boom", "formatted": "boom" },
                "retryInMs": 1000, "retryAttempt": 1, "maxRetries": 3, "source": "request_retry"
            }),
            json!({
                "type": "system", "subtype": "compact_boundary", "sessionId": "s1",
                "level": "info", "parentUuid": null, "logicalParentUuid": "u0",
                "content": "Conversation compacted", "isMeta": true,
                "compactMetadata": { "trigger": "manual", "preTokens": 100, "postTokens": 10, "durationMs": 5 }
            }),
            json!({
                "type": "system", "subtype": "informational", "sessionId": "s1",
                "level": "suggestion", "content": "note", "isMeta": true
            }),
            json!({
                "type": "attachment", "sessionId": "s1",
                "attachment": { "type": "task_reminder", "extra": "field" }
            }),
            json!({ "type": "queue-operation", "operation": "enqueue", "timestamp": "t", "sessionId": "s1", "content": "hi" }),
            json!({ "type": "last-prompt", "lastPrompt": "hi", "leafUuid": "u1", "sessionId": "s1" }),
            json!({ "type": "custom-title", "customTitle": "タイトル", "sessionId": "s1" }),
            json!({ "type": "ai-title", "aiTitle": "タイトル", "sessionId": "s1" }),
            json!({ "type": "mode", "mode": "normal", "sessionId": "s1" }),
            json!({
                "type": "pr-link", "sessionId": "s1", "prNumber": 33,
                "prUrl": "https://github.com/yanqirenshi/yaoyorozu/pull/33",
                "prRepository": "yanqirenshi/yaoyorozu", "timestamp": "t"
            }),
            json!({ "type": "atis-latch", "atis": "", "sessionId": "s1" }),
        ];

        for sample in samples {
            let result: Result<SessionLine, _> = serde_json::from_value(sample.clone());
            assert!(result.is_ok(), "failed to deserialize {sample}: {result:?}");
        }
    }

    #[test]
    fn session_line_falls_back_to_unknown_for_unrecognized_type() {
        let value = json!({ "type": "some-brand-new-type-from-a-future-version", "foo": "bar" });
        let line: SessionLine = serde_json::from_value(value).expect("should not error");
        assert!(matches!(line, SessionLine::Unknown));
    }

    #[test]
    fn system_line_falls_back_to_unknown_for_unrecognized_subtype() {
        let value =
            json!({ "type": "system", "subtype": "some-future-subtype", "sessionId": "s1" });
        let line: SessionLine = serde_json::from_value(value).expect("should not error");
        assert!(matches!(line, SessionLine::System(SystemLine::Unknown)));
    }

    #[test]
    fn session_line_tolerates_unknown_fields() {
        // deny_unknown_fields を付けていないため、未知フィールドがあっても
        // 落ちない(将来バージョンでフィールドが増えても壊れない)。
        let value = json!({
            "type": "custom-title",
            "customTitle": "タイトル",
            "sessionId": "s1",
            "brandNewFieldFromFutureVersion": { "nested": true }
        });
        let line: SessionLine = serde_json::from_value(value).expect("should not error");
        assert!(matches!(line, SessionLine::CustomTitle(_)));
    }
}
