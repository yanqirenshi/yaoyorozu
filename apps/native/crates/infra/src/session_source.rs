use app::{AppError, SessionSource};
use domain::{
    convert_json_line_to_log_line, extract_cwd, extract_message, resolve_session_title, AgentKind,
    Conversation, LogLine, ParsedSession, Project, ScannedLine, SessionSummary,
};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashMap;
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
    /// (直下のフォルダ名)と、変更のあった会話ファイルを `on_change` に通知する
    /// (プロジェクトごとに、デバウンス1回分の変更をまとめて1回)。
    ///
    /// 戻り値の `Debouncer` を drop すると監視が止まるため、呼び出し側は
    /// 監視を続けたい間、値を保持し続ける必要がある(呼び出し元の tauri 層で
    /// アプリの状態として保持する想定)。
    pub fn watch_projects<F>(&self, on_change: F) -> Result<SessionWatcher, AppError>
    where
        F: Fn(SessionFsChange) + Send + 'static,
    {
        let watch_root = self.projects_dir.clone();
        let mut debouncer =
            new_debouncer(WATCH_DEBOUNCE, None, move |result: DebounceEventResult| {
                let Ok(events) = result else { return };
                // プロジェクト名の初出順を保ったまま、プロジェクトごとに変更のあった
                // 会話ファイルを集める(同じファイルの重複は1件にする)。
                let mut changes: Vec<SessionFsChange> = Vec::new();
                for event in events {
                    for path in &event.paths {
                        let Some(project) = project_name_from_path(&watch_root, path) else {
                            continue;
                        };
                        let index = match changes.iter().position(|c| c.project == project) {
                            Some(index) => index,
                            None => {
                                changes.push(SessionFsChange {
                                    project: project.clone(),
                                    conversation_files: Vec::new(),
                                });
                                changes.len() - 1
                            }
                        };
                        if let Some(file) = conversation_file_from_change(&watch_root, path) {
                            let files = &mut changes[index].conversation_files;
                            if !files.contains(&file) {
                                files.push(file);
                            }
                        }
                    }
                }
                for change in changes {
                    on_change(change);
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

/// ファイル監視が通知する1プロジェクト分の変更(`watch_projects`)。
/// `project` は従来どおり(ビューアの `session:changed` 用)。
/// `conversation_files` は、変更のあった会話ファイル(`<プロジェクト>/<セッションID>.jsonl`)
/// の絶対パス。サブエージェントのファイル(`<プロジェクト>/<セッションID>/…`)の
/// 変更は、その持ち主の会話ファイルとして数える(issue #311。ハブの差分再走査用)。
/// 会話ファイルに結びつかない変更(ディレクトリ自体の変更等)は含まない。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFsChange {
    pub project: String,
    pub conversation_files: Vec<PathBuf>,
}

/// 走査キュー(セッション一覧の逐次読み込み。PoC)の対象1件。列挙時点では
/// ファイルの中身を読まず、パスとメタデータだけで組み立てる軽量な参照。
/// `session_id` はファイル名(`<セッションID>.jsonl`)から取り、中身の
/// `sessionId` とは照合しない(中身は走査(`parse_session_file`)が正とする)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFileRef {
    /// プロジェクトフォルダ名(`projects_dir` 直下)。
    pub project: String,
    /// 会話ファイルの絶対パス。
    pub file_path: PathBuf,
    /// ファイル名由来のセッションID。
    pub session_id: String,
    /// ファイルの最終更新時刻(キューの実行優先度に使う)。
    pub modified_at_ms: u64,
}

impl FileSystemRepository {
    /// 全プロジェクトの会話ファイルを列挙する(走査キューの入力。PoC)。
    /// ディレクトリ列挙と `fs::metadata` のみで、**ファイルの中身は読まない**
    /// (中身を読むのは `parse_session_file`)。サブエージェントのファイルは
    /// 会話ファイルの従属物のため列挙しない(走査時に
    /// `list_subagent_file_paths` が解決する)。
    pub fn enumerate_session_file_refs(&self) -> Result<Vec<SessionFileRef>, AppError> {
        let entries = fs::read_dir(&self.projects_dir).map_err(|e| {
            AppError::Io(format!(
                "{} の読み込みに失敗しました: {}",
                self.projects_dir.display(),
                e
            ))
        })?;
        let mut refs = Vec::new();
        for project_dir in entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
        {
            let Some(project) = project_dir
                .file_name()
                .and_then(|n| n.to_str())
                .map(String::from)
            else {
                continue;
            };
            for file_path in session_files_by_recency(&project_dir) {
                let Some(session_id) = file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(String::from)
                else {
                    continue;
                };
                let modified_at_ms = to_millis(fs::metadata(&file_path).and_then(|m| m.modified()));
                refs.push(SessionFileRef {
                    project: project.clone(),
                    file_path,
                    session_id,
                    modified_at_ms,
                });
            }
        }
        Ok(refs)
    }

    /// 会話ファイル1件分の参照を、そのファイルのメタデータから組み立てる
    /// (差分再走査用。issue #311)。ファイルが無い(削除された)・会話ファイルでない
    /// パスは `None`。
    pub fn session_file_ref(&self, file_path: &Path) -> Option<SessionFileRef> {
        let relative = file_path.strip_prefix(&self.projects_dir).ok()?;
        let project = relative
            .components()
            .next()?
            .as_os_str()
            .to_str()?
            .to_string();
        if !file_path.is_file() || file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            return None;
        }
        let session_id = file_path.file_stem()?.to_str()?.to_string();
        let modified_at_ms = to_millis(fs::metadata(file_path).and_then(|m| m.modified()));
        Some(SessionFileRef {
            project,
            file_path: file_path.to_path_buf(),
            session_id,
            modified_at_ms,
        })
    }

    /// 会話ファイル1件を走査して `ParsedSession` を組み立てる(走査キューの
    /// 実行単位。PoC)。一括版(`list_parsed_sessions`)と同じ組み立て・
    /// 同じ走査キャッシュ(`cached_or_scanned_summary`)を共有する。
    pub fn parse_session_file(
        &self,
        reference: &SessionFileRef,
    ) -> Result<ParsedSession, AppError> {
        let project_dir = self.projects_dir.join(&reference.project);
        build_parsed_session(&project_dir, &reference.file_path)
    }
}

/// `projects_dir` 配下で変更のあった `path` が属する会話ファイルを返す。
/// `<プロジェクト>/<ID>.jsonl` はそのもの、`<プロジェクト>/<ID>/…`(サブエージェント等)は
/// `<プロジェクト>/<ID>.jsonl`。それ以外(プロジェクト直下の他のファイル等)は `None`。
fn conversation_file_from_change(projects_dir: &Path, path: &Path) -> Option<PathBuf> {
    let relative = path.strip_prefix(projects_dir).ok()?;
    let mut components = relative.components();
    let project = components.next()?.as_os_str();
    let second = components.next()?.as_os_str().to_str()?;
    let third = components.next();
    let id = match third {
        // <プロジェクト>/<ID>.jsonl
        None => {
            let name = Path::new(second);
            if name.extension().is_none_or(|e| e != "jsonl") {
                return None;
            }
            name.file_stem()?.to_str()?
        }
        // <プロジェクト>/<ID>/…(サブエージェント等)
        Some(_) => second,
    };
    if id.is_empty() {
        return None;
    }
    Some(projects_dir.join(project).join(format!("{id}.jsonl")))
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

/// 作業ディレクトリのパスを、Claude Code が `~/.claude/projects/` 直下に作る
/// フォルダ名へ変換する。英数字以外を1文字ずつ `-` に置き換えたものになる
/// (実データで確認。2026-09-13)。非ASCII文字は、Claude Code(JavaScript)の
/// 文字列置換と同じく UTF-16 のコード単位ごとに数える想定(外れていても
/// 呼び出し側が最初の cwd にフォールバックするため、致命的にはならない)。
fn project_dir_name_for(cwd: &str) -> String {
    let mut name = String::with_capacity(cwd.len());
    for c in cwd.chars() {
        if c.is_ascii_alphanumeric() {
            name.push(c);
        } else {
            for _ in 0..c.len_utf16() {
                name.push('-');
            }
        }
    }
    name
}

/// セッションファイルに記録された cwd を記録順に1つずつ受け取り、そのファイルが
/// 置かれたプロジェクトフォルダに対応するものを選ぶ。
///
/// cwd はセッション途中で(Bash の cd、worktree への移動等により)変わる。
/// 通常は最初に記録された値がプロジェクトのルートだが、メインのフォルダで
/// 始めて途中で worktree に移ったセッションは、ファイルが worktree 側の
/// フォルダに置かれる一方で最初の cwd はメインのフォルダになる。そのため、
/// フォルダ名と一致する最初の cwd を選ぶ。一致するものがなければ(フォルダ名の
/// 変換規則が想定と違う場合等)最初の cwd を選ぶ。
struct SessionCwdSelector<'a> {
    project_dir_name: Option<&'a str>,
    first: Option<String>,
    matched: Option<String>,
}

impl<'a> SessionCwdSelector<'a> {
    /// `session_file` の親フォルダ名を、一致させるプロジェクトフォルダ名とする。
    fn for_session_file(session_file: &'a Path) -> Self {
        Self {
            project_dir_name: session_file
                .parent()
                .and_then(|dir| dir.file_name())
                .and_then(|name| name.to_str()),
            first: None,
            matched: None,
        }
    }

    fn push(&mut self, cwd: String) {
        if self.is_settled() {
            return;
        }
        if self.project_dir_name == Some(project_dir_name_for(&cwd).as_str()) {
            self.matched = Some(cwd);
        } else if self.first.is_none() {
            self.first = Some(cwd);
        }
    }

    /// フォルダ名と一致する cwd が決まったか。決まった後の cwd は結果に影響
    /// しないため、呼び出し側は cwd を読むのをやめてよい(通常のセッションは
    /// 1件目で決まる)。
    fn is_settled(&self) -> bool {
        self.matched.is_some()
    }

    fn finish(self) -> Option<String> {
        self.matched.or(self.first)
    }
}

/// 指定した会話ファイルに記録されている作業ディレクトリ(cwd)のうち、その
/// ファイルが置かれたプロジェクトフォルダに対応するもの
/// ([`SessionCwdSelector`])を返す。
///
/// `--resume <ID>` は追記先をIDで直接指定するため、`--continue`(カレント
/// ディレクトリに対応するプロジェクトフォルダの最新の会話を継続)のように
/// cwdの一致がそのまま送信先を左右するわけではない。それでもcwd起点の
/// ツール実行・フックの挙動を対象セッションの実際の作業ディレクトリに揃える
/// ため、引き続きこの解決を行う(issue #345。旧`resolve_session_cwd`は
/// 「フォルダ内最新ファイル」固定だったが、`session_cwd`が任意のセッション
/// ファイルを指定できるよう汎用化した)。
fn resolve_cwd_for_session_file(path: &Path) -> Result<PathBuf, AppError> {
    let file = fs::File::open(path)
        .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

    let mut selector = SessionCwdSelector::for_session_file(path);
    for cwd in BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .filter_map(|value| extract_cwd(&value))
    {
        selector.push(cwd);
        if selector.is_settled() {
            break;
        }
    }
    let cwd = selector.finish().ok_or_else(|| {
        AppError::Io("セッションの作業ディレクトリを取得できませんでした".to_string())
    })?;

    Ok(PathBuf::from(cwd))
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

    fn session(&self, project: &str, session_id: &str) -> Result<Conversation, AppError> {
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

        Ok(Conversation {
            id: session_id.to_string(),
            messages,
            agent: AgentKind::ClaudeCode,
        })
    }

    fn session_line_raw(
        &self,
        project: &str,
        session_id: &str,
        uuid: &str,
    ) -> Result<String, AppError> {
        // `project` / `session_id` は app 層で検証済みの前提(native.md §4)。
        let path = self
            .projects_dir
            .join(project)
            .join(format!("{session_id}.jsonl"));
        let file = fs::File::open(&path)
            .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

        // 巨大な行(tool 結果など)を毎行パースしないよう、uuid の文字列を含む
        // 行だけを JSON として読んで、最上位の `uuid` が一致するかを確かめる
        // (`parentUuid` など、他のフィールドに同じ値が現れる行を除くため)。
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if !line.contains(uuid) {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if value.get("uuid").and_then(|v| v.as_str()) == Some(uuid) {
                return Ok(line);
            }
        }
        Err(AppError::NotFound(
            "該当する行が見つかりませんでした(ファイルが変更された可能性があります)".to_string(),
        ))
    }

    fn session_lines(&self, project: &str, session_id: &str) -> Result<Vec<LogLine>, AppError> {
        // `session()`とは別にファイルを開く(issue #208。`app::SessionSource`
        // のドキュメントコメント参照: セッションを開いた瞬間の1回だけの
        // コストであり、以後はtauri層のキャッシュにより再読み込みしない)。
        let path = self
            .projects_dir
            .join(project)
            .join(format!("{session_id}.jsonl"));
        let file = fs::File::open(&path)
            .map_err(|e| AppError::NotFound(format!("{} が見つかりません: {e}", path.display())))?;

        let lines = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
            .filter_map(|value| match convert_json_line_to_log_line(&value) {
                Ok(log_line) => log_line,
                Err(reason) => {
                    // uuid/timestampを変換できないチェーン行はスキップする
                    // (issue本文: 実データで発生したかを確認し、発生した
                    // 場合はデザインへ報告すること。まずは警告ログで
                    // 可視化する)。
                    eprintln!(
                        "{} の1行を LogLine に変換できずスキップしました: {reason:?}",
                        path.display()
                    );
                    None
                }
            })
            .collect();

        Ok(lines)
    }

    fn session_cwd(&self, project: &str, session_id: &str) -> Result<PathBuf, AppError> {
        let path = self
            .projects_dir
            .join(project)
            .join(format!("{session_id}.jsonl"));
        resolve_cwd_for_session_file(&path)
    }

    fn list_sessions(&self, project: &str) -> Result<Vec<SessionSummary>, AppError> {
        let project_dir = self.projects_dir.join(project);
        session_files_by_recency(&project_dir)
            .iter()
            .map(|path| {
                let modified_at_ms = to_millis(fs::metadata(path).and_then(|m| m.modified()));
                let scanned = cached_or_scanned_summary(path, modified_at_ms)?;
                Ok(SessionSummary {
                    id: scanned.id,
                    title: scanned.title,
                    modified_at_ms,
                    cwd: scanned.cwd,
                    git_branch: scanned.git_branch,
                    root_uuid: scanned.root_uuid,
                })
            })
            .collect()
    }

    fn list_parsed_sessions(&self, project: &str) -> Result<Vec<ParsedSession>, AppError> {
        // `list_sessions`と同じキャッシュ(`cached_or_scanned_summary`)に
        // 相乗りし、jsonlのフルパースをもう1周増やさない(issue #197/#208)。
        // 行(`LogLine`)は読まない(遅延読み込み。issue #208)。
        let project_dir = self.projects_dir.join(project);
        session_files_by_recency(&project_dir)
            .iter()
            .map(|path| build_parsed_session(&project_dir, path))
            .collect()
    }
}

/// 会話ファイル1件から `ParsedSession` を組み立てる。走査キャッシュ
/// (`cached_or_scanned_summary`)に相乗りするため、一括版
/// (`list_parsed_sessions`)と1件版(`parse_session_file`。走査キューの
/// 実行単位。PoC)の両方から使う。
fn build_parsed_session(project_dir: &Path, path: &Path) -> Result<ParsedSession, AppError> {
    let modified_at_ms = to_millis(fs::metadata(path).and_then(|m| m.modified()));
    let scanned = cached_or_scanned_summary(path, modified_at_ms)?;
    let subagent_file_paths = list_subagent_file_paths(project_dir, &scanned.id);
    Ok(ParsedSession {
        session_id: scanned.id,
        custom_title: scanned.custom_title,
        ai_title: scanned.ai_title,
        mode: scanned.mode,
        slug: scanned.slug,
        last_prompt: scanned.last_prompt,
        conversation_file_path: path.to_path_buf(),
        subagent_file_paths,
        modified_at_ms,
        // ハブのグラフ表示用の表示補助データ(issue #224)。走査キャッシュ
        // (`CachedSessionSummary`)に既に抽出済みの値をそのまま使う
        // (新たなファイル読み直しはしない)。
        cwd: scanned.cwd,
        git_branch: scanned.git_branch,
    })
}

/// `<project_dir>/<session_id>/subagents/agent-*.jsonl` を列挙する
/// (issue #208)。ディレクトリが無ければ空(サブエージェントを使わなかった
/// セッションが大半のため、通常のケース)。順序を安定させるためソートする。
fn list_subagent_file_paths(project_dir: &Path, session_id: &str) -> Vec<PathBuf> {
    let subagents_dir = project_dir.join(session_id).join("subagents");
    let Ok(entries) = fs::read_dir(&subagents_dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .collect();
    paths.sort();
    paths
}

/// `(ファイルパス, mtime)` をキーにしたタイトル抽出結果のキャッシュ。
/// セッションファイルは数MBになりうり、`custom-title` はファイル末尾付近と
/// は限らないため全行走査が必要になる。未変更のファイルを毎回再走査しない
/// ため、プロセス内メモリでキャッシュする(永続化不要。issue #33)。
/// `cwd`/`git_branch`(issue #104)も同じ全行走査のついでに求まるため、
/// このキャッシュに含める。`custom_title`(生値)/`ai_title`/`mode`/`slug`/
/// `last_prompt` はオブジェクトモデル実装 第4弾(issue #197)の`Session`用に
/// 追加した。`title`(表示用に解決済みの値)とは別に、生の`custom_title`も
/// 保持する。
/// `FileSystemRepository` はコマンド呼び出しごとに使い捨てで生成される
/// (tauri層)ため、インスタンスのフィールドではなくモジュール静的な領域に
/// 置く。
#[derive(Clone)]
#[cfg_attr(test, derive(Debug, PartialEq))]
struct CachedSessionSummary {
    modified_at_ms: u64,
    id: String,
    title: String,
    cwd: Option<String>,
    git_branch: Option<String>,
    custom_title: Option<String>,
    ai_title: Option<String>,
    mode: Option<String>,
    slug: Option<String>,
    last_prompt: Option<String>,
    /// 会話チェーンの根(最初の `parentUuid: null` 行の `uuid`)。フォーク系列の
    /// グループ化キー(issue #345。`domain::SessionSummary.root_uuid`)。
    root_uuid: Option<String>,
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
) -> Result<CachedSessionSummary, AppError> {
    {
        let cache = session_summary_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.get(path) {
            if cached.modified_at_ms == modified_at_ms {
                return Ok(cached.clone());
            }
        }
    }

    let mut scanned = scan_session_summary(path)?;
    scanned.modified_at_ms = modified_at_ms;

    let mut cache = session_summary_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(path.to_path_buf(), scanned.clone());
    Ok(scanned)
}

/// セッションファイルを1行ずつ走査し、ID・表示用タイトル・作業ディレクトリ
/// (cwd)・ブランチ(git_branch)を求める(issue #104でcwd/git_branchを追加)。
/// `custom-title`/`gitBranch` はファイルのどこにでも出現しうる(リネーム・
/// checkoutのたびに追記)ため、早期終了せず全行を読む。`cwd` はファイルが
/// 置かれたプロジェクトフォルダに対応する値([`SessionCwdSelector`]。送信時の
/// cwd と揃える)、`git_branch` は最後に記録された値(checkoutの最終状態)を
/// 採用する。
///
/// `custom_title`(生値)/`ai_title`/`mode`/`slug`/`last_prompt`(issue #197。
/// `domain::Session`用)も同じ全行走査のついでに求める(jsonlの再パースを
/// 増やさないため)。いずれも`custom_title`/`git_branch`と同じく「最後に
/// 見つかったものを採用」する。
fn scan_session_summary(path: &Path) -> Result<CachedSessionSummary, AppError> {
    let file = fs::File::open(path)
        .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

    let mut id: Option<String> = None;
    let mut last_custom_title: Option<String> = None;
    let mut first_user_message: Option<String> = None;
    let mut cwd_selector = SessionCwdSelector::for_session_file(path);
    let mut git_branch: Option<String> = None;
    let mut ai_title: Option<String> = None;
    let mut mode: Option<String> = None;
    let mut slug: Option<String> = None;
    let mut last_prompt: Option<String> = None;
    let mut root_uuid: Option<String> = None;

    // 1行につき `SessionLine` を1回だけ構築し、各値をそのフィールドから直接読む
    // (issue #302。従来は `extract_*` を最大9回呼び、そのたびに `Value` の
    // ディープコピーと型付き構築をやり直していた)。抽出ルールは `extract_*`
    // と同じ(`domain::ScannedLine`)。
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Some(scanned) = ScannedLine::parse(&line) else {
            continue;
        };
        if id.is_none() {
            id = scanned.session_id().map(String::from);
        }
        if let Some(title) = scanned.custom_title() {
            last_custom_title = Some(title.to_string());
        }
        if first_user_message.is_none() {
            first_user_message = scanned.user_message_text();
        }
        if !cwd_selector.is_settled() {
            if let Some(cwd) = scanned.cwd() {
                cwd_selector.push(cwd.to_string());
            }
        }
        if let Some(branch) = scanned.git_branch() {
            git_branch = Some(branch.to_string());
        }
        if let Some(value) = scanned.ai_title() {
            ai_title = Some(value.to_string());
        }
        if let Some(value) = scanned.mode() {
            mode = Some(value.to_string());
        }
        if let Some(value) = scanned.slug() {
            slug = Some(value.to_string());
        }
        if let Some(value) = scanned.last_prompt() {
            last_prompt = Some(value.to_string());
        }
        // 会話チェーンの根(最初の `parentUuid: null` 行のuuid。issue #345)。
        // `uuid` を持たないセッションメタ行・未知の行はどちらも `None` を
        // 返すため、`uuid` の有無で会話チェーン行かどうかを見分ける。
        if root_uuid.is_none() {
            if let Some(uuid) = scanned.uuid() {
                if scanned.parent_uuid().is_none() {
                    root_uuid = Some(uuid.to_string());
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
    Ok(CachedSessionSummary {
        // 呼び出し側(`cached_or_scanned_summary`)が上書きする。走査直後の
        // 値が未確定なことを型で示すため、ここでは仮に0を入れる。
        modified_at_ms: 0,
        id,
        title,
        cwd: cwd_selector.finish(),
        git_branch,
        custom_title: last_custom_title,
        ai_title,
        mode,
        slug,
        last_prompt,
        root_uuid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::Role;
    use domain::{
        extract_ai_title, extract_custom_title, extract_git_branch, extract_last_prompt,
        extract_mode, extract_session_id, extract_slug,
    };
    use std::fs::File;
    use std::io::Write;

    /// issue #302 以前の走査(`extract_*` を行ごとに最大9回呼ぶ方式)の、挙動を
    /// 変えない写し。新しい `scan_session_summary` との同一性の確認・計測用。
    fn scan_session_summary_reference(path: &Path) -> Result<CachedSessionSummary, AppError> {
        let file = fs::File::open(path)
            .map_err(|e| AppError::Io(format!("{} を開けませんでした: {}", path.display(), e)))?;

        let mut id: Option<String> = None;
        let mut last_custom_title: Option<String> = None;
        let mut first_user_message: Option<String> = None;
        let mut cwd_selector = SessionCwdSelector::for_session_file(path);
        let mut git_branch: Option<String> = None;
        let mut ai_title: Option<String> = None;
        let mut mode: Option<String> = None;
        let mut slug: Option<String> = None;
        let mut last_prompt: Option<String> = None;
        let mut root_uuid: Option<String> = None;

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
            if !cwd_selector.is_settled() {
                if let Some(cwd) = extract_cwd(&value) {
                    cwd_selector.push(cwd);
                }
            }
            if let Some(branch) = extract_git_branch(&value) {
                git_branch = Some(branch);
            }
            if let Some(value) = extract_ai_title(&value) {
                ai_title = Some(value);
            }
            if let Some(value) = extract_mode(&value) {
                mode = Some(value);
            }
            if let Some(value) = extract_slug(&value) {
                slug = Some(value);
            }
            if let Some(value) = extract_last_prompt(&value) {
                last_prompt = Some(value);
            }
            if root_uuid.is_none() {
                if let Ok(line) = serde_json::from_value::<domain::SessionLine>(value.clone()) {
                    if let Some(uuid) = line.uuid() {
                        if line.parent_uuid().is_none() {
                            root_uuid = Some(uuid.to_string());
                        }
                    }
                }
            }
        }

        let id =
            id.ok_or_else(|| AppError::Io("セッションIDを取得できませんでした".to_string()))?;
        let title = resolve_session_title(
            last_custom_title.as_deref(),
            first_user_message.as_deref(),
            &id,
        );
        Ok(CachedSessionSummary {
            // 呼び出し側(`cached_or_scanned_summary`)が上書きする。走査直後の
            // 値が未確定なことを型で示すため、ここでは仮に0を入れる。
            modified_at_ms: 0,
            id,
            title,
            cwd: cwd_selector.finish(),
            git_branch,
            custom_title: last_custom_title,
            ai_title,
            mode,
            slug,
            last_prompt,
            root_uuid,
        })
    }

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
    fn session_lines_converts_chain_lines_and_skips_non_chain_lines() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            [
                r#"{"type":"user","uuid":"u1","sessionId":"s1","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"hi"}}"#,
                r#"{"type":"custom-title","customTitle":"タイトル","sessionId":"s1"}"#,
                r#"{"type":"assistant","uuid":"u2","sessionId":"s1","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let lines = repo
            .session_lines("proj", "s1")
            .expect("should read log lines");

        // custom-titleはチェーン行ではないため対象外(2行だけがLogLineになる)。
        assert_eq!(lines.len(), 2);
        assert!(matches!(lines[0], LogLine::User(_)));
        assert!(matches!(lines[1], LogLine::Assistant(_)));
    }

    #[test]
    fn session_lines_skips_chain_lines_missing_uuid_or_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        // `write_session_file`が書く行にはuuid/timestampが無い(issue #208で
        // 実データ確認が必要な欠損ケースの再現)。
        write_session_file(&project_dir, "s1", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let lines = repo
            .session_lines("proj", "s1")
            .expect("should not error even when every line is skipped");

        assert!(lines.is_empty());
    }

    #[test]
    fn session_lines_returns_not_found_for_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let error = repo
            .session_lines("proj", "does-not-exist")
            .expect_err("should fail for missing session file");

        assert!(matches!(error, AppError::NotFound(_)));
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
    fn filesystem_repository_session_cwd_reads_recorded_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let cwd = repo.session_cwd("proj", "s1").expect("should get cwd");

        assert_eq!(cwd, project_dir);
    }

    #[test]
    fn project_dir_name_for_replaces_each_non_alphanumeric_char_with_hyphen() {
        // 実データのフォルダ名(~/.claude/projects/ 直下)と同じ変換になること。
        assert_eq!(
            project_dir_name_for(r"C:\Users\yanqi\prj\yaoyorozu\.claude\worktrees\domain-data-2"),
            "C--Users-yanqi-prj-yaoyorozu--claude-worktrees-domain-data-2"
        );
        assert_eq!(project_dir_name_for("/home/me/proj_1"), "-home-me-proj-1");
    }

    /// `write_session_moved_into_worktree` が書き出すプロジェクトフォルダ名と、
    /// そのフォルダに対応する cwd。
    const WORKTREE_PROJECT: &str = "C--repo--claude-worktrees-wt";
    const WORKTREE_CWD: &str = r"C:\repo\.claude\worktrees\wt";

    /// メインのフォルダで始めて途中で worktree に移ったセッション(実データで
    /// 確認した形)を `projects_dir/WORKTREE_PROJECT/` に書き出す。ファイルは
    /// worktree 側のフォルダに置かれるが、最初の cwd はメインのフォルダになる。
    fn write_session_moved_into_worktree(projects_dir: &Path) {
        let project_dir = projects_dir.join(WORKTREE_PROJECT);
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            [
                r#"{"type":"user","sessionId":"s1","cwd":"C:\\repo","message":{"content":"hello"}}"#,
                r#"{"type":"user","sessionId":"s1","cwd":"C:\\repo\\.claude\\worktrees\\wt","message":{"content":"moved"}}"#,
                r#"{"type":"user","sessionId":"s1","cwd":"C:\\repo\\.claude\\worktrees\\wt\\sub","message":{"content":"cd"}}"#,
            ]
            .join("\n"),
        )
        .unwrap();
    }

    #[test]
    fn session_cwd_prefers_the_cwd_matching_the_project_dir() {
        let dir = tempfile::tempdir().unwrap();
        write_session_moved_into_worktree(dir.path());

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let cwd = repo
            .session_cwd(WORKTREE_PROJECT, "s1")
            .expect("should get cwd");

        assert_eq!(cwd, PathBuf::from(WORKTREE_CWD));
    }

    #[test]
    fn list_sessions_prefers_the_cwd_matching_the_project_dir() {
        // ハブの cwd 表示も送信時の cwd と揃える。
        let dir = tempfile::tempdir().unwrap();
        write_session_moved_into_worktree(dir.path());

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo
            .list_sessions(WORKTREE_PROJECT)
            .expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].cwd.as_deref(), Some(WORKTREE_CWD));
    }

    #[test]
    fn session_cwd_falls_back_to_the_first_cwd_when_none_match_the_project_dir() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            [
                r#"{"type":"user","sessionId":"s1","cwd":"/repo","message":{"content":"hello"}}"#,
                r#"{"type":"user","sessionId":"s1","cwd":"/repo/sub","message":{"content":"world"}}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let cwd = repo.session_cwd("proj", "s1").expect("should get cwd");

        assert_eq!(cwd, PathBuf::from("/repo"));
    }

    #[test]
    fn watch_projects_notifies_project_name_on_new_session_file() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("some-project");
        fs::create_dir_all(&project_dir).unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let (tx, rx) = std::sync::mpsc::channel();
        let _debouncer = repo
            .watch_projects(move |change| {
                let _ = tx.send(change.project);
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
    fn list_sessions_uses_the_first_cwd_and_the_last_git_branch() {
        // cwdはフォルダ名と一致する値がなければ最初の値(プロジェクトルート)、
        // git_branchは最後の値(checkoutの最終状態)を採用する(issue #104)。
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            [
                r#"{"type":"user","sessionId":"s1","cwd":"/repo","gitBranch":"main","message":{"content":"hello"}}"#,
                r#"{"type":"user","sessionId":"s1","cwd":"/repo/sub","gitBranch":"feature/x","message":{"content":"world"}}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo.list_sessions("proj").expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].cwd.as_deref(), Some("/repo"));
        assert_eq!(sessions[0].git_branch.as_deref(), Some("feature/x"));
    }

    #[test]
    fn list_sessions_extracts_root_uuid_from_the_first_chain_root_line() {
        // issue #345: 根uuidは「parentUuidが無い最初の会話チェーン行」の
        // uuid。sessionメタ行(mode等)はuuidを持たないため無視される。
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            [
                r#"{"type":"mode","mode":"normal","sessionId":"s1"}"#,
                r#"{"type":"user","uuid":"root-1","sessionId":"s1","message":{"content":"hello"}}"#,
                r#"{"type":"assistant","uuid":"a-1","parentUuid":"root-1","sessionId":"s1","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo.list_sessions("proj").expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].root_uuid.as_deref(), Some("root-1"));
    }

    #[test]
    fn list_sessions_leaves_root_uuid_none_when_no_chain_root_line_present() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            r#"{"type":"custom-title","customTitle":"タイトル","sessionId":"s1"}"#,
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo.list_sessions("proj").expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].root_uuid, None);
    }

    #[test]
    fn list_sessions_leaves_cwd_and_git_branch_none_when_never_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            r#"{"type":"queue-operation","sessionId":"s1"}"#,
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo.list_sessions("proj").expect("should list sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].cwd, None);
        assert_eq!(sessions[0].git_branch, None);
    }

    #[test]
    fn list_parsed_sessions_reads_all_model_attributes_and_prefers_the_last_occurrence() {
        // issue #197: custom_title/ai_title/mode/slug/last_prompt はいずれも
        // 「最後に見つかったものを採用」する(custom_title/git_branchと同じ
        // 流儀)。
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("s1.jsonl"),
            [
                r#"{"type":"user","sessionId":"s1","slug":"first-slug","message":{"content":"hello"}}"#,
                r#"{"type":"user","sessionId":"s1","slug":"last-slug","message":{"content":"world"}}"#,
                r#"{"type":"custom-title","customTitle":"最後のタイトル","sessionId":"s1"}"#,
                r#"{"type":"ai-title","aiTitle":"AIタイトル","sessionId":"s1"}"#,
                r#"{"type":"mode","mode":"read","sessionId":"s1"}"#,
                r#"{"type":"last-prompt","lastPrompt":"直近の入力","leafUuid":"u1","sessionId":"s1"}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo
            .list_parsed_sessions("proj")
            .expect("should list parsed sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "s1");
        assert_eq!(sessions[0].custom_title.as_deref(), Some("最後のタイトル"));
        assert_eq!(sessions[0].ai_title.as_deref(), Some("AIタイトル"));
        assert_eq!(sessions[0].mode.as_deref(), Some("read"));
        assert_eq!(sessions[0].slug.as_deref(), Some("last-slug"));
        assert_eq!(sessions[0].last_prompt.as_deref(), Some("直近の入力"));
        assert_eq!(
            sessions[0].conversation_file_path,
            project_dir.join("s1.jsonl")
        );
        assert!(sessions[0].subagent_file_paths.is_empty());
    }

    #[test]
    fn list_parsed_sessions_leaves_optional_attributes_none_when_never_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo
            .list_parsed_sessions("proj")
            .expect("should list parsed sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].custom_title, None);
        assert_eq!(sessions[0].ai_title, None);
        assert_eq!(sessions[0].mode, None);
        assert_eq!(sessions[0].slug, None);
        assert_eq!(sessions[0].last_prompt, None);
    }

    #[test]
    fn list_parsed_sessions_finds_subagent_files_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);
        let subagents_dir = project_dir.join("s1").join("subagents");
        fs::create_dir_all(&subagents_dir).unwrap();
        fs::write(subagents_dir.join("agent-a.jsonl"), "").unwrap();
        fs::write(subagents_dir.join("agent-b.jsonl"), "").unwrap();
        // jsonl以外のファイル(念のため置かれていても無視する)。
        fs::write(subagents_dir.join("notes.txt"), "").unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo
            .list_parsed_sessions("proj")
            .expect("should list parsed sessions");

        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].subagent_file_paths,
            vec![
                subagents_dir.join("agent-a.jsonl"),
                subagents_dir.join("agent-b.jsonl"),
            ]
        );
    }

    #[test]
    fn list_parsed_sessions_leaves_subagent_files_empty_when_directory_missing() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        write_session_file(&project_dir, "s1", &project_dir);

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let sessions = repo
            .list_parsed_sessions("proj")
            .expect("should list parsed sessions");

        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].subagent_file_paths.is_empty());
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

    // native.md §5からの意図的な逸脱: 実ユーザーディレクトリ(`~/.claude/
    // projects/`)を読む。issue #208が明示的に要求する「timestamp変換の
    // 失敗ケースが実データに存在するかの確認」を行うための、一回限りの
    // 手動診断であり、通常の `cargo test --workspace` では実行されない
    // (`#[ignore]`)。CI・他マシンではこのディレクトリが無い/内容が違う
    // ため、結果をアサーションで固定するテストにはしない(標準出力に
    // 集計を出すだけ)。実行例: `cargo test -p infra -- --ignored
    // --nocapture diagnose_real_log_line_conversion`。
    #[test]
    #[ignore]
    fn diagnose_real_log_line_conversion() {
        let projects_dir =
            FileSystemRepository::default_projects_dir().expect("should resolve home directory");
        if !projects_dir.is_dir() {
            println!("{} が無いためスキップします", projects_dir.display());
            return;
        }

        let mut file_count = 0u64;
        let mut line_count = 0u64;
        let mut converted_count = 0u64;
        let mut missing_uuid = 0u64;
        let mut missing_or_invalid_timestamp = 0u64;
        let mut examples: Vec<String> = Vec::new();

        for project_entry in fs::read_dir(&projects_dir).expect("should read projects dir") {
            let Ok(project_entry) = project_entry else {
                continue;
            };
            let project_path = project_entry.path();
            if !project_path.is_dir() {
                continue;
            }
            let Ok(session_files) = fs::read_dir(&project_path) else {
                continue;
            };
            for session_file_entry in session_files.filter_map(|e| e.ok()) {
                let path = session_file_entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let Ok(file) = fs::File::open(&path) else {
                    continue;
                };
                file_count += 1;
                for line in BufReader::new(file).lines().map_while(Result::ok) {
                    line_count += 1;
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    match convert_json_line_to_log_line(&value) {
                        Ok(Some(_)) => converted_count += 1,
                        Ok(None) => {}
                        Err(domain::LogLineConversionError::MissingUuid) => {
                            missing_uuid += 1;
                            if examples.len() < 5 {
                                examples.push(format!("{}: uuid欠損: {line}", path.display()));
                            }
                        }
                        Err(domain::LogLineConversionError::MissingOrInvalidTimestamp) => {
                            missing_or_invalid_timestamp += 1;
                            if examples.len() < 5 {
                                examples.push(format!(
                                    "{}: timestamp欠損/不正: {line}",
                                    path.display()
                                ));
                            }
                        }
                    }
                }
            }
        }

        println!("=== LogLine変換 実データ診断 (issue #208) ===");
        println!("走査ディレクトリ: {}", projects_dir.display());
        println!("走査ファイル数: {file_count}");
        println!("走査行数: {line_count}");
        println!("LogLineへ変換できた行数: {converted_count}");
        println!("uuid欠損でスキップ: {missing_uuid}");
        println!("timestamp欠損/不正でスキップ: {missing_or_invalid_timestamp}");
        for example in &examples {
            println!("  例: {example}");
        }
    }

    // native.md §5からの意図的な逸脱(`diagnose_real_log_line_conversion` と同じ理由):
    // 実ユーザーディレクトリを**読み取りのみ**で走査する一回限りの手動診断で、通常の
    // `cargo test` では実行されない(`#[ignore]`)。issue #349: 既存の会話の画像
    // (Desktopで貼ったもの)の件数・「画像だけのメッセージ」の有無と、画像の最も多い
    // ファイルでの `session_line_raw`+画像抽出のオンデマンド取得の所要時間を出す。
    // 実行例: `cargo test -p infra --release -- --ignored --nocapture diagnose_real_message_images`
    #[test]
    #[ignore]
    fn diagnose_real_message_images() {
        let projects_dir =
            FileSystemRepository::default_projects_dir().expect("should resolve home directory");
        if !projects_dir.is_dir() {
            println!("{} が無いためスキップします", projects_dir.display());
            return;
        }

        let (mut files_with_images, mut image_messages, mut image_only_messages) =
            (0u64, 0u64, 0u64);
        let mut total_images = 0u64;
        // (ファイルサイズ, プロジェクト, セッションID, 最後の画像行のuuid)
        let mut biggest: Option<(u64, String, String, String)> = None;

        for project_entry in fs::read_dir(&projects_dir).unwrap().flatten() {
            let project_path = project_entry.path();
            let Some(project) = project_path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Ok(entries) = fs::read_dir(&project_path) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let Ok(file) = fs::File::open(&path) else {
                    continue;
                };
                let mut file_has_images = false;
                let mut last_image_uuid: Option<String> = None;
                for line in BufReader::new(file).lines().map_while(Result::ok) {
                    // 画像を含む行だけをパースする(大半の行を読み飛ばす)。
                    if !line.contains("\"type\":\"image\"") {
                        continue;
                    }
                    let Some(message) = ScannedLine::parse(&line).and_then(|l| l.message()) else {
                        continue;
                    };
                    if message.image_count == 0 {
                        continue;
                    }
                    file_has_images = true;
                    image_messages += 1;
                    total_images += message.image_count as u64;
                    if message.text.trim().is_empty() {
                        image_only_messages += 1;
                    }
                    last_image_uuid = message.uuid.clone();
                }
                if file_has_images {
                    files_with_images += 1;
                    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    if let (Some(uuid), Some(id)) =
                        (last_image_uuid, path.file_stem().and_then(|s| s.to_str()))
                    {
                        if biggest.as_ref().is_none_or(|(s, ..)| size > *s) {
                            biggest = Some((size, project.to_string(), id.to_string(), uuid));
                        }
                    }
                }
            }
        }

        println!("=== 既存会話の画像 実データ診断 (issue #349) ===");
        println!("画像を含むファイル数: {files_with_images}");
        println!("画像を含むメッセージ数: {image_messages}(うち本文が空の画像だけ: {image_only_messages})");
        println!("画像の合計枚数: {total_images}");

        if let Some((size, project, session_id, uuid)) = biggest {
            let repo = FileSystemRepository::new(projects_dir);
            let started = std::time::Instant::now();
            let raw = repo.session_line_raw(&project, &session_id, &uuid);
            let lookup = started.elapsed();
            let images = raw
                .as_deref()
                .map(domain::extract_message_images)
                .unwrap_or_default();
            println!(
                "画像の最も多いファイル: {project}/{session_id}.jsonl ({:.1}MB)",
                size as f64 / 1_048_576.0
            );
            println!(
                "最後の画像行(uuid={uuid})の取得: 行探索 {lookup:?} + 抽出込みで {:?}、画像 {} 枚",
                started.elapsed(),
                images.len()
            );
        }
    }

    /// 新しい走査(1行1回のパース)が、従来の走査(`extract_*` を行ごとに最大9回)と
    /// 同じ結果になること(issue #302 の同一性の保証)。ID・タイトル・cwd・ブランチ・
    /// メタ行(custom-title / ai-title / mode / last-prompt)・slug が複数回現れる、
    /// 壊れた行・未知の行が混ざる、といった実データの形を含む。
    #[test]
    fn scan_session_summary_matches_reference_implementation() {
        let dir = tempfile::tempdir().unwrap();
        let cases: &[&[&str]] = &[
            &[
                r#"{"type":"mode","mode":"plan","sessionId":"s1"}"#,
                r#"{"type":"user","uuid":"u1","sessionId":"s1","cwd":"/work/a","gitBranch":"main","slug":"quiet-fox","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"最初の発言"}}"#,
                "not json",
                r#"{"type":"assistant","uuid":"u2","sessionId":"s1","cwd":"/work/a","gitBranch":"feature/x","message":{"role":"assistant","content":[{"type":"text","text":"返答"}]}}"#,
                r#"{"type":"custom-title","customTitle":"一つ目","sessionId":"s1"}"#,
                r#"{"type":"custom-title","customTitle":"二つ目","sessionId":"s1"}"#,
                r#"{"type":"ai-title","aiTitle":"AI","sessionId":"s1"}"#,
                r#"{"type":"last-prompt","lastPrompt":"最後","sessionId":"s1"}"#,
                r#"{"type":"future-type","sessionId":"s1"}"#,
            ],
            // タイトルなし: 最初のユーザー発言(空白のみ・tool_result のみの行は飛ばす)
            &[
                r#"{"type":"user","sessionId":"s2","message":{"role":"user","content":"   "}}"#,
                r#"{"type":"user","sessionId":"s2","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"x"}]}}"#,
                r#"{"type":"assistant","sessionId":"s2","message":{"role":"assistant","content":[{"type":"text","text":"先に来る返答"}]}}"#,
                r#"{"type":"user","sessionId":"s2","message":{"role":"user","content":[{"type":"text","text":"ブロック形式"}]}}"#,
                r#"{"type":"user","sessionId":"s2","message":{"role":"user","content":"後の発言"}}"#,
            ],
            // メタ行のみ(会話なし)
            &[r#"{"type":"custom-title","customTitle":"だけ","sessionId":"s3"}"#],
            // セッションIDなし(どちらもエラー)
            &[r#"{"type":"future-type"}"#, "[1,2]", ""],
        ];

        for (i, lines) in cases.iter().enumerate() {
            let path = dir.path().join(format!("case{i}.jsonl"));
            fs::write(
                &path,
                lines.join(
                    "
",
                ),
            )
            .unwrap();

            let new = scan_session_summary(&path);
            let old = scan_session_summary_reference(&path);
            match (new, old) {
                (Ok(new), Ok(old)) => assert_eq!(new, old, "case {i}"),
                (Err(_), Err(_)) => {}
                (new, old) => panic!("case {i}: {:?} vs {:?}", new.is_ok(), old.is_ok()),
            }
        }
    }

    /// 実データ(`~/.claude/projects/`。読み取りのみ)の全 `.jsonl` で、新旧の走査結果が
    /// 一致することの確認と、走査時間の計測。実データに依存するため通常は走らせない:
    /// `cargo test -p infra --release -- --ignored --nocapture real_data_scan`
    #[test]
    #[ignore]
    fn real_data_scan_matches_reference_and_reports_timing() {
        fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect(&path, out);
                } else if path.extension().is_some_and(|e| e == "jsonl") {
                    out.push(path);
                }
            }
        }

        let root = FileSystemRepository::default_projects_dir().expect("projects dir");
        let mut files = Vec::new();
        collect(&root, &mut files);
        let bytes: u64 = files
            .iter()
            .filter_map(|p| fs::metadata(p).ok())
            .map(|m| m.len())
            .sum();

        // OS のファイルキャッシュを温めてから、新旧を同じ条件で計測する。
        for p in &files {
            let _ = fs::read(p);
        }
        let started = std::time::Instant::now();
        let old: Vec<_> = files
            .iter()
            .map(|p| scan_session_summary_reference(p))
            .collect();
        let old_elapsed = started.elapsed();
        let started = std::time::Instant::now();
        let new: Vec<_> = files.iter().map(|p| scan_session_summary(p)).collect();
        let new_elapsed = started.elapsed();

        let mut mismatches = 0;
        for ((p, o), n) in files.iter().zip(&old).zip(&new) {
            let same = match (o, n) {
                (Ok(o), Ok(n)) => o == n,
                (Err(_), Err(_)) => true,
                _ => false,
            };
            if !same {
                mismatches += 1;
                eprintln!("MISMATCH: {}", p.display());
            }
        }
        eprintln!(
            "files={} bytes={:.1}MB old={:.2}s new={:.2}s ratio={:.2}x mismatches={}",
            files.len(),
            bytes as f64 / 1_048_576.0,
            old_elapsed.as_secs_f64(),
            new_elapsed.as_secs_f64(),
            old_elapsed.as_secs_f64() / new_elapsed.as_secs_f64(),
            mismatches
        );
        assert_eq!(mismatches, 0);
    }

    /// 走査キュー(tauri 層の `session_scan_queue`)と同じ「mtime 降順・n 並列」で
    /// 実データ全件を走査したときの所要時間を並列度ごとに計測する(issue #296 の
    /// スコープ再評価用。読み取りのみ)。実データに依存するため通常は走らせない:
    /// `cargo test -p infra --release -- --ignored --nocapture real_data_concurrency`
    #[test]
    #[ignore]
    fn real_data_concurrency_timing() {
        let root = FileSystemRepository::default_projects_dir().expect("projects dir");
        let repo = FileSystemRepository::new(root);
        let mut refs = repo.enumerate_session_file_refs().expect("enumerate");
        refs.sort_by_key(|r| std::cmp::Reverse(r.modified_at_ms));
        for p in &refs {
            let _ = fs::read(&p.file_path);
        }

        for workers in [1usize, 2, 4, 6, 8, 12] {
            // 走査結果は mtime 単位でキャッシュされるため、毎回空にして冷えた状態を測る。
            session_summary_cache()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clear();
            let next = std::sync::atomic::AtomicUsize::new(0);
            let started = std::time::Instant::now();
            // 先頭(最も新しいファイル)の完了までの時間も見る(体感の初回表示)。
            let first_done = std::sync::Mutex::new(None::<std::time::Duration>);
            std::thread::scope(|scope| {
                for _ in 0..workers {
                    scope.spawn(|| loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        let Some(r) = refs.get(i) else { break };
                        let _ = repo.parse_session_file(r);
                        if i == 0 {
                            *first_done.lock().unwrap() = Some(started.elapsed());
                        }
                    });
                }
            });
            eprintln!(
                "workers={workers:2} files={} total={:.2}s first_file_done={:.3}s",
                refs.len(),
                started.elapsed().as_secs_f64(),
                first_done.lock().unwrap().unwrap_or_default().as_secs_f64()
            );
        }
    }

    #[test]
    fn conversation_file_from_change_maps_paths_to_owning_conversation_file() {
        let root = Path::new("/root");
        let of = |p: &str| conversation_file_from_change(root, Path::new(p));

        // 会話ファイルそのもの
        assert_eq!(
            of("/root/proj/abc.jsonl"),
            Some(PathBuf::from("/root/proj/abc.jsonl"))
        );
        // サブエージェント等(セッションIDのディレクトリ配下)は持ち主の会話ファイル
        assert_eq!(
            of("/root/proj/abc/subagents/agent-1.jsonl"),
            Some(PathBuf::from("/root/proj/abc.jsonl"))
        );
        assert_eq!(of("/root/proj/abc"), None);
        // 会話ファイルに結びつかない変更
        assert_eq!(of("/root/proj"), None);
        assert_eq!(of("/root/proj/notes.txt"), None);
        assert_eq!(of("/elsewhere/proj/abc.jsonl"), None);
    }

    #[test]
    fn session_file_ref_builds_from_existing_file_and_returns_none_otherwise() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        let file = project_dir.join("abc.jsonl");
        fs::write(&file, "{}").unwrap();
        fs::write(project_dir.join("notes.txt"), "x").unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let reference = repo.session_file_ref(&file).expect("should build ref");
        assert_eq!(reference.project, "proj");
        assert_eq!(reference.session_id, "abc");
        assert_eq!(reference.file_path, file);

        assert!(repo
            .session_file_ref(&project_dir.join("gone.jsonl"))
            .is_none());
        assert!(repo
            .session_file_ref(&project_dir.join("notes.txt"))
            .is_none());
    }

    /// ファイル監視が、会話ファイルの追記・新規作成・サブエージェントの変更を
    /// 会話ファイル単位でまとめて通知する(issue #311)。
    #[test]
    fn watch_projects_reports_changed_conversation_files() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("a.jsonl"),
            "{}
