#[derive(Debug, Clone)]
pub struct Project {
    pub name: String,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone)]
pub struct Message {
    pub role: Role,
    pub text: String,
    pub timestamp: String,
}

pub fn sort_projects_by_recency(projects: &mut [Project]) {
    projects.sort_by_key(|p| std::cmp::Reverse(p.updated_at_ms));
}

fn message_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

/// 1行分のJSONLエントリから、会話として表示すべきメッセージを取り出す。
/// thinking / tool_use / tool_result などの内部情報は読み飛ばす。
pub fn extract_message(value: &serde_json::Value) -> Option<Message> {
    let entry_type = value.get("type").and_then(|t| t.as_str())?;
    let role = match entry_type {
        "user" => Role::User,
        "assistant" => Role::Assistant,
        _ => return None,
    };

    let content = value.get("message")?.get("content")?;
    let text = message_text(content);
    if text.trim().is_empty() {
        return None;
    }

    let timestamp = value
        .get("timestamp")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    Some(Message {
        role,
        text,
        timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sort_projects_by_recency_orders_newest_first() {
        let mut projects = vec![
            Project {
                name: "old".to_string(),
                updated_at_ms: 1,
            },
            Project {
                name: "new".to_string(),
                updated_at_ms: 3,
            },
            Project {
                name: "mid".to_string(),
                updated_at_ms: 2,
            },
        ];

        sort_projects_by_recency(&mut projects);

        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["new", "mid", "old"]);
    }

    #[test]
    fn extract_message_reads_string_content() {
        let value = json!({
            "type": "user",
            "timestamp": "2026-01-01T00:00:00Z",
            "message": { "content": "hello" }
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
                "content": [
                    { "type": "thinking", "thinking": "internal reasoning" },
                    { "type": "text", "text": "first" },
                    { "type": "tool_use", "name": "some_tool" },
                    { "type": "text", "text": "second" }
                ]
            }
        });

        let message = extract_message(&value).expect("should extract message");
        assert_eq!(message.role, Role::Assistant);
        assert_eq!(message.text, "first\n\nsecond");
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
                "content": [
                    { "type": "tool_use", "name": "some_tool" }
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
}
