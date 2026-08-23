use app::{AppError, SessionSource};
use domain::{
    extract_custom_title, extract_cwd, extract_message, extract_session_id, resolve_session_title,
    AgentKind, Project, Role, Session, SessionSummary,
};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};

/// ファイル変更をイベントとして通知するまでのデバウンス時間。
/// 短時間の連続書き込み(1メッセージ分の追記等)をまとめて1回の通知にする。
const WATCH_DEBOUNCE: Duration = Duration::from_millis(400);

/// `watch_projects` の戻り値。tauri層がこの型を名指しで保持できるよう
/// (`notify`/`notify-debouncer-full` の型をそのまま公開する代わりに)
/// エイリアスとして公開する。
pub type SessionWatcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// `~/.claude/projects/` 配下のセッションログ(JSONL)を読み取る `SessionSource` 実装。
pub struct FileSystemRepository {
    projects_dir: PathBuf,
}

impl FileSystemRepository {
    pub fn new(projects_dir: PathBuf) -> Self {
        Self { projects_dir }
    }

    /// 設定で明示的な指定がない場合に使う既定のルート(`~/.claude/projects/`)。
    pub fn default_projects_dir() -> Result<PathBuf, AppError> {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map(PathBuf::from)
            .map_err(|_| AppError::Io("ホームディレクトリが見つかりません".to_string()))?;
        Ok(home.join(".claude").join("projects"))
    }

    /// プロジェクトディレクトリ配下の変更を監視し、変更のあったプロジェクト
    /// (直下のフォルダ名)を `on_change` に通知する。
    ///
    /// 戻り値の `Debouncer` を drop すると監視が止まるため、呼び出し側は
    /// 監視を続けたい間、値を保持し続ける必要がある(呼び出し元の tauri 層で
    /// アプリの状態として保持する想定)。
    pub fn watch_projects<F>(&self, on_change: F) -> Result<SessionWatcher, AppError>
    where
        F: Fn(String) + Send + 'static,
    {
        let watch_root = self.projects_dir.clone();
        let mut debouncer =
            new_debouncer(WATCH_DEBOUNCE, None, move |result: DebounceEventResult| {
                let Ok(events) = result else { return };
                let mut notified = HashSet::new();
                for event in events {
                    for path in &event.paths {
                        if let Some(project) = project_name_from_path(&watch_root, path) {
                            if notified.insert(project.clone()) {
                                on_change(project);
                            }
                        }
                    }
                }
            })
            .map_err(|e| AppError::Io(format!("ファイル監視の初期化に失敗しました: {e}")))?;

        debouncer
            .watch(&self.projects_dir, RecursiveMode::Recursive)
            .map_err(|e| {
                AppError::Io(format!(
                    "{} の監視開始に失敗しました: {e}",
                    self.projects_dir.display()
                ))
            })?;

        Ok(debouncer)
    }
}

/// `path` が `projects_dir` 配下のとき、直下のプロジェクトフォルダ名を返す。
fn project_name_from_path(projects_dir: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(projects_dir).ok()?;
    relative
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
}

