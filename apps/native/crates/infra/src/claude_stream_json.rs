//! claude CLI の stream-json(標準入出力の JSON 行)の wire 形式(issue #391。PoC #382
//! レポート)。**wire 形式はこのファイルに閉じ込め**、domain の
//! [`ProgressEvent`] / [`PermissionRequest`] へ写す。domain・app は CLI の形を知らない。
//!
//! 読む側は寛容にする(制御メッセージは公式ドキュメントに無く、版で項目が増える。
//! 280 で実際に増えていた)。未知の `type` / `subtype` は捨て、必須の項目が欠けた行も
//! 捨てる(1行のせいで対話を止めない)。

use app::{
    AvailableModel, RunningPermissionMode, RunningSessionEvent, RunningSessionSwitch,
    StartRunningSession,
};
use domain::{
    ImageAttachment, PermissionBehavior, PermissionRequest, PermissionResponse,
    PermissionSuggestion, ProgressEvent,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// 子プロセスの起動引数(PoC #382 レポート §0.3)。`--print` は付けない(付けると対話が
/// 1回で終わる)。`--verbose` は必須(無いと exit 1。#345)。
/// 再開は `--resume=<ID>`、新規は `--session-id=<UUID>`(app が決めた ID。issue #407)。
/// 表示名は `--name=<名前>`(任意。先頭が `-` でもオプションと取り違えないよう `=` で1引数に
/// する)。`--permission-mode` には起動時に選んだモードを渡す。
pub(crate) fn build_args(request: &StartRunningSession) -> Vec<String> {
    let mut args: Vec<String> = [
        "--output-format",
        "stream-json",
        "--verbose",
        "--input-format",
        "stream-json",
        "--permission-prompt-tool",
        "stdio",
        "--replay-user-messages",
        "--include-partial-messages",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    match request {
        StartRunningSession::Resume { session_id, .. } => {
            args.push(format!("--resume={session_id}"))
        }
        StartRunningSession::New { session_id, .. } => {
            args.push(format!("--session-id={session_id}"))
        }
    }
    if let Some(name) = request.name() {
        args.push(format!("--name={name}"));
    }
    args.push("--permission-mode".to_string());
    args.push(mode_value(request.mode()).to_string());
    args
}

fn mode_value(mode: RunningPermissionMode) -> &'static str {
    mode.as_cli_value()
}

/// 標準入力へ書く user メッセージ1行(末尾に改行)。`content` は既存の画像付き送信
/// (#349)と同じ `[image..., text]` の順で、本文が空(画像だけ)なら text ブロックは
/// 付けない(API は空の text ブロックを拒否する)。
pub(crate) fn build_user_message_line(images: &[ImageAttachment], text: &str) -> String {
    let mut content: Vec<Value> = images
        .iter()
        .map(|image| {
            json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type.as_mime(),
                    "data": image.data_base64,
                }
            })
        })
        .collect();
    if !text.trim().is_empty() {
        content.push(json!({ "type": "text", "text": text }));
    }
    let line = json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
    });
    format!("{line}\n")
}

/// 起動直後に送る `initialize` の要求の `request_id`。CLI は `system/init` を最初のターンまで
/// 出さないので、これを送ってその応答を「起動できた(待機)」の合図にする(PoC #382 レポート §0.4・
/// §7.1)。応答にはアカウントのメールアドレスなどが含まれるので、**中身は読まない**
/// (合図としてだけ使い、画面にもログにも出さない)。
pub(crate) const INITIALIZE_REQUEST_ID: &str = "app-initialize";

/// `initialize` の要求。
pub(crate) fn build_initialize_line() -> String {
    format!(
        "{}
",
        json!({
            "type": "control_request",
            "request_id": INITIALIZE_REQUEST_ID,
            "request": { "subtype": "initialize" },
        })
    )
}

/// 中断の要求(`control_request` の `interrupt`)。
pub(crate) fn build_interrupt_line(request_id: &str) -> String {
    format!(
        "{}\n",
        json!({
            "type": "control_request",
            "request_id": request_id,
            "request": { "subtype": "interrupt" },
        })
    )
}

/// モデルの切り替え(`control_request` の `set_model`。PoC #382 レポート §6.2)。
pub(crate) fn build_set_model_line(request_id: &str, model: &str) -> String {
    format!(
        "{}\n",
        json!({
            "type": "control_request",
            "request_id": request_id,
            "request": { "subtype": "set_model", "model": model },
        })
    )
}

