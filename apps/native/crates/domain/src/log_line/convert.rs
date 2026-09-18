use super::{
    AssistantLogLine, AttachmentLogLine, LogLine, LogLineBase, SystemLogLine, UserLogLine,
};
use crate::session_line::SystemLine;
use crate::{
    parse_iso_timestamp_to_epoch_ms, AssistantLine, AttachmentLine, ChainLineBase, SessionLine,
    SystemLevel, UserLine,
};
use std::path::PathBuf;

/// [`convert_json_line_to_log_line`] が変換できなかった理由(オブジェクト
/// モデル実装 第6弾。issue #208)。会話チェーン行(user/assistant/system/
/// attachment)以外(custom-title等のセッションメタ行、未知の`type`)は
/// エラーではなく`Ok(None)`で表す(そもそも`LogLine`の対象外のため)。
/// こちらは「チェーン行のはずなのに変換できなかった」場合のみを表す。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogLineConversionError {
    /// `uuid`が無い(個体指定子が無いため`LogLine`を作れない)。
    MissingUuid,
    /// `timestamp`が無い、またはISO8601として解釈できない
    /// (issue本文: 実在した場合はデザインへ報告すること)。
    MissingOrInvalidTimestamp,
}

// `logical_parent_uuid`は`ChainLineBase`には無く、jsonl上は
// `compact_boundary`システム行だけが持つ値(`CompactBoundaryLine`固有
// フィールド)。クラス図では`LogLine`共通属性として持たせる設計のため、
// 呼び出し側(`build_system_log_line`)がその場合だけ値を渡し、それ以外の
// 行種別では常に`None`にする。
fn build_log_line_base(
    base: &ChainLineBase,
    logical_parent_uuid: Option<String>,
) -> Result<LogLineBase, LogLineConversionError> {
    let uuid = base
        .uuid
        .clone()
        .ok_or(LogLineConversionError::MissingUuid)?;
    let timestamp = base
        .timestamp
        .as_deref()
        .and_then(parse_iso_timestamp_to_epoch_ms)
        .ok_or(LogLineConversionError::MissingOrInvalidTimestamp)?;
    Ok(LogLineBase {
        uuid,
        parent_uuid: base.parent_uuid.clone(),
        logical_parent_uuid,
        timestamp,
        cwd: base.cwd.as_ref().map(PathBuf::from),
        entrypoint: base.entrypoint.clone(),
        version: base.version.clone(),
        git_branch: base.git_branch.clone(),
        is_sidechain: base.is_sidechain,
        user_type: base.user_type.clone(),
    })
}

fn build_user_log_line(line: UserLine) -> Result<LogLine, LogLineConversionError> {
    let base = build_log_line_base(&line.base, None)?;
    Ok(LogLine::User(UserLogLine {
        base,
        prompt_id: line.prompt_id,
        permission_mode: line.permission_mode,
    }))
}

fn build_assistant_log_line(line: AssistantLine) -> Result<LogLine, LogLineConversionError> {
    let base = build_log_line_base(&line.base, None)?;
    Ok(LogLine::Assistant(AssistantLogLine {
        base,
        request_id: line.request_id,
        message_id: line.message.id,
        model: line.message.model,
        stop_reason: line.message.stop_reason,
    }))
}

// `SystemLevel`(info/warning/error/suggestion/unknown)を`SystemLogLine.level`
// (`Option<String>`)の値へ変換する。派生元の`#[serde(rename_all =
// "lowercase")]`と揃うようDebug表示を小文字化するだけで足りる。
fn system_level_to_string(level: &SystemLevel) -> String {
    format!("{level:?}").to_lowercase()
}

fn build_system_log_line(line: SystemLine) -> Result<Option<LogLine>, LogLineConversionError> {
    // `SystemLine::base()`は`session_line`モジュール内限定(`pub(super)`)の
    // ためここからは呼べない。各サブタイプの`base`フィールド(`pub`)へ
    // 直接マッチして取り出す。
    let (base, logical_parent_uuid, subtype, level) = match &line {
        SystemLine::StopHookSummary(l) => (
            &l.base,
            None,
            "stop_hook_summary",
            l.level.as_ref().map(system_level_to_string),
        ),
        SystemLine::ApiError(l) => (&l.base, None, "api_error", None),
        SystemLine::CompactBoundary(l) => (
            &l.base,
            l.logical_parent_uuid.clone(),
            "compact_boundary",
            None,
        ),
        SystemLine::Informational(l) => (&l.base, None, "informational", None),
        // 未知のsubtype。エラーではなく対象外。
        SystemLine::Unknown => return Ok(None),
    };
    let base = build_log_line_base(base, logical_parent_uuid)?;
    Ok(Some(LogLine::System(SystemLogLine {
        base,
        subtype: subtype.to_string(),
        level,
    })))
}

