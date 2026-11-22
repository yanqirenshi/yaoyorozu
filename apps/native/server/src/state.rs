//! 状態の唯一の置き場(Tauri 版 `AppState` の写し。段階 2 に要る分だけ)。
//! `tauri/src/state.rs` から写した: `resolve_effective_projects_dir`・`store_loaded_session`。

use crate::dto::PendingWarningDto;
use domain::{LogLine, Settings};
use std::collections::HashMap;
use std::path::PathBuf;

/// 設定の `claude_projects_dir` と既定値(`~/.claude/projects/`)から、実際に使うルートを求める。
pub fn resolve_effective_projects_dir(settings: &Settings) -> Result<PathBuf, app::AppError> {
    let default = infra::FileSystemRepository::default_projects_dir()?;
    Ok(domain::effective_projects_dir(
        settings.claude_projects_dir.as_deref(),
        &default,
    ))
}

pub struct ServerState {
    pub settings: Settings,
    pub save_path: PathBuf,
    /// 起動時の設定読み込みが既定値へ復旧した(issue #538)直後、まだ一度も保存していないか。
    /// 真の間は、次の保存が上書きする前に今のファイルの複製を残す。
    pub settings_recovery_pending: bool,
    /// 起動直後に出て取りこぼした警告の控え(`list_pending_warnings`)。
    pub warnings: Vec<PendingWarningDto>,
    pub next_warning_id: u64,
    /// セッションを開いたときに組み立てた `LogLine` のキャッシュ(会話ファイルのパスがキー)。
    pub loaded_log_lines: HashMap<PathBuf, Vec<LogLine>>,
    /// 解析済みメッセージのキャッシュ(issue #350)。ファイルの状態とセットで持つ。
    pub loaded_messages: HashMap<PathBuf, app::CachedMessages>,
}

impl ServerState {
    pub fn new(settings: Settings, save_path: PathBuf, recovered_from_corruption: bool) -> Self {
        Self {
            settings,
            save_path,
            settings_recovery_pending: recovered_from_corruption,
            warnings: Vec::new(),
            next_warning_id: 1,
            loaded_log_lines: HashMap::new(),
            loaded_messages: HashMap::new(),
        }
    }

    /// 警告を控えに積む。戻り値は割り当てた ID。
    pub fn push_warning(&mut self, kind: &str, message: String) -> u64 {
        let id = self.next_warning_id;
        self.next_warning_id += 1;
        self.warnings.push(PendingWarningDto {
            id,
            kind: kind.to_string(),
            message,
        });
        id
    }

    /// 読み直した会話をキャッシュへ入れる(遅れて終わった古い読みが新しいキャッシュを
    /// 上書きしないよう、置き換えてよいかは `app::should_replace_cache` で判断する)。
    pub fn store_loaded_session(&mut self, path: PathBuf, reloaded: app::ReloadedSession) {
        if !app::should_replace_cache(self.loaded_messages.get(&path), &reloaded.messages) {
            return;
        }
        self.loaded_log_lines.insert(path.clone(), reloaded.lines);
        self.loaded_messages.insert(path, reloaded.messages);
    }
}
