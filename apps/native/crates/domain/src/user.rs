use crate::{GitRepository, ParsedSession, Session, SessionFile};
use std::collections::HashMap;

/// クラス図の `User`(issue #182)。PC上のOSユーザーアカウント。`Pc` に
/// コンポジションで所有される(`Pc.users`)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    /// 個体指定子。OSのユーザー名(PCの中で一意)。
    pub user_id: String,
    pub user_name: String,
    pub home_directory: std::path::PathBuf,
    /// コンポジション(クラス図の `repositories`。0..*。issue #189)。
    /// 真実の源は settings のプロファイルであり、`ExecutionEnvironmentSource`
    /// はこれを知らないため常に空で組み立てる。`app::current_pc_with_repositories`
    /// が settings から都度組み立てて差し込む。
    pub repositories: Vec<GitRepository>,
    /// コンポジション(クラス図の `sessions`。0..*。オブジェクトモデル実装
    /// 第4弾。issue #197)。真実の源はセッションログ(`.jsonl`)であり、
    /// `ExecutionEnvironmentSource`はこれを知らないため常に空で組み立てる。
    /// `GitLedger`(第3弾)と同様、gitコマンドほどではないがjsonl走査コストが
    /// あるため、クエリのたびには再構築せず起動時・ハブ再読み込み時に
    /// `AppState`へ組み立てて保持する。
    pub sessions: Vec<Session>,
}

impl User {
    /// クラス図の`User.load_sessions`メソッド(オブジェクトモデル実装
    /// 第5弾。issue #208)。`parsed`( port が読み取り済みの走査結果。
    /// ファイルI/O・jsonlのパース自体はこのメソッドの責務ではない)から
    /// `Session`・`SessionFile`を組み立てて`self.sessions`に格納する。
    ///
    /// `LogLine`は遅延読み込みのため組み立てない(`SessionFile.lines`は
    /// 常に空で構築する。セッションを開いたときに別途構築する)。この
    /// メソッド自体はI/Oを伴わない純粋な変換のため、`AppState`が保持する
    /// `parsed`が更新されない限り(=ファイル走査は起動時・ハブ再読み込み時
    /// のみ)、クエリのたびに呼び出しても実質的な再走査は発生しない。
    ///
    /// 同じ`session_id`の`ParsedSession`が複数あれば(worktree移動により
    /// 同じセッションIDのjsonlが複数フォルダにできるケース。issue #214)、
    /// 1つの`Session`に集約する(issue #217)。属性(custom_title/ai_title/
    /// mode/slug/last_prompt)は`modified_at_ms`の古い順に見て、値がある
    /// (`Some`)ものが見つかるたび上書きする(`None`では上書きしない)。
    /// 結果として最新ファイルの値が勝ち、そのファイルに無い属性は古い方から
    /// 補完される。`conversation_files`の並びも同じく更新時刻の古い順(時系列)。
    /// `subagent_files`は各`ParsedSession`の分をこの順で連結する。
    pub fn load_sessions(&mut self, mut parsed: Vec<ParsedSession>) {
        parsed.sort_by_key(|p| p.modified_at_ms);

        // グループ化した順序(＝各session_idが最初に現れた順。modified_at_ms
        // 昇順で走査するため、決定的な順序になる)を別途保持する。
        // `HashMap`のイテレーション順は不定なため、`self.sessions`の並びを
        // 安定させるために必要。
        let mut order: Vec<String> = Vec::new();
        let mut groups: HashMap<String, Vec<ParsedSession>> = HashMap::new();
        for p in parsed {
            groups
                .entry(p.session_id.clone())
                .or_insert_with(|| {
                    order.push(p.session_id.clone());
                    Vec::new()
                })
                .push(p);
        }

        self.sessions = order
            .into_iter()
            .map(|session_id| {
                let group = groups
                    .remove(&session_id)
                    .expect("orderに積んだsession_idは必ずgroupsに存在する");
                aggregate_session(session_id, group)
            })
            .collect();
    }
}