fn build_attachment_log_line(line: AttachmentLine) -> Result<LogLine, LogLineConversionError> {
    let base = build_log_line_base(&line.base, None)?;
    // `attachment.type`(23種。issue #39時点で構造化していない生JSON)から
    // 種別文字列を取り出す。無い/文字列でない場合は"unknown"にする
    // (timestampと違い、実データ確認・デザインへの報告が明示的に必要な
    // 項目ではないため、素直なフォールバックでよい)。
    let attachment_type = line
        .attachment
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    Ok(LogLine::Attachment(AttachmentLogLine {
        base,
        attachment_type,
    }))
}

/// 1行分の`SessionLine`を`LogLine`へ変換する(issue #208)。会話チェーン行
/// (user/assistant/system/attachment)以外は`Ok(None)`(そもそも`LogLine`の
/// 対象外。custom-title等は`Session`の属性導出に使う。issue本文の指示)。
/// チェーン行なのに`uuid`/`timestamp`を変換できない場合は`Err`を返す
/// (呼び出し側でスキップし、実データで発生したかを集計してデザインへ
/// 報告すること)。
pub fn convert_session_line(line: SessionLine) -> Result<Option<LogLine>, LogLineConversionError> {
    match line {
        SessionLine::User(l) => build_user_log_line(l).map(Some),
        SessionLine::Assistant(l) => build_assistant_log_line(l).map(Some),
        SessionLine::System(l) => build_system_log_line(l),
        SessionLine::Attachment(l) => build_attachment_log_line(l).map(Some),
        _ => Ok(None),
    }
}