/// 権限モードの切り替え(`control_request` の `set_permission_mode`。レポート §6.2)。
pub(crate) fn build_set_permission_mode_line(request_id: &str, mode: &str) -> String {
    format!(
        "{}\n",
        json!({
            "type": "control_request",
            "request_id": request_id,
            "request": { "subtype": "set_permission_mode", "mode": mode },
        })
    )
}

/// 送った切り替えの要求(`request_id` → 内容)。CLI の `control_response` は要求 ID しか
/// 持たないので、受け入れられたときに何を切り替えたかを引く。要求 ID は infra が付ける
/// (app の型には無い)。書き込みスレッドと読み取りスレッドで共有する。
#[derive(Default)]
pub(crate) struct PendingSwitches(Mutex<HashMap<String, RunningSessionSwitch>>);

impl PendingSwitches {
    pub(crate) fn register(&self, request_id: &str, switch: RunningSessionSwitch) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(request_id.to_string(), switch);
    }

    fn take(&self, request_id: &str) -> Option<RunningSessionSwitch> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id)
    }

    /// 要求を取り消す(書き込みに失敗したとき)。
    pub(crate) fn forget(&self, request_id: &str) {
        self.take(request_id);
    }
}

/// 権限の応答(`control_response`)。`Cancelled` は CLI が問い合わせを取り下げた
/// 決着で、返す応答が無い(`None`)。
pub(crate) fn build_permission_response_line(response: &PermissionResponse) -> Option<String> {
    let body = match &response.behavior {
        PermissionBehavior::Allow {
            updated_input,
            updated_permissions,
        } => {
            let mut body = json!({ "behavior": "allow", "updatedInput": updated_input });
            if let Some(permissions) = updated_permissions {
                body["updatedPermissions"] = permissions.clone();
            }
            body
        }
        PermissionBehavior::Deny { message } => {
            json!({ "behavior": "deny", "message": message })
        }
        PermissionBehavior::Cancelled => return None,
    };
    Some(format!(
        "{}\n",
        json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": response.request_id,
                "response": body,
            },
        })
    ))
}

