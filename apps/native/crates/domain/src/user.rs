use crate::{GitRepository, ParsedSession, Session, SessionFile};

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
    pub fn load_sessions(&mut self, parsed: Vec<ParsedSession>) {
        self.sessions = parsed
            .into_iter()
            .map(|p| Session {
                session_id: p.session_id,
                custom_title: p.custom_title,
                ai_title: p.ai_title,
                mode: p.mode,
                slug: p.slug,
                last_prompt: p.last_prompt,
                conversation_file: SessionFile {
                    file_path: p.conversation_file_path,
                    lines: Vec::new(),
                },
                subagent_files: p
                    .subagent_file_paths
                    .into_iter()
                    .map(|file_path| SessionFile {
                        file_path,
                        lines: Vec::new(),
                    })
                    .collect(),
            })
            .collect();
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

    #[test]
    fn load_sessions_builds_session_and_conversation_file_with_no_lines() {
        let mut user = empty_user();
        let parsed = vec![ParsedSession {
            session_id: "s1".to_string(),
            custom_title: Some("タイトル".to_string()),
            ai_title: None,
            mode: None,
            slug: None,
            last_prompt: None,
            conversation_file_path: PathBuf::from(r"C:\proj\s1.jsonl"),
            subagent_file_paths: Vec::new(),
        }];

        user.load_sessions(parsed);

        assert_eq!(user.sessions.len(), 1);
        assert_eq!(user.sessions[0].session_id, "s1");
        assert_eq!(user.sessions[0].custom_title.as_deref(), Some("タイトル"));
        assert_eq!(
            user.sessions[0].conversation_file.file_path,
            PathBuf::from(r"C:\proj\s1.jsonl")
        );
        assert!(
            user.sessions[0].conversation_file.lines.is_empty(),
            "行は遅延読み込みのため常に空"
        );
        assert!(user.sessions[0].subagent_files.is_empty());
    }

    #[test]
    fn load_sessions_builds_subagent_files_from_paths() {
        let mut user = empty_user();
        let parsed = vec![ParsedSession {
            session_id: "s1".to_string(),
            custom_title: None,
            ai_title: None,
            mode: None,
            slug: None,
            last_prompt: None,
            conversation_file_path: PathBuf::from(r"C:\proj\s1.jsonl"),
            subagent_file_paths: vec![
                PathBuf::from(r"C:\proj\s1\subagents\agent-a.jsonl"),
                PathBuf::from(r"C:\proj\s1\subagents\agent-b.jsonl"),
            ],
        }];

        user.load_sessions(parsed);

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
        user.load_sessions(vec![ParsedSession {
            session_id: "old".to_string(),
            custom_title: None,
            ai_title: None,
            mode: None,
            slug: None,
            last_prompt: None,
            conversation_file_path: PathBuf::from(r"C:\proj\old.jsonl"),
            subagent_file_paths: Vec::new(),
        }]);

        user.load_sessions(vec![ParsedSession {
            session_id: "new".to_string(),
            custom_title: None,
            ai_title: None,
            mode: None,
            slug: None,
            last_prompt: None,
            conversation_file_path: PathBuf::from(r"C:\proj\new.jsonl"),
            subagent_file_paths: Vec::new(),
        }]);

        assert_eq!(user.sessions.len(), 1);
        assert_eq!(user.sessions[0].session_id, "new");
    }
}
