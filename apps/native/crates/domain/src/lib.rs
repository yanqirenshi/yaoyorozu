mod session_line;

/// セッションログ(`.jsonl`)1行分の型付きデシリアライズ(issue #39)。
/// `extract_message`/`extract_cwd`/`extract_session_id`/`extract_custom_title`
/// は挙動を変えないリファクタリングとして既存の呼び出し元(infra)から
/// そのまま使えるよう、モジュール名を介さずクレート直下に再エクスポートする。
pub use session_line::{
    extract_custom_title, extract_cwd, extract_message, extract_session_id, AssistantLine,
    AttachmentLine, ChainLineBase, SessionLine, SystemLevel, UserLine,
};

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

/// セッション一覧(ビューア左ペイン)表示用の1件分。全メッセージを読まずに
/// 一覧を出すための最小限の情報。`is_latest` はそのフォルダ内で最終更新が
/// 最も新しいセッションかどうか(`--continue` で送信できるのはこれだけ。
/// issue #33)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub modified_at_ms: u64,
    pub is_latest: bool,
}

pub fn sort_projects_by_recency(projects: &mut [Project]) {
    projects.sort_by_key(|p| std::cmp::Reverse(p.updated_at_ms));
}

/// セッション一覧を最終更新の新しい順に並べ、最初の要素(そのフォルダの
/// 最新セッション)にだけ `is_latest` を立てる(他は `false` にする)。
pub fn sort_sessions_by_recency(sessions: &mut [SessionSummary]) {
    sessions.sort_by_key(|s| std::cmp::Reverse(s.modified_at_ms));
    for (i, s) in sessions.iter_mut().enumerate() {
        s.is_latest = i == 0;
    }
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

/// セッションのタイトルを決める。優先順位: 最後の `custom-title`(空文字は
/// 無視)→ 先頭のユーザーメッセージの冒頭(40文字程度に省略)→
/// セッションIDの先頭8桁(issue #33)。
pub fn resolve_session_title(
    last_custom_title: Option<&str>,
    first_user_message: Option<&str>,
    session_id: &str,
) -> String {
    if let Some(title) = last_custom_title {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(text) = first_user_message {
        let trimmed = excerpt(text, 40);
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    session_id.chars().take(8).collect()
}

/// `session_id` がファイルパスの構築に使って安全な形式(英数字とハイフンのみ)
/// かを検証する。フロントから受け取った値をそのままパスに使わないための
/// 入力検証(native.md §4。`<フォルダ>/<id>.jsonl` 以外を指せないようにする)。
pub fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
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

/// `~/.claude/settings.json` の内容。`modified_at_ms` はアプリ外での変更を
/// 検知する楽観ロックに使う(issue #53)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeSettingsFile {
    pub content: String,
    pub modified_at_ms: u64,
}

/// `content` が構文的に妥当なJSONかを判定する純粋関数。保存前のチェックに
/// 使う(Claude Code本体が読めない壊れたJSONを書き込んでしまう事故の防止。
/// issue #53)。整形は行わない(ユーザーの書式をそのまま保存するため、この
/// 関数はパース可否のみを見る)。
pub fn is_valid_json(content: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(content).is_ok()
}

/// GitHub Projects(v2) アイテムの種別(ビューアの「GitHub Project」タブ表示に
/// 使う。issue #34)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectItemKind {
    Issue,
    PullRequest,
    DraftIssue,
}

/// GitHub Projects(v2)の1アイテム。`repository`/`number`/`url` は
/// `DraftIssue`(プロジェクト内下書き。実体のIssue/PRを持たない)には
/// 存在しないため `None` になる。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectItem {
    /// `ProjectV2Item` のノードID。Status変更mutationの `itemId` に使う
    /// (issue #50)。
    pub id: String,
    pub title: String,
    pub kind: ProjectItemKind,
    pub repository: Option<String>,
    pub number: Option<u32>,
    pub assignees: Vec<String>,
    /// Status フィールドの値(表示名)。未設定のアイテムは `None`。
    pub status: Option<String>,
    /// ブラウザで開くURL(`DraftIssue` には無い)。
    pub url: Option<String>,
}

