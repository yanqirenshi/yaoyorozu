/// 会話を生成しているエージェントの種類。現時点では Claude Code のみ。
/// 将来 Gemini / Codex 等を追加する際、一覧・会話に「どのエージェントか」を
/// 表示できるよう先んじて用意する(値は当面 `ClaudeCode` のみ)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    ClaudeCode,
}

#[derive(Debug, Clone)]
pub struct Project {
    pub name: String,
    pub updated_at_ms: u64,
    pub agent: AgentKind,
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

/// 1つのセッション(`.jsonl` 1ファイル)。`id` は送信時の一致検証に使う。
#[derive(Debug, Clone)]
pub struct Session {
    pub id: String,
    pub messages: Vec<Message>,
    pub agent: AgentKind,
}

pub fn sort_projects_by_recency(projects: &mut [Project]) {
    projects.sort_by_key(|p| std::cmp::Reverse(p.updated_at_ms));
}

/// 会話ログは記録順(古い順)で保持されるため、表示直前に反転して新しい順にする。
pub fn order_messages_newest_first(messages: &mut [Message]) {
    messages.reverse();
}

/// `messages` から `offset` 件スキップした後、最大 `limit` 件を切り出す。
/// IPC 1回で会話全件を返さないための範囲指定に使う。
pub fn paginate_messages(messages: &[Message], offset: usize, limit: usize) -> Vec<Message> {
    messages.iter().skip(offset).take(limit).cloned().collect()
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

/// 1行分のJSONLエントリから、そのセッションの作業ディレクトリ(cwd)を取り出す。
pub fn extract_cwd(value: &serde_json::Value) -> Option<String> {
    value.get("cwd").and_then(|c| c.as_str()).map(String::from)
}

/// 1行分のJSONLエントリから、そのセッションのID(`sessionId`)を取り出す。
/// 送信前後の一致検証に使う(表示中のセッション ≠ 追記先セッション、を防ぐため)。
pub fn extract_session_id(value: &serde_json::Value) -> Option<String> {
    value
        .get("sessionId")
        .and_then(|s| s.as_str())
        .map(String::from)
}

/// `Settings` の現在のスキーマバージョン。マイグレーションが必要になったら
/// 上げ、infra 側のマイグレーション関数で旧バージョンからの変換を行う。
pub const CURRENT_SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GithubProject {
    pub owner: String,
    pub number: u32,
}

impl GithubProject {
    /// owner が空文字のものは不正な入力とみなす(実在確認はスコープ外)。
    pub fn is_valid(&self) -> bool {
        !self.owner.trim().is_empty()
    }
}

/// アプリの設定。対象リポジトリ(1つ)・GitHubプロジェクト・対象セッションの
/// 3項目を持つ。永続化(JSON)は infra が担う。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    pub version: u32,
    pub repository_path: Option<std::path::PathBuf>,
    pub github_project: Option<GithubProject>,
    pub selected_session_ids: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_SETTINGS_VERSION,
            repository_path: None,
            github_project: None,
            selected_session_ids: Vec::new(),
        }
    }
}

/// `~/.claude/projects/` 配下のプロジェクトディレクトリ名を、リポジトリの
/// 絶対パスから求める。実データで確認したエンコード規則: パス中の英数字
/// (ASCII)以外の文字をすべて `-` に置き換える
/// (例: `C:\Users\yanqi\prj\yaoyorozu` -> `C--Users-yanqi-prj-yaoyorozu`)。
pub fn encode_project_dir_name(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// 1つのセッションの一覧表示用サマリ。全メッセージを読まずに一覧を出すための
/// 最小限の情報(ID・最終更新・先頭メッセージの抜粋)。
#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub id: String,
    pub updated_at_ms: u64,
    pub excerpt: String,
}