/// 1行分のjsonlエントリ(生JSON)を`LogLine`へ変換する(issue #208)。
/// `extract_cwd`等(`session_line::extract`)と同じく、そもそも`SessionLine`
/// として解釈できない行(将来の未知フォーマット等)は`Ok(None)`にする
/// (行全体を読み飛ばす。壊れた1行のせいでファイル全体の読み込みを止めない)。
pub fn convert_json_line_to_log_line(
    value: &serde_json::Value,
) -> Result<Option<LogLine>, LogLineConversionError> {
    let Ok(line) = serde_json::from_value::<SessionLine>(value.clone()) else {
        return Ok(None);
    };
    convert_session_line(line)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn convert_json_line_to_log_line_builds_user_log_line_with_base_fields() {
        let value = json!({
            "type": "user",
            "uuid": "u1",
            "parentUuid": "parent-1",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "cwd": "/repo",
            "gitBranch": "main",
            "isSidechain": false,
            "message": { "role": "user", "content": "hello" },
            "promptId": "p1",
            "permissionMode": "chat"
        });

        let line = convert_json_line_to_log_line(&value)
            .expect("should not error")
            .expect("should convert to a LogLine");

        match line {
            LogLine::User(l) => {
                assert_eq!(l.base.uuid, "u1");
                assert_eq!(l.base.parent_uuid.as_deref(), Some("parent-1"));
                assert_eq!(l.base.logical_parent_uuid, None);
                assert_eq!(l.base.timestamp, 1_767_225_600_000);
                assert_eq!(l.base.cwd, Some(PathBuf::from("/repo")));
                assert_eq!(l.base.git_branch.as_deref(), Some("main"));
                assert_eq!(l.prompt_id.as_deref(), Some("p1"));
                assert_eq!(l.permission_mode.as_deref(), Some("chat"));
            }
            other => panic!("expected UserLogLine, got {other:?}"),
        }
    }

    #[test]
    fn convert_json_line_to_log_line_builds_assistant_log_line_from_nested_message() {
        let value = json!({
            "type": "assistant",
            "uuid": "u2",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "requestId": "req1",
            "message": {
                "id": "msg1",
                "role": "assistant",
                "model": "claude",
                "content": [{ "type": "text", "text": "hi" }],
                "stop_reason": "end_turn"
            }
        });

        let line = convert_json_line_to_log_line(&value)
            .expect("should not error")
            .expect("should convert to a LogLine");

        match line {
            LogLine::Assistant(l) => {
                assert_eq!(l.request_id.as_deref(), Some("req1"));
                assert_eq!(l.message_id.as_deref(), Some("msg1"));
                assert_eq!(l.model.as_deref(), Some("claude"));
                assert_eq!(l.stop_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("expected AssistantLogLine, got {other:?}"),
        }
    }

    #[test]
    fn convert_json_line_to_log_line_builds_system_log_line_with_subtype_and_level() {
        let value = json!({
            "type": "system",
            "subtype": "stop_hook_summary",
            "uuid": "u3",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "level": "warning"
        });

        let line = convert_json_line_to_log_line(&value)
            .expect("should not error")
            .expect("should convert to a LogLine");

        match line {
            LogLine::System(l) => {
                assert_eq!(l.subtype, "stop_hook_summary");
                assert_eq!(l.level.as_deref(), Some("warning"));
            }
            other => panic!("expected SystemLogLine, got {other:?}"),
        }
    }

    #[test]
    fn convert_json_line_to_log_line_carries_logical_parent_uuid_only_for_compact_boundary() {
        let value = json!({
            "type": "system",
            "subtype": "compact_boundary",
            "uuid": "u4",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "logicalParentUuid": "before-compact"
        });

        let line = convert_json_line_to_log_line(&value)
            .expect("should not error")
            .expect("should convert to a LogLine");

        match line {
            LogLine::System(l) => {
                assert_eq!(l.subtype, "compact_boundary");
                assert_eq!(l.level, None);
                assert_eq!(
                    l.base.logical_parent_uuid.as_deref(),
                    Some("before-compact")
                );
            }
            other => panic!("expected SystemLogLine, got {other:?}"),
        }
    }

    #[test]
    fn convert_json_line_to_log_line_returns_none_for_unknown_system_subtype() {
        let value = json!({
            "type": "system",
            "subtype": "something-new",
            "uuid": "u5",
            "timestamp": "2026-01-01T00:00:00.000Z"
        });

        let result = convert_json_line_to_log_line(&value).expect("should not error");
        assert_eq!(result, None);
    }

    #[test]
    fn convert_json_line_to_log_line_builds_attachment_log_line_with_type_from_json() {
        let value = json!({
            "type": "attachment",
            "uuid": "u6",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "attachment": { "type": "pasted-text", "content": "..." }
        });

        let line = convert_json_line_to_log_line(&value)
            .expect("should not error")
            .expect("should convert to a LogLine");

        match line {
            LogLine::Attachment(l) => assert_eq!(l.attachment_type, "pasted-text"),
            other => panic!("expected AttachmentLogLine, got {other:?}"),
        }
    }

    #[test]
    fn convert_json_line_to_log_line_defaults_attachment_type_to_unknown_when_missing() {
        let value = json!({
            "type": "attachment",
            "uuid": "u7",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "attachment": { "content": "..." }
        });

        let line = convert_json_line_to_log_line(&value)
            .expect("should not error")
            .expect("should convert to a LogLine");

        match line {
            LogLine::Attachment(l) => assert_eq!(l.attachment_type, "unknown"),
            other => panic!("expected AttachmentLogLine, got {other:?}"),
        }
    }

    #[test]
    fn convert_json_line_to_log_line_returns_none_for_non_chain_lines() {
        let value = json!({ "type": "custom-title", "customTitle": "t", "sessionId": "s1" });
        assert_eq!(convert_json_line_to_log_line(&value), Ok(None));
    }

    #[test]
    fn convert_json_line_to_log_line_returns_none_for_unrecognized_type() {
        // `type`が無い/未知の行は`SessionLine::Unknown`に落ちる
        // (session_line側の既存仕様)ため、こちらも対象外として`None`。
        let value = json!({ "uuid": "u8", "timestamp": "2026-01-01T00:00:00.000Z" });
        assert_eq!(convert_json_line_to_log_line(&value), Ok(None));
    }

    #[test]
    fn convert_session_line_returns_err_when_uuid_missing() {
        let value = json!({
            "type": "user",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "message": { "role": "user", "content": "hello" }
        });
        let line: SessionLine = serde_json::from_value(value).unwrap();

        let result = convert_session_line(line);

        assert_eq!(result, Err(LogLineConversionError::MissingUuid));
    }

    #[test]
    fn convert_session_line_returns_err_when_timestamp_missing() {
        let value = json!({
            "type": "user",
            "uuid": "u9",
            "message": { "role": "user", "content": "hello" }
        });
        let line: SessionLine = serde_json::from_value(value).unwrap();

        let result = convert_session_line(line);

        assert_eq!(
            result,
            Err(LogLineConversionError::MissingOrInvalidTimestamp)
        );
    }

    #[test]
    fn convert_session_line_returns_err_when_timestamp_is_not_valid_iso8601() {
        let value = json!({
            "type": "user",
            "uuid": "u10",
            "timestamp": "not-a-timestamp",
            "message": { "role": "user", "content": "hello" }
        });
        let line: SessionLine = serde_json::from_value(value).unwrap();

        let result = convert_session_line(line);

        assert_eq!(
            result,
            Err(LogLineConversionError::MissingOrInvalidTimestamp)
        );
    }
}