/// 標準出力の1行を、domain の出来事に写す(1行から 0 件以上)。
///
/// `system/init` は起動の合図(`Initialized`)に加えて、CLI が報告する現在の設定
/// (`model` / `permissionMode`)を `Configured` として流す(ターンごとに届く)。
/// `pending` は送った切り替えの要求で、その `control_response` が成功なら `SwitchApplied` に写す。
pub(crate) fn map_wire_line(
    line: &str,
    now_ms: u64,
    pending: &PendingSwitches,
) -> Vec<RunningSessionEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    match value.get("type").and_then(Value::as_str) {
        Some("system") => match value.get("subtype").and_then(Value::as_str) {
            Some("init") => {
                let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
                vec![
                    RunningSessionEvent::Initialized,
                    RunningSessionEvent::Configured {
                        model: text("model"),
                        permission_mode: text("permissionMode"),
                    },
                ]
            }
            _ => Vec::new(),
        },
        Some("stream_event") => map_stream_event(&value).into_iter().collect(),
        Some("user") => map_user(&value),
        Some("result") => {
            let failed = value.get("is_error").and_then(Value::as_bool) == Some(true);
            vec![RunningSessionEvent::Progress(ProgressEvent::TurnFinished {
                succeeded: !failed,
            })]
        }
        Some("control_request") => map_control_request(&value, now_ms).into_iter().collect(),
        // `initialize` の応答は、起動できたことの合図としてだけ使う(中身は読まない)。
        // 切り替えの応答は、成功なら `SwitchApplied`(失敗は捨てる。現在値は変わらない)。
        // ほかの `control_response`(中断の応答・許可応答のエコー)は捨てる。
        Some("control_response") => {
            let response = value.get("response");
            let request_id = response
                .and_then(|r| r.get("request_id"))
                .and_then(Value::as_str);
            if let Some(switch) = request_id.and_then(|id| pending.take(id)) {
                let succeeded = response
                    .and_then(|r| r.get("subtype"))
                    .and_then(Value::as_str)
                    == Some("success");
                return if succeeded {
                    vec![RunningSessionEvent::SwitchApplied(switch)]
                } else {
                    Vec::new()
                };
            }
            let is_initialize_reply = response
                .and_then(|r| r.get("request_id"))
                .and_then(Value::as_str)
                == Some(INITIALIZE_REQUEST_ID)
                && response
                    .and_then(|r| r.get("subtype"))
                    .and_then(Value::as_str)
                    == Some("success");
            if is_initialize_reply {
                // 起動の合図に加えて、選べるモデルの一覧だけを読む(`account` などは読まない)。
                let mut events = vec![RunningSessionEvent::Initialized];
                let models = available_models(response);
                if !models.is_empty() {
                    events.push(RunningSessionEvent::ModelsListed(models));
                }
                events
            } else {
                Vec::new()
            }
        }
        Some("control_cancel_request") => value
            .get("request_id")
            .and_then(Value::as_str)
            .map(|id| RunningSessionEvent::PermissionCancelled {
                request_id: id.to_string(),
            })
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

/// `initialize` の応答の `response.models`(`value` / `displayName` / `description`)。欠けた項目・
/// 形の違う要素は捨てる(版で項目が増える)。`response` のほかの項目には触れない。
fn available_models(response: Option<&Value>) -> Vec<AvailableModel> {
    response
        .and_then(|r| r.get("response"))
        .and_then(|r| r.get("models"))
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| {
                    let value = model.get("value")?.as_str()?.to_string();
                    let display_name = model
                        .get("displayName")
                        .and_then(Value::as_str)
                        .unwrap_or(&value)
                        .to_string();
                    let description = model
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    Some(AvailableModel {
                        value,
                        display_name,
                        description,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_stream_event(value: &Value) -> Option<RunningSessionEvent> {
    let event = value.get("event")?;
    match event.get("type")?.as_str()? {
        "content_block_start" => {
            let block = event.get("content_block")?;
            if block.get("type")?.as_str()? != "tool_use" {
                return None;
            }
            Some(RunningSessionEvent::Progress(ProgressEvent::ToolStarted {
                tool_use_id: block.get("id")?.as_str()?.to_string(),
                tool_name: block.get("name")?.as_str()?.to_string(),
            }))
        }
        "content_block_delta" => {
            let delta = event.get("delta")?;
            if delta.get("type")?.as_str()? != "text_delta" {
                return None;
            }
            let text = delta.get("text")?.as_str()?;
            if text.is_empty() {
                return None;
            }
            Some(RunningSessionEvent::Progress(ProgressEvent::TextDelta {
                text: text.to_string(),
            }))
        }
        _ => None,
    }
}

/// `user` 行は2種類ある: 送った user メッセージのエコー(`isReplay: true`。
/// `--replay-user-messages`)と、ツールの結果(`tool_result` ブロック)。
fn map_user(value: &Value) -> Vec<RunningSessionEvent> {
    let blocks = value
        .pointer("/message/content")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let results: Vec<RunningSessionEvent> = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
        .filter_map(|block| {
            Some(RunningSessionEvent::Progress(
                ProgressEvent::ToolResultArrived {
                    tool_use_id: block.get("tool_use_id")?.as_str()?.to_string(),
                    is_error: block.get("is_error").and_then(Value::as_bool) == Some(true),
                },
            ))
        })
        .collect();
    if !results.is_empty() {
        return results;
    }
    if value.get("isReplay").and_then(Value::as_bool) == Some(true) {
        if let Some(uuid) = value.get("uuid").and_then(Value::as_str) {
            return vec![RunningSessionEvent::Progress(
                ProgressEvent::SentLineConfirmed {
                    uuid: uuid.to_string(),
                },
            )];
        }
    }
    Vec::new()
}

/// `control_request` の `can_use_tool`(ツール使用の問い合わせ)。ほかの `subtype` は捨てる。
fn map_control_request(value: &Value, now_ms: u64) -> Option<RunningSessionEvent> {
    let request_id = value.get("request_id")?.as_str()?.to_string();
    let request = value.get("request")?;
    if request.get("subtype")?.as_str()? != "can_use_tool" {
        return None;
    }
    let text = |key: &str| request.get(key).and_then(Value::as_str).map(str::to_string);
    let suggestions: Vec<PermissionSuggestion> = request
        .get("permission_suggestions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(PermissionSuggestion::from_update_value)
                .collect()
        })
        .unwrap_or_default();
    Some(RunningSessionEvent::PermissionRequested(
        PermissionRequest {
            request_id,
            tool_name: request.get("tool_name")?.as_str()?.to_string(),
            display_name: text("display_name"),
            description: text("description"),
            tool_use_id: text("tool_use_id").unwrap_or_default(),
            tool_input: request.get("input").cloned().unwrap_or_else(|| json!({})),
            blocked_path: text("blocked_path").map(PathBuf::from),
            requested_at: now_ms,
            suggestions,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::ImageMediaType;

    // ---- 固定データ: PoC #382 レポート §2.1・§3.2・§5 の実出力(パスは置換済み) ----

    const PERM_WRITE: &str = r#"{"type":"control_request","request_id":"cedecce2-756e-4285-83ba-8ead60caca45","request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write","description":"poc382.txt","tool_use_id":"toolu_01QXhxXyoqdjxKT55KGzMftg","input":{"content":"hello","file_path":"C:\\ws\\poc382.txt"},"permission_suggestions":[{"destination":"session","mode":"acceptEdits","type":"setMode"}]}}"#;

    const PERM_BASH: &str = r#"{"type":"control_request","request_id":"b1","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","description":"Create poc382-dir directory","blocked_path":"C:\\ws\\poc382-dir","input":{"command":"mkdir poc382-dir","description":"Create poc382-dir directory"},"permission_suggestions":[{"type":"addRules","behavior":"allow","destination":"localSettings","rules":[{"toolName":"Bash","ruleContent":"mkdir poc382-dir *"}]},{"type":"addDirectories","destination":"session","directories":["C:\\ws"]},{"type":"setMode","destination":"session","mode":"acceptEdits"}],"tool_use_id":"toolu_01LUUAuR42gMvU9ccfkbTLzW"}}"#;

    const CANCEL: &str =
        r#"{"type":"control_cancel_request","request_id":"1a7556d1-0000-4000-8000-000000000000"}"#;

    fn progress(event: ProgressEvent) -> RunningSessionEvent {
        RunningSessionEvent::Progress(event)
    }

    /// 切り替えの要求が無い状態で読む(読み取りの検証の大半はこれで足りる)。
    fn map_wire_line(line: &str, now_ms: u64) -> Vec<RunningSessionEvent> {
        super::map_wire_line(line, now_ms, &PendingSwitches::default())
    }

    fn only(line: &str) -> RunningSessionEvent {
        let mut events = map_wire_line(line, 7);
        assert_eq!(events.len(), 1, "{line}");
        events.remove(0)
    }

    // ---- 読む側 ----

    #[test]
    fn maps_a_can_use_tool_request_for_write_with_a_set_mode_suggestion() {
        let RunningSessionEvent::PermissionRequested(request) = only(PERM_WRITE) else {
            panic!("expected PermissionRequested");
        };

        assert_eq!(request.request_id, "cedecce2-756e-4285-83ba-8ead60caca45");
        assert_eq!(request.tool_name, "Write");
        assert_eq!(request.display_name.as_deref(), Some("Write"));
        assert_eq!(request.description.as_deref(), Some("poc382.txt"));
        assert_eq!(request.tool_use_id, "toolu_01QXhxXyoqdjxKT55KGzMftg");
        assert_eq!(
            request.tool_input,
            json!({"content":"hello","file_path":"C:\\ws\\poc382.txt"})
        );
        assert_eq!(request.blocked_path, None);
        assert_eq!(request.requested_at, 7);
        assert_eq!(request.suggestions.len(), 1);
        assert_eq!(request.suggestions[0].suggestion_type, "setMode");
        assert_eq!(request.suggestions[0].suggestion_destination, "session");
    }

    #[test]
    fn maps_a_bash_request_with_blocked_path_and_all_three_suggestion_kinds() {
        let RunningSessionEvent::PermissionRequested(request) = only(PERM_BASH) else {
            panic!("expected PermissionRequested");
        };

        assert_eq!(request.tool_name, "Bash");
        assert_eq!(
            request.blocked_path,
            Some(PathBuf::from("C:\\ws\\poc382-dir"))
        );
        let kinds: Vec<&str> = request
            .suggestions
            .iter()
            .map(|s| s.suggestion_type.as_str())
            .collect();
        assert_eq!(kinds, vec!["addRules", "addDirectories", "setMode"]);
        // 「今後も許可」に入れ返す形が元の JSON と一致する
        assert_eq!(
            request.suggestions[0].to_update_value(),
            json!({"type":"addRules","behavior":"allow","destination":"localSettings","rules":[{"toolName":"Bash","ruleContent":"mkdir poc382-dir *"}]})
        );
    }

    #[test]
    fn the_initialize_reply_means_started_and_its_content_is_never_read() {
        // 実際の応答にはアカウントのメールアドレスなどが入る(レポート §6.6)。中身は使わない。
        let reply = r#"{"type":"control_response","response":{"subtype":"success","request_id":"app-initialize","response":{"account":{"email":"someone@example.com","subscriptionType":"max"},"models":[],"commands":[],"pid":123}}}"#;

        let events = map_wire_line(reply, 1);

        assert_eq!(events, vec![RunningSessionEvent::Initialized]);
        assert!(
            !format!("{events:?}").contains("someone@example.com"),
            "メールアドレスを出来事に含めない"
        );
    }

    #[test]
    fn the_initialize_reply_also_lists_the_available_models_but_still_not_the_account() {
        let reply = r#"{"type":"control_response","response":{"subtype":"success","request_id":"app-initialize","response":{"account":{"email":"someone@example.com"},"models":[{"value":"default","displayName":"Default (recommended)","description":"Opus 4.7","supportsEffort":true},{"value":"haiku","displayName":"Haiku"},{"displayName":"no value"},"junk"],"pid":1}}}"#;

        let events = map_wire_line(reply, 1);

        assert_eq!(
            events,
            vec![
                RunningSessionEvent::Initialized,
                RunningSessionEvent::ModelsListed(vec![
                    AvailableModel {
                        value: "default".to_string(),
                        display_name: "Default (recommended)".to_string(),
                        description: Some("Opus 4.7".to_string()),
                    },
                    AvailableModel {
                        value: "haiku".to_string(),
                        display_name: "Haiku".to_string(),
                        description: None,
                    },
                ])
            ]
        );
        assert!(!format!("{events:?}").contains("someone@example.com"));
    }

    #[test]
    fn other_control_responses_and_failed_initialize_replies_are_dropped() {
        for line in [
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"app-interrupt-1"}}"#,
            r#"{"type":"control_response","response":{"subtype":"error","request_id":"app-initialize","error":"x"}}"#,
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"perm-1","response":{"behavior":"allow"}}}"#,
            r#"{"type":"control_response"}"#,
        ] {
            assert!(map_wire_line(line, 1).is_empty(), "{line}");
        }
    }

    #[test]
    fn initialize_line_matches_the_wire_shape_in_the_report() {
        assert_eq!(
            serde_json::from_str::<Value>(build_initialize_line().trim_end()).unwrap(),
            json!({"type":"control_request","request_id":"app-initialize","request":{"subtype":"initialize"}})
        );
    }

    #[test]
    fn maps_a_cancel_request_to_a_cancellation() {
        assert_eq!(
            only(CANCEL),
            RunningSessionEvent::PermissionCancelled {
                request_id: "1a7556d1-0000-4000-8000-000000000000".to_string()
            }
        );
    }

    #[test]
    fn maps_system_init_to_initialized_and_the_reported_configuration() {
        assert_eq!(
            map_wire_line(
                r#"{"type":"system","subtype":"init","session_id":"s","model":"claude-opus-4-7","permissionMode":"default","cwd":"C:\\w"}"#,
                1
            ),
            [
                RunningSessionEvent::Initialized,
                RunningSessionEvent::Configured {
                    model: Some("claude-opus-4-7".to_string()),
                    permission_mode: Some("default".to_string()),
                }
            ]
        );
        // 項目が欠けた init でも、起動の合図は届く(設定は None)。
        assert_eq!(
            map_wire_line(r#"{"type":"system","subtype":"init"}"#, 1),
            [
                RunningSessionEvent::Initialized,
                RunningSessionEvent::Configured {
                    model: None,
                    permission_mode: None,
                }
            ]
        );
    }

    #[test]
    fn drops_other_system_lines() {
        for line in [
            r#"{"type":"system","subtype":"status","status":"requesting"}"#,
            r#"{"type":"system","subtype":"commands_changed"}"#,
            r#"{"type":"system","subtype":"hook_started"}"#,
            r#"{"type":"system","subtype":"permission_denied","message":"x"}"#,
        ] {
            assert!(map_wire_line(line, 1).is_empty(), "{line}");
        }
    }

    #[test]
    fn maps_text_deltas_and_tool_starts_from_partial_stream_events() {
        assert_eq!(
            only(
                r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"こんにちは"}},"parent_tool_use_id":null}"#
            ),
            progress(ProgressEvent::TextDelta {
                text: "こんにちは".to_string()
            })
        );
        assert_eq!(
            only(
                r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Write","input":{}}}}"#
            ),
            progress(ProgressEvent::ToolStarted {
                tool_use_id: "toolu_1".to_string(),
                tool_name: "Write".to_string()
            })
        );
    }

    #[test]
    fn drops_stream_events_that_are_not_text_or_tool_starts() {
        for line in [
            r#"{"type":"stream_event","event":{"type":"message_start","message":{"model":"m"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":""}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"a\""}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":""}}}"#,
            r#"{"type":"stream_event","event":{"type":"message_stop"}}"#,
        ] {
            assert!(map_wire_line(line, 1).is_empty(), "{line}");
        }
    }

    #[test]
    fn maps_the_replayed_user_message_to_a_confirmed_line() {
        // 実出力(未ログインの隔離環境で取得): isReplay: true と uuid が付く。
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"テスト質問です"}]},"session_id":"028bbe04","parent_tool_use_id":null,"uuid":"ec880f72-b0f7-4866-8267-8d96e3153172","timestamp":"2026-09-25T00:06:37.559Z","isReplay":true}"#;

        assert_eq!(
            only(line),
            progress(ProgressEvent::SentLineConfirmed {
                uuid: "ec880f72-b0f7-4866-8267-8d96e3153172".to_string()
            })
        );
    }

    #[test]
    fn a_user_line_that_is_not_a_replay_is_not_a_confirmed_line() {
        // 中断のときに CLI が自分で書く user 行など(送った行ではない)。
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]},"uuid":"u1"}"#;

        assert!(map_wire_line(line, 1).is_empty());
    }

    #[test]
    fn maps_tool_results_including_error_ones() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"},{"type":"tool_result","tool_use_id":"toolu_2","content":"The user doesn't want to proceed","is_error":true}]},"parent_tool_use_id":null}"#;

        assert_eq!(
            map_wire_line(line, 1),
            vec![
                progress(ProgressEvent::ToolResultArrived {
                    tool_use_id: "toolu_1".to_string(),
                    is_error: false
                }),
                progress(ProgressEvent::ToolResultArrived {
                    tool_use_id: "toolu_2".to_string(),
                    is_error: true
                }),
            ]
        );
    }

    #[test]
    fn maps_result_lines_to_turn_finished() {
        // 成功
        assert_eq!(
            only(
                r#"{"type":"result","subtype":"success","is_error":false,"result":"PING","num_turns":1}"#
            ),
            progress(ProgressEvent::TurnFinished { succeeded: true })
        );
        // 実出力: 未ログインでは subtype は success のまま is_error が true になる
        assert_eq!(
            only(
                r#"{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}"#
            ),
            progress(ProgressEvent::TurnFinished { succeeded: false })
        );
        // 中断(レポート §3.1)
        assert_eq!(
            only(
                r#"{"type":"result","subtype":"error_during_execution","is_error":true,"terminal_reason":"aborted_streaming"}"#
            ),
            progress(ProgressEvent::TurnFinished { succeeded: false })
        );
    }

    #[test]
    fn drops_unknown_and_malformed_lines_and_versioned_extras() {
        for line in [
            "",
            "not json",
            "[1,2,3]",
            r#"{"no_type":true}"#,
            r#"{"type":"rate_limit_event","rate_limit_info":{}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}"#,
            r#"{"type":"some_future_type"}"#,
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"int-1"}}"#,
            r#"{"type":"control_request","request_id":"x","request":{"subtype":"some_future_request"}}"#,
            // 必須項目(tool_name)が欠けた問い合わせは捨てる
            r#"{"type":"control_request","request_id":"x","request":{"subtype":"can_use_tool"}}"#,
        ] {
            assert!(map_wire_line(line, 1).is_empty(), "{line}");
        }
    }

    #[test]
    fn tolerates_extra_unknown_fields_in_a_permission_request() {
        let line = r#"{"type":"control_request","request_id":"r","request":{"subtype":"can_use_tool","tool_name":"Read","tool_use_id":"t","input":{"file_path":"a"},"future_field":{"x":1}},"another":true}"#;

        let RunningSessionEvent::PermissionRequested(request) = only(line) else {
            panic!("expected PermissionRequested");
        };
        assert_eq!(request.tool_name, "Read");
        assert!(request.suggestions.is_empty());
        assert_eq!(request.display_name, None);
    }

    // ---- 書く側 ----

    fn image(data: &str) -> ImageAttachment {
        ImageAttachment {
            media_type: ImageMediaType::Png,
            data_base64: data.to_string(),
        }
    }

    #[test]
    fn user_message_line_is_image_blocks_then_text_and_ends_with_a_newline() {
        let line = build_user_message_line(&[image("AAAA")], "見てください");

        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1, "1行 1 JSON");
        let value: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(value["type"], "user");
        assert_eq!(value["parent_tool_use_id"], Value::Null);
        assert_eq!(value["message"]["role"], "user");
        assert_eq!(
            value["message"]["content"],
            json!([
                {"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}},
                {"type":"text","text":"見てください"}
            ])
        );
    }

    #[test]
    fn an_image_only_message_has_no_text_block() {
        let line = build_user_message_line(&[image("AAAA")], "   ");
        let value: Value = serde_json::from_str(line.trim_end()).unwrap();

        assert_eq!(value["message"]["content"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_text_only_message_has_a_single_text_block() {
        let line = build_user_message_line(&[], "こんにちは\n2行目");
        let value: Value = serde_json::from_str(line.trim_end()).unwrap();

        assert_eq!(
            value["message"]["content"],
            json!([{"type":"text","text":"こんにちは\n2行目"}])
        );
    }

    #[test]
    fn allow_response_matches_the_wire_shape_in_the_report() {
        let response = PermissionResponse::allow(
            "r1",
            &json!({"file_path":"a"}),
            None,
            Some(json!([{"type":"setMode","destination":"session","mode":"acceptEdits"}])),
            1,
        );

        let line = build_permission_response_line(&response).expect("a line");

        let value: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(
            value,
            json!({
                "type":"control_response",
                "response":{
                    "subtype":"success",
                    "request_id":"r1",
                    "response":{
                        "behavior":"allow",
                        "updatedInput":{"file_path":"a"},
                        "updatedPermissions":[{"type":"setMode","destination":"session","mode":"acceptEdits"}]
                    }
                }
            })
        );
    }

    #[test]
    fn allow_response_without_permissions_has_no_updated_permissions_key() {
        let response = PermissionResponse::allow("r1", &json!({}), None, None, 1);
        let line = build_permission_response_line(&response).unwrap();
        let value: Value = serde_json::from_str(line.trim_end()).unwrap();

        assert!(value["response"]["response"]
            .get("updatedPermissions")
            .is_none());
    }

    #[test]
    fn deny_response_carries_the_message_and_cancel_writes_nothing() {
        let deny = build_permission_response_line(&PermissionResponse::deny("r1", "だめ", 1))
            .expect("a line");
        let value: Value = serde_json::from_str(deny.trim_end()).unwrap();
        assert_eq!(
            value["response"]["response"],
            json!({"behavior":"deny","message":"だめ"})
        );

        assert!(build_permission_response_line(&PermissionResponse::cancelled("r1", 1)).is_none());
    }

    #[test]
    fn interrupt_line_matches_the_wire_shape_in_the_report() {
        let line = build_interrupt_line("int-1");

        assert_eq!(
            serde_json::from_str::<Value>(line.trim_end()).unwrap(),
            json!({"type":"control_request","request_id":"int-1","request":{"subtype":"interrupt"}})
        );
    }

    #[test]
    fn set_model_and_set_permission_mode_lines_match_the_wire_shape_in_the_report() {
        assert_eq!(
            serde_json::from_str::<Value>(build_set_model_line("m-1", "haiku").trim_end()).unwrap(),
            json!({"type":"control_request","request_id":"m-1","request":{"subtype":"set_model","model":"haiku"}})
        );
        assert_eq!(
            serde_json::from_str::<Value>(
                build_set_permission_mode_line("p-1", "acceptEdits").trim_end()
            )
            .unwrap(),
            json!({"type":"control_request","request_id":"p-1","request":{"subtype":"set_permission_mode","mode":"acceptEdits"}})
        );
    }

    #[test]
    fn a_successful_switch_response_becomes_switch_applied_once() {
        let pending = PendingSwitches::default();
        pending.register("m-1", RunningSessionSwitch::Model("haiku".to_string()));
        pending.register(
            "p-1",
            RunningSessionSwitch::PermissionMode(RunningPermissionMode::Plan),
        );
        let ok_model =
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"m-1"}}"#;
        let ok_mode = r#"{"type":"control_response","response":{"subtype":"success","request_id":"p-1","response":{"mode":"plan"}}}"#;

        assert_eq!(
            super::map_wire_line(ok_model, 1, &pending),
            [RunningSessionEvent::SwitchApplied(
                RunningSessionSwitch::Model("haiku".to_string())
            )]
        );
        assert_eq!(
            super::map_wire_line(ok_mode, 1, &pending),
            [RunningSessionEvent::SwitchApplied(
                RunningSessionSwitch::PermissionMode(RunningPermissionMode::Plan)
            )]
        );
        // 同じ応答が2度届いても、2度は反映しない。
        assert!(super::map_wire_line(ok_model, 1, &pending).is_empty());
    }

    #[test]
    fn a_failed_switch_response_and_an_unknown_request_id_change_nothing() {
        let pending = PendingSwitches::default();
        pending.register("m-1", RunningSessionSwitch::Model("nope".to_string()));
        let failed = r#"{"type":"control_response","response":{"subtype":"error","request_id":"m-1","error":"unknown model"}}"#;
        let unknown =
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"other"}}"#;

        assert!(super::map_wire_line(failed, 1, &pending).is_empty());
        assert!(super::map_wire_line(unknown, 1, &pending).is_empty());
    }

    fn resume_request(name: Option<&str>, mode: RunningPermissionMode) -> StartRunningSession {
        StartRunningSession::Resume {
            session_id: "abc-123".to_string(),
            cwd: PathBuf::from("/w"),
            mode,
            repository_path: PathBuf::from("/r"),
            name: name.map(str::to_string),
        }
    }

    #[test]
    fn args_follow_the_report_and_never_include_print() {
        let args = build_args(&resume_request(None, RunningPermissionMode::Plan));

        assert_eq!(
            args,
            [
                "--output-format",
                "stream-json",
                "--verbose",
                "--input-format",
                "stream-json",
                "--permission-prompt-tool",
                "stdio",
                "--replay-user-messages",
                "--include-partial-messages",
                "--resume=abc-123",
                "--permission-mode",
                "plan",
            ]
        );
        assert!(!args.iter().any(|a| a == "--print"));
        let default_args = build_args(&resume_request(None, RunningPermissionMode::Default));
        assert_eq!(default_args.last().map(String::as_str), Some("default"));
    }

    #[test]
    fn a_new_conversation_passes_session_id_instead_of_resume() {
        let args = build_args(&StartRunningSession::New {
            session_id: "3a392392-0000-4000-8000-000000000001".to_string(),
            cwd: PathBuf::from("/r"),
            mode: RunningPermissionMode::AcceptEdits,
            repository_path: PathBuf::from("/r"),
            name: None,
        });

        assert!(args.contains(&"--session-id=3a392392-0000-4000-8000-000000000001".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--resume")));
        assert!(!args.iter().any(|a| a.starts_with("--name")));
        assert_eq!(
            &args[args.len() - 2..],
            ["--permission-mode", "acceptEdits"]
        );
    }

    #[test]
    fn the_name_is_one_equals_joined_argument_so_a_leading_dash_is_not_an_option() {
        let resumed = build_args(&resume_request(Some("調査 A"), RunningPermissionMode::Auto));
        let dashed = build_args(&resume_request(
            Some("--dangerous"),
            RunningPermissionMode::Auto,
        ));

        assert!(resumed.contains(&"--name=調査 A".to_string()));
        assert!(dashed.contains(&"--name=--dangerous".to_string()));
        assert!(!dashed.iter().any(|a| a == "--dangerous"));
        assert_eq!(resumed.last().map(String::as_str), Some("auto"));
    }
}
