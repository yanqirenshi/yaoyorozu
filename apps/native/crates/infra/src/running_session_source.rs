use app::{AppError, RunningSessionSource};
use serde::Deserialize;
use std::path::PathBuf;
use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::Time::{
    GetTimeZoneInformation, TIME_ZONE_ID_INVALID, TIME_ZONE_INFORMATION,
};

/// `GetTimeZoneInformation` の戻り値(`TIME_ZONE_ID`)。`windows` クレートが
/// 定数化しているのは `TIME_ZONE_ID_INVALID` のみのため、残りはこの crate 内
/// のローカル定数として持つ(値は Win32 API のドキュメントどおり)。
const TIME_ZONE_ID_STANDARD: u32 = 1;
const TIME_ZONE_ID_DAYLIGHT: u32 = 2;

/// 1分を100ナノ秒単位のtickに換算する係数。
const TICKS_PER_MINUTE: i64 = 600_000_000;

/// .NET `DateTime.Ticks` の起点(0001-01-01)から Windows FILETIME の起点
/// (1601-01-01)までの差(100ナノ秒単位)。
const DOTNET_TICKS_AT_FILETIME_EPOCH: i64 = 504_911_232_000_000_000;

/// Windows FILETIME の起点(1601-01-01)から Unixエポック(1970-01-01)までの
/// 差(100ナノ秒単位)。
const FILETIME_AT_UNIX_EPOCH: i64 = 116_444_736_000_000_000;

/// FILETIME同士(またはFILETIME換算後)の一致とみなす許容誤差(issue #345
/// 再修正: 実測で .NET tick からの換算に数tickの丸め誤差が確認された)。
/// 1ミリ秒(=10,000 tick)まで許容する。
const FILETIME_MATCH_TOLERANCE_TICKS: i64 = 10_000;

/// `startedAt`(Unixミリ秒)と実測プロセス作成時刻の一致とみなす許容誤差。
const STARTED_AT_MATCH_TOLERANCE_MS: i64 = 5_000;

/// `~/.claude/sessions/<PID>.json` 1件分(実データ実測。issue #345)。
/// 未知フィールドは無視する(`session_line`と同じ流儀。native.md 外部形式への
/// 依存を最小にする)。
///
/// `procStart` の形式は `claude` の版によって異なる(issue #345再修正。
/// Lab (PoC:検証) の実機報告):
/// - v2.1.280(Desktop): Windows FILETIME(UTC、1601年起点の100ns単位)。
///   `GetProcessTimes` の値と完全一致する。
/// - v2.1.150(PATH解決のCLI): .NET の `DateTime.Ticks`(**ローカル時刻**、
///   0001-01-01起点の100ns単位)とみられる値。
///
/// どちらの形式かを事前に判別する手段が無いため、[`process_is_alive`] で
/// 両方の解釈を順に試す。
#[derive(Deserialize)]
struct RunningSessionRecord {
    pid: u32,
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "procStart")]
    proc_start: String,
    /// プロセス開始時刻(Unixミリ秒)。`procStart` がどちらの形式とも一致
    /// しなかった場合の3番目の照合手段(issue #345再修正)。無ければ `None`。
    #[serde(rename = "startedAt", default)]
    started_at_ms: Option<i64>,
}