/// GitHub Projects(v2)のStatusフィールドの選択肢。かんばんのカラム定義に
/// 使うほか、`id` はStatus変更mutationの `optionId` に使う(issue #50)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectStatusOption {
    pub id: String,
    pub name: String,
}

/// `list_project_items` の1ページ分。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectItemsPage {
    /// `ProjectV2` のノードID。Status変更mutationの `projectId` に使う。
    pub project_id: String,
    /// Statusフィールドのノード ID。Status変更mutationの `fieldId` に使う。
    /// プロジェクトにStatusフィールドが無い場合は `None`(かんばんの
    /// カラム操作はできない)。
    pub status_field_id: Option<String>,
    pub items: Vec<ProjectItem>,
    pub next_cursor: Option<String>,
    /// Status フィールドの選択肢(id + 表示名)。かんばんのカラム順に使う。
    pub status_options: Vec<ProjectStatusOption>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_valid_json_accepts_valid_json() {
        assert!(is_valid_json(r#"{"key": "value"}"#));
    }

    #[test]
    fn is_valid_json_rejects_malformed_json() {
        assert!(!is_valid_json(r#"{"key": "value""#));
    }

    #[test]
    fn is_valid_json_rejects_empty_string() {
        assert!(!is_valid_json(""));
    }

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

    fn session_summary(id: &str, modified_at_ms: u64) -> SessionSummary {
        SessionSummary {
            id: id.to_string(),
            title: "title".to_string(),
            modified_at_ms,
            is_latest: false,
        }
    }

    #[test]
    fn sort_sessions_by_recency_orders_newest_first_and_marks_latest() {
        let mut sessions = vec![
            session_summary("old", 1),
            session_summary("new", 3),
            session_summary("mid", 2),
        ];

        sort_sessions_by_recency(&mut sessions);

        let ids: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
        assert!(sessions[0].is_latest);
        assert!(!sessions[1].is_latest);
        assert!(!sessions[2].is_latest);
    }

    #[test]
    fn excerpt_returns_trimmed_text_when_within_limit() {
        assert_eq!(excerpt("  hello  ", 10), "hello");
    }

    #[test]
    fn excerpt_truncates_and_appends_ellipsis_when_over_limit() {
        assert_eq!(excerpt("hello world", 5), "hello…");
    }

    #[test]
    fn resolve_session_title_prefers_custom_title() {
        let title = resolve_session_title(Some("会話タイトル"), Some("hello"), "abcdef01-…");
        assert_eq!(title, "会話タイトル");
    }

    #[test]
    fn resolve_session_title_ignores_blank_custom_title() {
        let title = resolve_session_title(Some("   "), Some("hello"), "abcdef01-…");
        assert_eq!(title, "hello");
    }

    #[test]
    fn resolve_session_title_falls_back_to_first_user_message_excerpt() {
        let long_text = "a".repeat(60);
        let title = resolve_session_title(None, Some(&long_text), "abcdef01-…");
        assert_eq!(title, format!("{}…", "a".repeat(40)));
    }

    #[test]
    fn resolve_session_title_falls_back_to_session_id_prefix_when_nothing_else() {
        let title = resolve_session_title(None, None, "abcdef0123456789");
        assert_eq!(title, "abcdef01");
    }

    #[test]
    fn is_valid_session_id_accepts_uuid_shaped_strings() {
        assert!(is_valid_session_id("a36bcf64-6d83-4043-a1e5-e9eecd3bba80"));
    }

    #[test]
    fn is_valid_session_id_rejects_empty_string() {
        assert!(!is_valid_session_id(""));
    }

    #[test]
    fn is_valid_session_id_rejects_path_traversal_attempts() {
        for bad in ["../../etc/passwd", "a/b", "a\\b", "a.jsonl", "a b"] {
            assert!(!is_valid_session_id(bad), "should reject {bad:?}");
        }
    }
}
