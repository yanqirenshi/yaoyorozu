//! `.jsonl` の1行分から会話表示・ハブ表示に必要な値を取り出す、特定の型に
//! 属さない純粋関数群(native.md §1: 型に属さない関数は機能別ファイルに
//! まとめる)。

use super::{AssistantContentBlock, SessionLine, UserContent, UserContentBlock};
use crate::{Message, Role};

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
    message_from_line(&line)
}

/// 構築済みの `SessionLine` から、会話として表示すべきメッセージを取り出す。
/// `extract_message`(`&Value` 版)と `ScannedLine::message`(issue #302)が
/// 共有する、抽出ルールの唯一の実装。
pub(super) fn message_from_line(line: &SessionLine) -> Option<Message> {
    let (role, text, timestamp, uuid, image_count) = match line {
        SessionLine::User(l) => (
            Role::User,
            user_content_text(&l.message.content),
            l.base.timestamp.clone().unwrap_or_default(),
            l.base.uuid.clone(),
            l.base64_images().len(),
        ),
        SessionLine::Assistant(l) => (
            Role::Assistant,
            assistant_content_text(&l.message.content),
            l.base.timestamp.clone().unwrap_or_default(),
            l.base.uuid.clone(),
            0,
        ),
        _ => return None,
    };

    // 本文が空でも、画像が付いていれば表示対象にする(画像だけの貼り付け。issue #349)。
    if text.trim().is_empty() && image_count == 0 {
        return None;
    }

    Some(Message {
        role,
        text,
        timestamp,
        uuid,
        image_count,
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

/// 1行分のJSONLエントリから `type=ai-title` の `aiTitle` を取り出す
/// (オブジェクトモデル実装 第4弾。issue #197。`domain::Session.ai_title`)。
/// `custom_title` と同じ「セッションメタ行」の流儀で、呼び出し側で最後に
/// 見つかったものを採用すること。
pub fn extract_ai_title(value: &serde_json::Value) -> Option<String> {
    match serde_json::from_value::<SessionLine>(value.clone()).ok()? {
        SessionLine::AiTitle(l) => l.ai_title,
        _ => None,
    }
}

/// 1行分のJSONLエントリから `type=mode` の `mode` を取り出す(issue #197。
/// `domain::Session.mode`)。呼び出し側で最後に見つかったものを採用すること。
pub fn extract_mode(value: &serde_json::Value) -> Option<String> {
    match serde_json::from_value::<SessionLine>(value.clone()).ok()? {
        SessionLine::Mode(l) => l.mode,
        _ => None,
    }
}

/// 1行分のJSONLエントリから `type=last-prompt` の `lastPrompt` を取り出す
/// (issue #197。`domain::Session.last_prompt`。クラス図上は導出属性
/// `/last_prompt`)。呼び出し側で最後に見つかったものを採用すること。
pub fn extract_last_prompt(value: &serde_json::Value) -> Option<String> {
    match serde_json::from_value::<SessionLine>(value.clone()).ok()? {
        SessionLine::LastPrompt(l) => l.last_prompt,
        _ => None,
    }
}

/// 1行分のJSONLエントリから `slug`(TM: セッション別名)を取り出す
/// (issue #197。`domain::Session.slug`)。`cwd`/`gitBranch` と同じく会話
/// チェーン行(`ChainLineBase`)が持つ値で、セッション中のcheckout等に
/// 追従して複数回出現しうるため、呼び出し側で最後に見つかったものを
/// 採用すること。
pub fn extract_slug(value: &serde_json::Value) -> Option<String> {
    serde_json::from_value::<SessionLine>(value.clone())
        .ok()?
        .slug()
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_line::SystemLine;
    use serde_json::json;

    #[test]
    fn extract_message_carries_the_uuid_of_its_source_line() {
        // 元の jsonl 行を引き当てるキー(issue #313)。ユーザー・アシスタントとも、
        // 行に uuid が無ければ None。
        let user = json!({
            "type": "user", "uuid": "u-1",
            "message": { "role": "user", "content": "hello" }
        });
        let assistant = json!({
            "type": "assistant", "uuid": "a-1",
            "message": { "role": "assistant", "content": [{ "type": "text", "text": "hi" }] }
        });
        let no_uuid = json!({
            "type": "user",
            "message": { "role": "user", "content": "hello" }
        });

        assert_eq!(extract_message(&user).unwrap().uuid.as_deref(), Some("u-1"));
        assert_eq!(
            extract_message(&assistant).unwrap().uuid.as_deref(),
            Some("a-1")
        );
        assert_eq!(extract_message(&no_uuid).unwrap().uuid, None);
    }

    #[test]
    fn extract_message_counts_displayable_images_and_keeps_image_only_messages() {
        // issue #349: 画像だけの発言も表示対象。URL参照・対応外形式は数えない。
        let image_only = json!({
            "type": "user", "uuid": "u-1",
            "message": { "role": "user", "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } },
                { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "BBBB" } },
                { "type": "image", "source": { "type": "url", "url": "https://example.com/a.png" } }
            ] }
        });
        let message = extract_message(&image_only).expect("image-only message is kept");
        assert_eq!(message.text, "");
        assert_eq!(message.image_count, 2);

        let with_text = json!({
            "type": "user",
            "message": { "role": "user", "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } },
                { "type": "text", "text": "見てください" }
            ] }
        });
        let message = extract_message(&with_text).unwrap();
        assert_eq!(
            (message.text.as_str(), message.image_count),
            ("見てください", 1)
        );

        // 画像も本文も無ければ従来どおり非表示。
        let unsupported_only = json!({
            "type": "user",
            "message": { "role": "user", "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/svg+xml", "data": "AAAA" } }
            ] }
        });
        assert!(extract_message(&unsupported_only).is_none());
    }

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
    fn extract_ai_title_reads_field_when_type_matches() {
        let value =
            json!({ "type": "ai-title", "aiTitle": "AIが付けたタイトル", "sessionId": "s1" });
        assert_eq!(
            extract_ai_title(&value).as_deref(),
            Some("AIが付けたタイトル")
        );
    }

    #[test]
    fn extract_ai_title_returns_none_for_other_types() {
        let value = json!({ "type": "mode", "mode": "chat", "sessionId": "s1" });
        assert!(extract_ai_title(&value).is_none());
    }

    #[test]
    fn extract_mode_reads_field_when_type_matches() {
        let value = json!({ "type": "mode", "mode": "read", "sessionId": "s1" });
        assert_eq!(extract_mode(&value).as_deref(), Some("read"));
    }

    #[test]
    fn extract_mode_returns_none_for_other_types() {
        let value = json!({ "type": "ai-title", "aiTitle": "ignored", "sessionId": "s1" });
        assert!(extract_mode(&value).is_none());
    }

    #[test]
    fn extract_last_prompt_reads_field_when_type_matches() {
        let value = json!({
            "type": "last-prompt",
            "lastPrompt": "テストを書いて",
            "leafUuid": "u1",
            "sessionId": "s1"
        });
        assert_eq!(
            extract_last_prompt(&value).as_deref(),
            Some("テストを書いて")
        );
    }

    #[test]
    fn extract_last_prompt_returns_none_for_other_types() {
        let value = json!({ "type": "mode", "mode": "chat", "sessionId": "s1" });
        assert!(extract_last_prompt(&value).is_none());
    }

    #[test]
    fn extract_slug_reads_field_when_present() {
        let value = json!({
            "type": "user",
            "slug": "sunny-otter",
            "message": { "role": "user", "content": "hello" }
        });
        assert_eq!(extract_slug(&value).as_deref(), Some("sunny-otter"));
    }

    #[test]
    fn extract_slug_returns_none_when_missing() {
        let value = json!({ "type": "user", "message": { "content": "hello" } });
        assert!(extract_slug(&value).is_none());
    }

    #[test]
    fn extract_slug_returns_none_for_session_meta_lines() {
        let value = json!({ "type": "custom-title", "customTitle": "タイトル", "sessionId": "s1" });
        assert!(extract_slug(&value).is_none());
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