",
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = repo
            .watch_projects(move |change| {
                let _ = tx.send(change);
            })
            .expect("should watch");

        // 既存ファイルへの追記と新規ファイル
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(project_dir.join("a.jsonl"))
            .unwrap();
        writeln!(file, "{{}}").unwrap();
        // Windows では書き込みハンドルを閉じるまで変更が通知されないことがあるため閉じる。
        drop(file);
        fs::write(
            project_dir.join("b.jsonl"),
            "{}
",
        )
        .unwrap();

        let mut seen: Vec<PathBuf> = Vec::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline
            && !(seen.contains(&project_dir.join("a.jsonl"))
                && seen.contains(&project_dir.join("b.jsonl")))
        {
            if let Ok(change) = rx.recv_timeout(std::time::Duration::from_millis(500)) {
                assert_eq!(change.project, "proj");
                seen.extend(change.conversation_files);
            }
        }
        assert!(seen.contains(&project_dir.join("a.jsonl")), "{seen:?}");
        assert!(seen.contains(&project_dir.join("b.jsonl")), "{seen:?}");
    }

    #[test]
    fn session_line_raw_returns_the_line_whose_own_uuid_matches() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        fs::create_dir_all(&project_dir).unwrap();
        // 2行目は parentUuid に u-1 を持つが、自身の uuid は u-2(こちらは返さない)
        let first = r#"{"type":"user","uuid":"u-1","sessionId":"s1","message":{"role":"user","content":"hello"}}"#;
        let second = r#"{"type":"assistant","uuid":"u-2","parentUuid":"u-1","sessionId":"s1","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#;
        fs::write(
            project_dir.join("s1.jsonl"),
            [first, "not json u-3", second].join(
                "
",
            ),
        )
        .unwrap();

        let repo = FileSystemRepository::new(dir.path().to_path_buf());
        assert_eq!(repo.session_line_raw("proj", "s1", "u-1").unwrap(), first);
        assert_eq!(repo.session_line_raw("proj", "s1", "u-2").unwrap(), second);
        // 存在しない uuid・JSON でない行に現れるだけの uuid は NotFound
        assert!(matches!(
            repo.session_line_raw("proj", "s1", "u-9"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            repo.session_line_raw("proj", "s1", "u-3"),
            Err(AppError::NotFound(_))
        ));
        // ファイルが無ければ IO エラー
        assert!(matches!(
            repo.session_line_raw("proj", "nope", "u-1"),
            Err(AppError::Io(_))
        ));
    }
}