fn to_millis(time: std::io::Result<std::time::SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// ディレクトリ直下(サブディレクトリは見ない)の *.jsonl を、
/// 最終更新が新しい順に並べて返す。
fn session_files_by_recency(project_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(project_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .collect();
    files.sort_by_key(|path| {
        std::cmp::Reverse(to_millis(fs::metadata(path).and_then(|m| m.modified())))
    });
    files
}

/// ディレクトリ直下の *.jsonl のうち、最終更新が最も新しいものを返す。
fn latest_session_file(project_dir: &Path) -> Option<PathBuf> {
    session_files_by_recency(project_dir).into_iter().next()
}

/// 最新セッションファイルに記録されている、セッション開始時点の作業ディレクトリ(cwd)を返す。
/// `claude` はカレントディレクトリ配下のプロジェクトとしてセッションを保存するため、
/// 元の会話と同じプロジェクトに新規セッションを作るには同じ cwd で起動する必要がある。
/// セッション途中で(Bash の cd 等により)cwd が変わることがあるため、
/// 最後の値ではなく最初に記録された値(＝プロジェクトのルート)を使う。
fn resolve_session_cwd(project_dir: &Path) -> Result<PathBuf, AppError> {
    let path = latest_session_file(project_dir)
        .ok_or_else(|| AppError::NotFound("セッションが見つかりません".to_string()))?;

    let file = fs::File::open(&path)
        .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

    let cwd = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .find_map(|value| extract_cwd(&value))
        .ok_or_else(|| {
            AppError::Io("セッションの作業ディレクトリを取得できませんでした".to_string())
        })?;

    Ok(PathBuf::from(cwd))
}

/// 最新セッションファイルのID(`sessionId`)を、ファイル全体を読まずに求める。
/// `sessionId` は通常どの行にも記録されているため、最初の1行で見つかる
/// (`find_map` が短絡評価するので、送信前後の軽量チェックに使える)。
fn latest_session_id_in_dir(project_dir: &Path) -> Result<String, AppError> {
    let path = latest_session_file(project_dir)
        .ok_or_else(|| AppError::NotFound("セッションが見つかりません".to_string()))?;

    let file = fs::File::open(&path)
        .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .find_map(|value| extract_session_id(&value))
        .ok_or_else(|| AppError::Io("セッションIDを取得できませんでした".to_string()))
}

impl SessionSource for FileSystemRepository {
    fn list_projects(&self) -> Result<Vec<Project>, AppError> {
        let entries = fs::read_dir(&self.projects_dir).map_err(|e| {
            AppError::Io(format!(
                "{} の読み込みに失敗しました: {}",
                self.projects_dir.display(),
                e
            ))
        })?;

        let projects = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .filter_map(|path| {
                let name = path.file_name()?.to_str()?.to_string();
                let updated_at_ms = latest_session_file(&path)
                    .map(|f| to_millis(fs::metadata(&f).and_then(|m| m.modified())))
                    .unwrap_or_else(|| to_millis(fs::metadata(&path).and_then(|m| m.modified())));
                Some(Project {
                    name,
                    updated_at_ms,
                    agent: AgentKind::ClaudeCode,
                })
            })
            .collect();

        Ok(projects)
    }

    fn session(&self, project: &str, session_id: &str) -> Result<Session, AppError> {
        // `session_id` は app 層の `is_valid_session_id` で英数字とハイフンのみに
        // 検証済みの前提(native.md §4)。ここでは検証済みの値としてそのまま
        // ファイル名の構築に使う。
        let path = self
            .projects_dir
            .join(project)
            .join(format!("{session_id}.jsonl"));
        let file = fs::File::open(&path)
            .map_err(|e| AppError::NotFound(format!("{} が見つかりません: {e}", path.display())))?;

        let messages = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
            .filter_map(|value| extract_message(&value))
            .collect();

        Ok(Session {
            id: session_id.to_string(),
            messages,
            agent: AgentKind::ClaudeCode,
        })
    }

    fn latest_session_id(&self, project: &str) -> Result<String, AppError> {
        latest_session_id_in_dir(&self.projects_dir.join(project))
    }

    fn latest_session_cwd(&self, project: &str) -> Result<PathBuf, AppError> {
        resolve_session_cwd(&self.projects_dir.join(project))
    }

    fn list_sessions(&self, project: &str) -> Result<Vec<SessionSummary>, AppError> {
        let project_dir = self.projects_dir.join(project);
        session_files_by_recency(&project_dir)
            .iter()
            .map(|path| {
                let modified_at_ms = to_millis(fs::metadata(path).and_then(|m| m.modified()));
                let (id, title) = cached_or_scanned_summary(path, modified_at_ms)?;
                Ok(SessionSummary {
                    id,
                    title,
                    modified_at_ms,
                    // `is_latest` はフォルダ内での相対比較が必要なため、
                    // ここでは決められない(app::list_sessions が
                    // `sort_sessions_by_recency` で確定させる)。
                    is_latest: false,
                })
            })
            .collect()
    }
}

/// `(ファイルパス, mtime)` をキーにしたタイトル抽出結果のキャッシュ。
/// セッションファイルは数MBになりうり、`custom-title` はファイル末尾付近と
/// は限らないため全行走査が必要になる。未変更のファイルを毎回再走査しない
/// ため、プロセス内メモリでキャッシュする(永続化不要。issue #33)。
/// `FileSystemRepository` はコマンド呼び出しごとに使い捨てで生成される
/// (tauri層)ため、インスタンスのフィールドではなくモジュール静的な領域に
/// 置く。
struct CachedSessionSummary {
    modified_at_ms: u64,
    id: String,
    title: String,
}

static SESSION_SUMMARY_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedSessionSummary>>> =
    OnceLock::new();

fn session_summary_cache() -> &'static Mutex<HashMap<PathBuf, CachedSessionSummary>> {
    SESSION_SUMMARY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// キャッシュに `path` の `modified_at_ms` と一致するエントリがあればそれを
/// 返し、無ければファイルを走査してキャッシュに書き込む。
fn cached_or_scanned_summary(
    path: &Path,
    modified_at_ms: u64,
) -> Result<(String, String), AppError> {
    {
        let cache = session_summary_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.get(path) {
            if cached.modified_at_ms == modified_at_ms {
                return Ok((cached.id.clone(), cached.title.clone()));
            }
        }
    }

    let (id, title) = scan_session_summary(path)?;

    let mut cache = session_summary_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(
        path.to_path_buf(),
        CachedSessionSummary {
            modified_at_ms,
            id: id.clone(),
            title: title.clone(),
        },
    );
    Ok((id, title))
}

/// セッションファイルを1行ずつ走査し、ID と表示用タイトルを求める。
/// `custom-title` はファイルのどこにでも出現しうる(リネームのたびに追記)
/// ため、早期終了せず全行を読む。
fn scan_session_summary(path: &Path) -> Result<(String, String), AppError> {
    let file = fs::File::open(path)
        .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

    let mut id: Option<String> = None;
    let mut last_custom_title: Option<String> = None;
    let mut first_user_message: Option<String> = None;

    for value in BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
    {
        if id.is_none() {
            id = extract_session_id(&value);
        }
        if let Some(title) = extract_custom_title(&value) {
            last_custom_title = Some(title);
        }
        if first_user_message.is_none() {
            if let Some(message) = extract_message(&value) {
                if message.role == Role::User {
                    first_user_message = Some(message.text);
                }
            }
        }
    }

    let id = id.ok_or_else(|| AppError::Io("セッションIDを取得できませんでした".to_string()))?;
    let title = resolve_session_title(
        last_custom_title.as_deref(),
        first_user_message.as_deref(),
        &id,
    );
    Ok((id, title))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn write_session_file(dir: &Path, id: &str, cwd: &Path) {
        let mut file = File::create(dir.join(format!("{id}.jsonl"))).unwrap();
        let cwd_escaped = cwd.display().to_string().replace('\\', "\\\\");
        writeln!(
            file,
            r#"{{"type":"user","sessionId":"{id}","cwd":"{cwd_escaped}","message":{{"content":"hello"}}}}"#
        )
        .unwrap();
    }

    #[test]
    fn latest_session_id_in_dir_reads_session_id_from_latest_file() {
        let dir = tempfile::tempdir().unwrap();
        write_session_file(dir.path(), "s1", dir.path());

        let id = latest_session_id_in_dir(dir.path()).expect("should find session id");
        assert_eq!(id, "s1");
    }

    #[test]
    fn filesystem_repository_session_reads_messages_from_specified_id() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);
        write_session_file(&project_dir, "s2", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let session = repo.session("proj", "s1").expect("should read session");

        assert_eq!(session.id, "s1");
        assert_eq!(session.messages.len(), 1);
        assert_eq!(session.messages[0].text, "hello");
    }

    #[test]
    fn filesystem_repository_session_returns_not_found_for_missing_id() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let error = repo
            .session("proj", "does-not-exist")
            .expect_err("should fail for missing session file");

        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn filesystem_repository_latest_session_id_matches_latest_session() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let id = repo.latest_session_id("proj").expect("should get id");

        assert_eq!(id, "s1");
    }

    #[test]
    fn filesystem_repository_latest_session_cwd_reads_recorded_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let cwd = repo.latest_session_cwd("proj").expect("should get cwd");

        assert_eq!(cwd, project_dir);
    }

    #[test]
    fn watch_projects_notifies_project_name_on_new_session_file() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("some-project");
        fs::create_dir_all(&project_dir).unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let (tx, rx) = std::sync::mpsc::channel();
        let _debouncer = repo
            .watch_projects(move |project| {
                let _ = tx.send(project);
            })
            .expect("should start watching");

        fs::write(project_dir.join("s1.jsonl"), b"{}").unwrap();

        let notified = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("should be notified of the change");
        assert_eq!(notified, "some-project");
    }

    #[test]
    fn list_sessions_prefers_the_last_custom_title() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            [
                r#"{"type":"user","sessionId":"s1","message":{"content":"hello"}}"#,
                r#"{"type":"custom-title","customTitle":"最初のタイトル","sessionId":"s1"}"#,
                r#"{"type":"custom-title","customTitle":"最後のタイトル","sessionId":"s1"}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo.list_sessions("proj").expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "s1");
        assert_eq!(sessions[0].title, "最後のタイトル");
    }

    #[test]
    fn list_sessions_falls_back_to_first_user_message_when_no_custom_title() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo.list_sessions("proj").expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "hello");
    }

    #[test]
    fn list_sessions_falls_back_to_session_id_prefix_when_nothing_else_available() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("abcdef0123456789.jsonl"),
            r#"{"type":"queue-operation","sessionId":"abcdef0123456789"}"#,
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo.list_sessions("proj").expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "abcdef01");
    }

    #[test]
    fn list_sessions_does_not_rescan_a_file_whose_mtime_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        let file_path = project_dir.join("s1.jsonl");
        fs::write(
            &file_path,
            r#"{"type":"user","sessionId":"s1","message":{"content":"hello"}}"#,
        )
        .unwrap();
        let original_mtime = fs::metadata(&file_path).unwrap().modified().unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let first = repo.list_sessions("proj").expect("should list sessions");
        assert_eq!(first[0].id, "s1");
        assert_eq!(first[0].title, "hello");

        // ファイルを壊す(再走査されればID抽出に失敗するはず)が、mtimeは
        // 書き込み前の値に戻し「未変更」として扱われる状況を再現する。
        fs::write(&file_path, "not valid jsonl at all").unwrap();
        let file = fs::File::options().write(true).open(&file_path).unwrap();
        file.set_modified(original_mtime).unwrap();

        let second = repo
            .list_sessions("proj")
            .expect("should reuse cached summary without rescanning the corrupted file");
        assert_eq!(
            second[0].id, "s1",
            "should return the cached id instead of failing to parse the corrupted file"
        );
        assert_eq!(second[0].title, "hello");
    }
}