/// `~/.claude/sessions/<PID>.json` の読み取りとプロセス生存確認による
/// `RunningSessionSource` 実装(issue #345)。ファイルの `sessionId` が対象と
/// 一致し、かつ記録された `pid` のプロセスが現在も生存していれば、作成時刻の
/// 照合([`process_is_alive`])を経て「実行中」と判定する。
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
            if process_is_alive(record.pid, &record.proc_start, record.started_at_ms) {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// `pid` のプロセスが現在も生存しており、かつ `proc_start`(`startedAt` が
/// あれば併せて)が実測のプロセス作成時刻と(いずれかの解釈で)一致するか。
///
/// 判定順序(issue #345再修正。Lab (PM) の判断):
/// 1. `proc_start` をFILETIMEとして実測値と完全一致するか(Desktop版実測)
/// 2. `proc_start` を .NETローカルtickとして実測値へ換算し、許容誤差以内で
///    一致するか(CLI版実測。タイムゾーン差の換算に現在のローカルタイム
///    ゾーンを使う)
/// 3. `started_at_ms`(Unixミリ秒)と実測値を許容誤差以内で比較する
/// 4. 上記いずれでも判定できない場合、**プロセスが生存してさえいれば
///    実行中とみなす**(安全側に倒す。会話の混線防止が目的のため、
///    「止め漏れ」より「止めすぎ」の実害が小さい。PIDの使い回しで誤って
///    ブロックしても、ユーザーは送信をやり直せば済む)
///
/// プロセスが存在しない(`pid` のプロセス自体が生きていない)場合のみ
/// `false` を返す。
fn process_is_alive(pid: u32, proc_start: &str, started_at_ms: Option<i64>) -> bool {
    let Some(actual_filetime) = process_creation_filetime(pid) else {
        return false;
    };
    let actual_filetime = actual_filetime as i64;

    if let Ok(reported) = proc_start.parse::<u64>() {
        if reported as i64 == actual_filetime {
            return true;
        }
        if let Some(bias_minutes) = local_utc_offset_bias_minutes() {
            let converted = dotnet_local_ticks_to_filetime(reported, bias_minutes);
            if (converted - actual_filetime).abs() <= FILETIME_MATCH_TOLERANCE_TICKS {
                return true;
            }
        }
    }

    if let Some(started_at_ms) = started_at_ms {
        let actual_unix_ms = filetime_to_unix_ms(actual_filetime);
        if (started_at_ms - actual_unix_ms).abs() <= STARTED_AT_MATCH_TOLERANCE_MS {
            return true;
        }
    }

    // 安全側フォールバック(上記コメント4参照)。
    true
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

/// 現在のローカルタイムゾーンの、UTCとの差(分)を返す。
/// `GetTimeZoneInformation` の定義(`UTC = local + bias`)にそのまま従う値。
/// 取得に失敗した場合は `None`(呼び出し側は .NET tick 換算による判定を
/// スキップする)。
fn local_utc_offset_bias_minutes() -> Option<i32> {
    let mut tzi = TIME_ZONE_INFORMATION::default();
    let id = unsafe { GetTimeZoneInformation(&mut tzi) };
    if id == TIME_ZONE_ID_INVALID {
        return None;
    }
    let extra_bias = match id {
        TIME_ZONE_ID_STANDARD => tzi.StandardBias,
        TIME_ZONE_ID_DAYLIGHT => tzi.DaylightBias,
        _ => 0,
    };
    Some(tzi.Bias + extra_bias)
}

/// .NET の `DateTime.Ticks`(ローカル時刻、0001-01-01起点の100ns単位)を
/// Windows FILETIME相当の値(UTC、1601-01-01起点の100ns単位)へ換算する。
/// `bias_minutes` は [`local_utc_offset_bias_minutes`] と同じ形式
/// (`UTC = local + bias`)。
///
/// 実測(issue #345再修正。Lab (PoC:検証) の報告。claude CLI v2.1.150、
/// JST環境): `dotnet_local_ticks = 639257988619807470`、
/// `bias_minutes = -540`(JST)のとき、換算結果は実測FILETIME
/// `134346432619807473` と数tick差で一致する。
fn dotnet_local_ticks_to_filetime(dotnet_local_ticks: u64, bias_minutes: i32) -> i64 {
    let bias_ticks = bias_minutes as i64 * TICKS_PER_MINUTE;
    let dotnet_utc_ticks = dotnet_local_ticks as i64 + bias_ticks;
    dotnet_utc_ticks - DOTNET_TICKS_AT_FILETIME_EPOCH
}

/// FILETIME(UTC、1601年起点の100ns単位)をUnixミリ秒へ換算する。
fn filetime_to_unix_ms(filetime: i64) -> i64 {
    (filetime - FILETIME_AT_UNIX_EPOCH) / 10_000
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

    fn write_record_with_started_at(
        dir: &std::path::Path,
        pid: u32,
        session_id: &str,
        proc_start: &str,
        started_at_ms: i64,
    ) {
        fs::write(
            dir.join(format!("{pid}.json")),
            format!(
                r#"{{"pid":{pid},"sessionId":"{session_id}","procStart":"{proc_start}","startedAt":{started_at_ms}}}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn dotnet_local_ticks_to_filetime_matches_the_observed_v2_1_150_value_within_tolerance() {
        // 実測値(issue #345再修正。Lab (PoC:検証)の報告)。
        let converted = dotnet_local_ticks_to_filetime(639_257_988_619_807_470, -540);
        let expected = 134_346_432_619_807_473_i64;
        assert!(
            (converted - expected).abs() <= FILETIME_MATCH_TOLERANCE_TICKS,
            "converted={converted}, expected={expected}"
        );
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
    fn is_running_returns_true_when_proc_start_is_a_filetime_matching_exactly() {
        // v2.1.280(Desktop)実測の形式。
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        let actual_filetime = process_creation_filetime(pid)
            .expect("should read this test process's own creation time");
        write_record(dir.path(), pid, "s1", &actual_filetime.to_string());

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_true_when_proc_start_is_a_dotnet_local_tick_value() {
        // v2.1.150(CLI)実測の形式。ホストの実際のタイムゾーンを使って
        // 逆算するため、CI等どのタイムゾーンでも成立する。
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        let actual_filetime = process_creation_filetime(pid)
            .expect("should read this test process's own creation time")
            as i64;
        let bias_minutes =
            local_utc_offset_bias_minutes().expect("should read the local timezone bias");
        let dotnet_local_ticks = actual_filetime + DOTNET_TICKS_AT_FILETIME_EPOCH
            - bias_minutes as i64 * TICKS_PER_MINUTE;
        write_record(dir.path(), pid, "s1", &dotnet_local_ticks.to_string());

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_true_when_started_at_matches_within_tolerance() {
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        let actual_filetime = process_creation_filetime(pid)
            .expect("should read this test process's own creation time");
        let actual_unix_ms = filetime_to_unix_ms(actual_filetime as i64);
        // procStartはどちらの形式にも一致しない値にする。
        write_record_with_started_at(dir.path(), pid, "s1", "1", actual_unix_ms + 1_000);

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_falls_back_to_true_when_the_alive_processs_timestamps_do_not_match_any_format() {
        // issue #345再修正: 判定できない場合は安全側(実行中とみなす)。
        let dir = tempfile::tempdir().unwrap();
        write_record(dir.path(), std::process::id(), "s1", "1");

        let source = FileRunningSessionSource::new(dir.path().to_path_buf());

        assert!(source.is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_false_when_the_recorded_pid_no_longer_exists() {
        let dir = tempfile::tempdir().unwrap();
        // 現実的に存在しないであろう大きなPID。プロセス自体が無いため、
        // 安全側フォールバックの対象にもならない(唯一「実行中でない」と
        // 確定できるケース)。
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
