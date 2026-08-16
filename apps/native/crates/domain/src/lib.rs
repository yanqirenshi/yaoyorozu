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
/// v1 -> v2: `claude_projects_dir` を追加(issue #25)。
/// v2 -> v3: `selected_session_ids`(セッションID配列)を
/// `selected_project_folders`(フォルダ名配列)に置き換え。
pub const CURRENT_SETTINGS_VERSION: u32 = 3;

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

/// アプリの設定。対象リポジトリ(1つ)・GitHubプロジェクト・対象フォルダ・
/// セッション一覧のルートディレクトリの4項目を持つ。永続化(JSON)は infra
/// が担う。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    pub version: u32,
    pub repository_path: Option<std::path::PathBuf>,
    pub github_project: Option<GithubProject>,
    /// `~/.claude/projects/` 配下のフォルダ名のうち、対象として選んだもの
    /// (複数可)。`#[serde(default)]` は v1/v2 のJSON(このフィールドを
    /// 持たない、または旧フィールド名 `selected_session_ids` を持つ)を
    /// 読めるようにするため(v2からの移行では旧値は破棄される)。
    #[serde(default)]
    pub selected_project_folders: Vec<String>,
    /// セッション一覧が読むルートディレクトリ。`None` の場合は既定
    /// (`~/.claude/projects/`)を使う。`#[serde(default)]` は v1 のJSON
    /// (このフィールドを持たない)を読めるようにするため。
    #[serde(default)]
    pub claude_projects_dir: Option<std::path::PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_SETTINGS_VERSION,
            repository_path: None,
            github_project: None,
            selected_project_folders: Vec::new(),
            claude_projects_dir: None,
        }
    }
}

/// セッション一覧の有効なルートディレクトリを決める。設定で明示的に
/// 指定されていればそれを、なければ `default`(呼び出し側が解決した
/// `~/.claude/projects/` 等)を使う。
pub fn effective_projects_dir(
    configured: Option<&std::path::Path>,
    default: &std::path::Path,
) -> std::path::PathBuf {
    configured
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| default.to_path_buf())
}

/// GitHub Projects(v2)の一覧表示用サマリ(設定画面のプロジェクト選択に使う)。
/// 永続化される `GithubProject`(owner + number)とは異なり、選択肢一覧の
/// 表示にのみ使う値。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubProjectSummary {
    pub number: u32,
    pub title: String,
    pub closed: bool,
}

/// リポジトリ直下(または作業ディレクトリ直下)の `CLAUDE.md` の内容。
/// `modified_at_ms` はアプリ外での変更を検知する楽観ロックに使う
/// (issue #27)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeMdFile {
    pub content: String,
    pub modified_at_ms: u64,
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
        assert!(settings.selected_project_folders.is_empty());
        assert_eq!(settings.claude_projects_dir, None);
    }

    #[test]
    fn effective_projects_dir_uses_configured_value_when_present() {
        let configured = std::path::Path::new(r"D:\custom\projects");
        let default = std::path::Path::new(r"C:\Users\yanqi\.claude\projects");
        assert_eq!(
            effective_projects_dir(Some(configured), default),
            configured.to_path_buf()
        );
    }

    #[test]
    fn effective_projects_dir_falls_back_to_default_when_unset() {
        let default = std::path::Path::new(r"C:\Users\yanqi\.claude\projects");
        assert_eq!(effective_projects_dir(None, default), default.to_path_buf());
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
}