/// 同じ`session_id`を持つ`ParsedSession`群(`modified_at_ms`昇順)を1つの
/// `Session`に集約する(issue #217)。集約規則のドキュメントは
/// `User::load_sessions`参照。
fn aggregate_session(session_id: String, group: Vec<ParsedSession>) -> Session {
    let mut custom_title = None;
    let mut ai_title = None;
    let mut mode = None;
    let mut slug = None;
    let mut last_prompt = None;
    let mut conversation_files = Vec::with_capacity(group.len());
    let mut subagent_files = Vec::new();

    for p in group {
        if p.custom_title.is_some() {
            custom_title = p.custom_title;
        }
        if p.ai_title.is_some() {
            ai_title = p.ai_title;
        }
        if p.mode.is_some() {
            mode = p.mode;
        }
        if p.slug.is_some() {
            slug = p.slug;
        }
        if p.last_prompt.is_some() {
            last_prompt = p.last_prompt;
        }
        conversation_files.push(SessionFile {
            file_path: p.conversation_file_path,
            lines: Vec::new(),
        });
        subagent_files.extend(
            p.subagent_file_paths
                .into_iter()
                .map(|file_path| SessionFile {
                    file_path,
                    lines: Vec::new(),
                }),
        );
    }

    Session {
        session_id,
        custom_title,
        ai_title,
        mode,
        slug,
        last_prompt,
        conversation_files,
        subagent_files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn empty_user() -> User {
        User {
            user_id: "yanqi".to_string(),
            user_name: "yanqi".to_string(),
            home_directory: PathBuf::from(r"C:\Users\yanqi"),
            repositories: Vec::new(),
            sessions: Vec::new(),
        }
    }

    fn parsed(session_id: &str, conversation_file: &str, modified_at_ms: u64) -> ParsedSession {
        ParsedSession {
            session_id: session_id.to_string(),
            custom_title: None,
            ai_title: None,
            mode: None,
            slug: None,
            last_prompt: None,
            conversation_file_path: PathBuf::from(conversation_file),
            subagent_file_paths: Vec::new(),
            modified_at_ms,
        }
    }

    #[test]
    fn load_sessions_builds_session_and_conversation_file_with_no_lines() {
        let mut user = empty_user();
        let mut p = parsed("s1", r"C:\proj\s1.jsonl", 100);
        p.custom_title = Some("タイトル".to_string());
        let parsed = vec![p];

        user.load_sessions(parsed);

        assert_eq!(user.sessions.len(), 1);
        assert_eq!(user.sessions[0].session_id, "s1");
        assert_eq!(user.sessions[0].custom_title.as_deref(), Some("タイトル"));
        assert_eq!(user.sessions[0].conversation_files.len(), 1);
        assert_eq!(
            user.sessions[0].conversation_files[0].file_path,
            PathBuf::from(r"C:\proj\s1.jsonl")
        );
        assert!(
            user.sessions[0].conversation_files[0].lines.is_empty(),
            "行は遅延読み込みのため常に空"
        );
        assert!(user.sessions[0].subagent_files.is_empty());
    }

    #[test]
    fn load_sessions_builds_subagent_files_from_paths() {
        let mut user = empty_user();
        let mut p = parsed("s1", r"C:\proj\s1.jsonl", 100);
        p.subagent_file_paths = vec![
            PathBuf::from(r"C:\proj\s1\subagents\agent-a.jsonl"),
            PathBuf::from(r"C:\proj\s1\subagents\agent-b.jsonl"),
        ];

        user.load_sessions(vec![p]);

        let subagent_paths: Vec<&PathBuf> = user.sessions[0]
            .subagent_files
            .iter()
            .map(|f| &f.file_path)
            .collect();
        assert_eq!(
            subagent_paths,
            vec![
                &PathBuf::from(r"C:\proj\s1\subagents\agent-a.jsonl"),
                &PathBuf::from(r"C:\proj\s1\subagents\agent-b.jsonl"),
            ]
        );
        assert!(user.sessions[0]
            .subagent_files
            .iter()
            .all(|f| f.lines.is_empty()));
    }

    #[test]
    fn load_sessions_replaces_any_previously_held_sessions() {
        let mut user = empty_user();
        user.load_sessions(vec![parsed("old", r"C:\proj\old.jsonl", 100)]);
        user.load_sessions(vec![parsed("new", r"C:\proj\new.jsonl", 200)]);

        assert_eq!(user.sessions.len(), 1);
        assert_eq!(user.sessions[0].session_id, "new");
    }

    #[test]
    fn load_sessions_aggregates_same_session_id_into_one_session() {
        // worktree移動により同じsession_idのjsonlが2フォルダにできるケース
        // (issue #214)。1つのSessionに集約され、conversation_filesは更新
        // 時刻の古い順に並ぶ(issue #217)。
        let mut user = empty_user();
        let older = parsed("s1", r"C:\proj\s1.jsonl", 100);
        let newer = parsed("s1", r"C:\worktree\s1.jsonl", 200);

        user.load_sessions(vec![newer, older]);

        assert_eq!(user.sessions.len(), 1);
        let conversation_files: Vec<&PathBuf> = user.sessions[0]
            .conversation_files
            .iter()
            .map(|f| &f.file_path)
            .collect();
        assert_eq!(
            conversation_files,
            vec![
                &PathBuf::from(r"C:\proj\s1.jsonl"),
                &PathBuf::from(r"C:\worktree\s1.jsonl"),
            ],
            "modified_at_ms の古い順に並ぶ"
        );
    }

    #[test]
    fn load_sessions_aggregates_attributes_by_overwriting_with_newer_some_values() {
        // 属性は modified_at_ms の古い順に見て、Someが見つかるたび上書き
        // (Noneでは上書きしない)。結果は最新ファイルの値が勝ち、欠けは
        // 古い方から補完される(issue #217)。
        let mut user = empty_user();
        let mut older = parsed("s1", r"C:\proj\s1.jsonl", 100);
        older.custom_title = Some("古いタイトル".to_string());
        older.mode = Some("古いモード".to_string());
        let mut newer = parsed("s1", r"C:\worktree\s1.jsonl", 200);
        newer.custom_title = Some("新しいタイトル".to_string());
        newer.mode = None;

        user.load_sessions(vec![older, newer]);

        assert_eq!(
            user.sessions[0].custom_title.as_deref(),
            Some("新しいタイトル"),
            "新しい方にSomeがあれば上書きされる"
        );
        assert_eq!(
            user.sessions[0].mode.as_deref(),
            Some("古いモード"),
            "新しい方がNoneなら古い方の値で補完される"
        );
    }

    #[test]
    fn load_sessions_aggregates_subagent_files_from_all_grouped_parsed_sessions() {
        let mut user = empty_user();
        let mut older = parsed("s1", r"C:\proj\s1.jsonl", 100);
        older.subagent_file_paths = vec![PathBuf::from(r"C:\proj\s1\subagents\agent-a.jsonl")];
        let mut newer = parsed("s1", r"C:\worktree\s1.jsonl", 200);
        newer.subagent_file_paths = vec![PathBuf::from(r"C:\worktree\s1\subagents\agent-b.jsonl")];

        user.load_sessions(vec![older, newer]);

        let subagent_paths: Vec<&PathBuf> = user.sessions[0]
            .subagent_files
            .iter()
            .map(|f| &f.file_path)
            .collect();
        assert_eq!(
            subagent_paths,
            vec![
                &PathBuf::from(r"C:\proj\s1\subagents\agent-a.jsonl"),
                &PathBuf::from(r"C:\worktree\s1\subagents\agent-b.jsonl"),
            ]
        );
    }
}