/// 表示用に文字列を切り詰める。長い本文を一覧にそのまま出さないため。
pub fn excerpt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(max_chars).collect();
        format!("{truncated}…")
    }
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
                agent: AgentKind::ClaudeCode,
            },
            Project {
                name: "new".to_string(),
                updated_at_ms: 3,
                agent: AgentKind::ClaudeCode,
            },
            Project {
                name: "mid".to_string(),
                updated_at_ms: 2,
                agent: AgentKind::ClaudeCode,
            },
        ];

        sort_projects_by_recency(&mut projects);

        let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["new", "mid", "old"]);
    }

    #[test]
    fn order_messages_newest_first_reverses_record_order() {
        let mut messages = vec![
            Message {
                role: Role::User,
                text: "first".to_string(),
                timestamp: "1".to_string(),
            },
            Message {
                role: Role::Assistant,
                text: "second".to_string(),
                timestamp: "2".to_string(),
            },
        ];

        order_messages_newest_first(&mut messages);

        let texts: Vec<&str> = messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["second", "first"]);
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

    #[test]
    fn extract_cwd_reads_field_when_present() {
        let value = json!({ "cwd": "C:\\Users\\yanqi\\prj\\yaoyorozu" });
        assert_eq!(
            extract_cwd(&value).as_deref(),
            Some("C:\\Users\\yanqi\\prj\\yaoyorozu")
        );
    }

    #[test]
    fn extract_cwd_returns_none_when_missing() {
        let value = json!({ "type": "user" });
        assert!(extract_cwd(&value).is_none());
    }

    #[test]
    fn extract_session_id_reads_field_when_present() {
        let value = json!({ "sessionId": "a36bcf64-6d83-4043-a1e5-e9eecd3bba80" });
        assert_eq!(
            extract_session_id(&value).as_deref(),
            Some("a36bcf64-6d83-4043-a1e5-e9eecd3bba80")
        );
    }

    #[test]
    fn extract_session_id_returns_none_when_missing() {
        let value = json!({ "type": "user" });
        assert!(extract_session_id(&value).is_none());
    }

    fn message(text: &str) -> Message {
        Message {
            role: Role::User,
            text: text.to_string(),
            timestamp: String::new(),
        }
    }

    #[test]
    fn paginate_messages_slices_by_offset_and_limit() {
        let messages = vec![message("a"), message("b"), message("c"), message("d")];

        let page = paginate_messages(&messages, 1, 2);

        let texts: Vec<&str> = page.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["b", "c"]);
    }

    #[test]
    fn paginate_messages_returns_empty_when_offset_exceeds_length() {
        let messages = vec![message("a")];
        assert!(paginate_messages(&messages, 5, 10).is_empty());
    }

    #[test]
    fn paginate_messages_returns_remaining_when_limit_exceeds_length() {
        let messages = vec![message("a"), message("b")];
        let page = paginate_messages(&messages, 0, 10);
        assert_eq!(page.len(), 2);
    }

    #[test]
    fn settings_default_has_current_version_and_empty_fields() {
        let settings = Settings::default();
        assert_eq!(settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.repository_path, None);
        assert_eq!(settings.github_project, None);
        assert!(settings.selected_session_ids.is_empty());
    }

    #[test]
    fn github_project_is_valid_rejects_blank_owner() {
        let project = GithubProject {
            owner: "   ".to_string(),
            number: 1,
        };
        assert!(!project.is_valid());
    }

    #[test]
    fn github_project_is_valid_accepts_non_blank_owner() {
        let project = GithubProject {
            owner: "yanqirenshi".to_string(),
            number: 51,
        };
        assert!(project.is_valid());
    }

    #[test]
    fn encode_project_dir_name_matches_observed_claude_code_encoding() {
        // 実データで確認した実例(このリポジトリ自身の ~/.claude/projects/ 配下)。
        assert_eq!(
            encode_project_dir_name(r"C:\Users\yanqi\prj\yaoyorozu"),
            "C--Users-yanqi-prj-yaoyorozu"
        );
    }

    #[test]
    fn encode_project_dir_name_replaces_each_non_alphanumeric_char_individually() {
        // "\.claude\" のように非英数字が連続する場合、まとめず1文字ずつ置き換える
        // (実データ: ".../Spinor/.claude/worktrees/..." -> "...-Spinor--claude-worktrees-...")。
        assert_eq!(
            encode_project_dir_name(r"Spinor\.claude\worktrees"),
            "Spinor--claude-worktrees"
        );
    }

    #[test]
    fn excerpt_returns_trimmed_text_when_within_limit() {
        assert_eq!(excerpt("  hello  ", 10), "hello");
    }

    #[test]
    fn excerpt_truncates_and_appends_ellipsis_when_over_limit() {
        assert_eq!(excerpt("hello world", 5), "hello…");
    }
}
