//! 状態の唯一の置き場(Tauri 版 `AppState` の写し。段階 2 に要る分だけ)。
//! `tauri/src/state.rs` から写した: `resolve_effective_projects_dir`・`store_loaded_session`。

use crate::dto::PendingWarningDto;
use domain::{LogLine, Settings};
use std::collections::HashMap;
use std::path::PathBuf;

/// 設定の `claude_projects_dir` と既定値(`~/.claude/projects/`)から、実際に使うルートを求める。
///
/// すでに保存されている上書き値が不正(相対・UNC・`..`・制御文字入りなど。古い版や手書きで入った値)
/// なら、起動は止めず、**この値を起点にした読み書きだけを断る**(`InvalidInput`)。画面で直せるように、
/// 設定の取得(`get_settings`)は [`describe_effective_projects_dir`] を使う。
pub fn resolve_effective_projects_dir(settings: &Settings) -> Result<PathBuf, app::AppError> {
    if let Some(dir) = settings.claude_projects_dir.as_deref() {
        crate::folders::guard_folder_path(&dir.to_string_lossy()).map_err(|e| match e {
            app::AppError::InvalidInput(why) => app::AppError::InvalidInput(format!(
                "保存されているセッションのルートのパスが不正です(設定で直してください): {why}"
            )),
            other => other,
        })?;
    }
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

    /// 同じ内容の警告が控えに無いときだけ積む(積んだら割り当てた ID を返す)。同じ内容を何度も出さない。
    pub fn push_warning_once(&mut self, kind: &str, message: String) -> Option<u64> {
        if self
            .warnings
            .iter()
            .any(|w| w.kind == kind && w.message == message)
        {
            return None;
        }
        Some(self.push_warning(kind, message))
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

/// 設定画面に出す「実際に使うセッションのルート」。上書き値が不正でも失敗させず、その値をそのまま
/// 見せる(画面で直せるように。読み書きは [`resolve_effective_projects_dir`] が断る)。
pub fn describe_effective_projects_dir(settings: &Settings) -> Result<String, app::AppError> {
    match resolve_effective_projects_dir(settings) {
        Ok(dir) => Ok(dir.display().to_string()),
        Err(app::AppError::InvalidInput(_)) => Ok(settings
            .claude_projects_dir
            .as_deref()
            .map(|p| p.display().to_string())
            .unwrap_or_default()),
        Err(other) => Err(other),
    }
}
