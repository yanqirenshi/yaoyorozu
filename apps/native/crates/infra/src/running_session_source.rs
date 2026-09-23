use app::{AppError, RunningSessionSource};
use serde::Deserialize;
use std::path::PathBuf;
use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// `~/.claude/sessions/<PID>.json` 1件分(実データ実測。issue #345)。
/// 未知フィールドは無視する(`session_line`と同じ流儀。native.md 外部形式への
/// 依存を最小にする)。
#[derive(Deserialize)]
struct RunningSessionRecord {
    pid: u32,
    #[serde(rename = "sessionId")]
    session_id: String,
    /// プロセス作成時刻(Windows FILETIME を10進数文字列化したもの。実測: 桁数
    /// から100ナノ秒単位・1601年起点のFILETIMEと判断)。PIDの使い回しを
    /// 検知するための照合値。
    #[serde(rename = "procStart")]
    proc_start: String,
}

/// `~/.claude/sessions/<PID>.json` の読み取りとプロセス生存確認による
/// `RunningSessionSource` 実装(issue #345)。ファイルの `sessionId` が対象と
/// 一致し、かつ記録された `pid` のプロセスが**同一の作成時刻(procStart)で**
/// 現在も生存していれば「実行中」と判定する(procStartの照合により、PIDが
/// 別プロセスに再利用されたケースを「実行中ではない」と正しく判定する)。
pub struct FileRunningSessionSource {
    sessions_dir: PathBuf,
}

impl FileRunningSessionSource {
    pub fn new(sessions_dir: PathBuf) -> Self {
        Self { sessions_dir }
    }

    /// 設定で明示的な指定がない場合に使う既定のルート(`~/.claude/sessions/`)。
    pub fn default_sessions_dir() -> Result<PathBuf, AppError> {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map(PathBuf::from)
            .map_err(|_| AppError::Io("ホームディレクトリが見つかりません".to_string()))?;
        Ok(home.join(".claude").join("sessions"))
    }
}

impl RunningSessionSource for FileRunningSessionSource {
    fn is_running(&self, session_id: &str) -> Result<bool, AppError> {
        let Ok(entries) = std::fs::read_dir(&self.sessions_dir) else {
            // ディレクトリが無い(このPCでまだ一度も `claude` が実行中セッション
            // 台帳を作っていない等)場合、実行中のセッションは無いとみなす。
            return Ok(false);
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(record) = serde_json::from_str::<RunningSessionRecord>(&content) else {
                continue;
            };
            if record.session_id != session_id {
                continue;
            }
            if process_is_alive(record.pid, &record.proc_start) {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// `pid` のプロセスが現在も生存しており、かつその作成時刻が `expected_proc_start`
/// (10進数文字列化したFILETIME)と一致するか。プロセスが存在しない、または
/// 作成時刻が異なる(PIDが別プロセスに再利用された)場合は `false`。
fn process_is_alive(pid: u32, expected_proc_start: &str) -> bool {
    let Ok(expected) = expected_proc_start.parse::<u64>() else {
        return false;
    };
    process_creation_filetime(pid) == Some(expected)
}

/// `pid` のプロセスの作成時刻(FILETIME。100ナノ秒単位・1601年起点)を
/// `u64` として返す。プロセスが存在しない・情報を取得できない場合は `None`。
fn process_creation_filetime(pid: u32) -> Option<u64> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let result = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
        let _ = CloseHandle(handle);
        result.ok()?;
        Some(((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_record(dir: &std::path::Path, pid: u32, session_id: &str, proc_start: &str) {
        fs::write(
            dir.join(format!("{pid}.json")),
            format!(r#"{{"pid":{pid},"sessionId":"{session_id}","procStart":"{proc_start}"}}"#),
        )
        .unwrap();
    }

    #[test]
    fn is_running_returns_false_when_sessions_dir_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let source = FileRunningSessionSource::new(dir.path().join("does-not-exist"));

        assert!(!source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_false_when_no_record_matches_the_session_id() {
        let dir = tempfile::tempdir().unwrap();
        write_record(dir.path(), std::process::id(), "other-session", "1");

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(!source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_true_when_the_matching_process_is_alive_with_the_same_proc_start() {
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        let actual_proc_start = process_creation_filetime(pid)
            .expect("should read this test process's own creation time");
        write_record(dir.path(), pid, "s1", &actual_proc_start.to_string());

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_false_when_proc_start_does_not_match_stale_pid_reuse() {
        let dir = tempfile::tempdir().unwrap();
        // 自プロセスは生きているが、procStartが不一致(PIDが別プロセスに
        // 再利用された状況を模す)。
        write_record(dir.path(), std::process::id(), "s1", "1");

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(!source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_false_when_the_recorded_pid_no_longer_exists() {
        let dir = tempfile::tempdir().unwrap();
        // 現実的に存在しないであろう大きなPID。
        write_record(dir.path(), 999_999_999, "s1", "123456789");

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(!source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_ignores_non_json_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("12345.abcdef.key"), "not json").unwrap();

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(!source.is_running("s1").unwrap());
    }
}
