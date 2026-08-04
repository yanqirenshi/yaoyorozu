use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Clone)]
struct ProjectSummary {
    name: String,
    updated_at: u64,
}

#[derive(Serialize, Clone)]
struct ConversationMessage {
    role: String,
    text: String,
    timestamp: String,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| "ホームディレクトリが見つかりません".to_string())
}

fn claude_projects_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".claude").join("projects"))
}

fn to_millis(time: std::io::Result<std::time::SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// ディレクトリ直下(サブディレクトリは見ない)の *.jsonl のうち、
/// 最終更新が最も新しいものを返す。
fn latest_session_file(project_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(project_dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .max_by_key(|path| to_millis(fs::metadata(path).and_then(|m| m.modified())))
}

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectSummary>, String> {
    let projects_dir = claude_projects_dir()?;
    let entries = fs::read_dir(&projects_dir)
        .map_err(|e| format!("{} の読み込みに失敗しました: {}", projects_dir.display(), e))?;

    let mut projects: Vec<ProjectSummary> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| {
            let name = path.file_name()?.to_str()?.to_string();
            let updated_at = latest_session_file(&path)
                .map(|f| to_millis(fs::metadata(&f).and_then(|m| m.modified())))
                .unwrap_or_else(|| to_millis(fs::metadata(&path).and_then(|m| m.modified())));
            Some(ProjectSummary { name, updated_at })
        })
        .collect();

    projects.sort_by_key(|p| std::cmp::Reverse(p.updated_at));
    Ok(projects)
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

/// 1行分のJSONLエントリから、会話として表示すべきテキストを取り出す。
/// thinking / tool_use / tool_result などの内部情報は読み飛ばす。
fn extract_message(value: &serde_json::Value) -> Option<ConversationMessage> {
    let entry_type = value.get("type").and_then(|t| t.as_str())?;
    if entry_type != "user" && entry_type != "assistant" {
        return None;
    }

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

    Some(ConversationMessage {
        role: entry_type.to_string(),
        text,
        timestamp,
    })
}

#[tauri::command]
fn get_latest_session(project: String) -> Result<Vec<ConversationMessage>, String> {
    let project_dir = claude_projects_dir()?.join(&project);
    let path = latest_session_file(&project_dir)
        .ok_or_else(|| format!("{project} にセッションが見つかりません"))?;
    let file = fs::File::open(&path)
        .map_err(|e| format!("{} を開けませんでした: {}", path.display(), e))?;

    let messages = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .filter_map(|value| extract_message(&value))
        .collect();

    Ok(messages)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![list_projects, get_latest_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
