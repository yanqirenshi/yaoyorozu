use app::{AppError, RunningSessionSource};
use std::path::{Path, PathBuf};
use windows::Win32::Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, FILETIME};
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
/// **どのフィールドも欠けうる**として読む(`session_line`と同じ流儀。外部形式への
/// 依存を最小にする)。実測では、同じ版でも台帳の中身が状況で変わる:
/// - `procStart` は `claude` の版で形式が違う(v2.1.280 Desktop: Windows FILETIME
///   [UTC、1601年起点の100ns単位]、v2.1.150 CLI: .NET の `DateTime.Ticks`
///   [ローカル時刻、0001年起点の100ns単位]とみられる値)
/// - **`--resume` で開き直した対話セッション(v2.1.150)は `procStart` 自体が無い**
///   (新しく始めた会話には有る)
///
/// 型付きの読み込み(必須フィールドあり)にすると、こうした揺れで読み込みに失敗して
/// 台帳ごと捨ててしまい、実行中のセッションを「実行中でない」と誤判定する
/// (issue #345 の実機検証で発生)。そのため `serde_json::Value` から取れるものだけを
/// 取り出す。
#[derive(Debug, Default)]
struct LedgerEntry {
    pid: Option<u32>,
    session_id: Option<String>,
    /// 文字列でも数値でも受ける(形式の違いは [`process_is_alive`] が吸収する)。
    proc_start: Option<String>,
    /// プロセス開始時刻(Unixミリ秒)。
    started_at_ms: Option<i64>,
}

impl LedgerEntry {
    /// 台帳ファイル1件から読む。`filename_pid` は `<PID>.json` のファイル名由来のPID
    /// で、中身から `pid` を読めない(読み込み失敗・書き込み途中・`pid` 欠落)ときの
    /// 代わりにする。ファイルを読めない・JSONとして読めない場合も、ファイル名の
    /// PID だけは持った状態で返す(捨てない)。
    fn read(path: &Path) -> Self {
        let filename_pid = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<u32>().ok());
        let value = std::fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok());
        let Some(value) = value else {
            return Self {
                pid: filename_pid,
                ..Self::default()
            };
        };
        Self {
            pid: value
                .get("pid")
                .and_then(|v| v.as_u64())
                .and_then(|v| u32::try_from(v).ok())
                .or(filename_pid),
            session_id: value
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(String::from),
            proc_start: match value.get("procStart") {
                Some(serde_json::Value::String(s)) => Some(s.clone()),
                Some(serde_json::Value::Number(n)) => Some(n.to_string()),
                _ => None,
            },
            started_at_ms: value.get("startedAt").and_then(|v| v.as_i64()),
        }
    }
}

/// `~/.claude/sessions/<PID>.json` の読み取りとプロセス生存確認による
/// `RunningSessionSource` 実装(issue #345)。
///
/// **原則: 「読めない・分からない」は「実行中」(送信を止める)側に倒す。**
/// 判定の目的は同じ会話ファイルへの並行追記(会話の混線)の防止で、「止め漏れ」
/// (実際は実行中なのに通す)の害が、「止めすぎ」(誤ってブロックしても、ユーザーは
/// 待ってやり直せば済む)より大きいため。具体的には台帳1件ごとに次のとおり:
///
/// - `sessionId` が**別のセッション**と分かる → 無関係(読み飛ばす)
/// - `sessionId` が対象と一致 → PID のプロセスが生きていれば実行中
///   ([`process_is_alive`]。`procStart` が無くても生存だけで実行中とみなす)
/// - `sessionId` を取り出せない(読めない・JSONでない・書き込み途中・`sessionId` 欠落)
///   → 対象と照合できないので、**その台帳の PID が生きていれば実行中とみなす**
/// - PID を特定できない(中身にも `<PID>.json` のファイル名にも無い)→ 生存を確かめる
///   相手がおらず、ブロックしても永続的に解消できない(ユーザーが台帳を消すまで
///   全送信が止まる)ため、この台帳は無視する(唯一の「止めない」例外)
/// - 台帳のディレクトリが「存在しない」以外の理由で読めない → 何も分からないので
///   エラー(送信しない)
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
        let entries = match std::fs::read_dir(&self.sessions_dir) {
            Ok(entries) => entries,
            // ディレクトリが無い(このPCでまだ一度も `claude` が実行中セッション
            // 台帳を作っていない等)場合だけ、実行中のセッションは無いと確定できる。
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => {
                return Err(AppError::Io(format!(
                    "実行中セッションの台帳({})を読めませんでした: {e}",
                    self.sessions_dir.display()
                )))
            }
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let ledger = LedgerEntry::read(&path);
            let Some(pid) = ledger.pid else {
                continue;
            };
            match ledger.session_id.as_deref() {
                Some(id) if id != session_id => continue,
                Some(_) => {
                    if process_is_alive(pid, ledger.proc_start.as_deref(), ledger.started_at_ms) {
                        return Ok(true);
                    }
                }
                None => {
                    if !matches!(probe_process(pid), ProcessProbe::NotFound) {
                        return Ok(true);
                    }
                }
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
/// 4. 上記いずれでも判定できない(`proc_start` が無い場合を含む)場合、
///    **プロセスが生存してさえいれば実行中とみなす**(安全側に倒す。会話の混線
///    防止が目的のため、「止め漏れ」より「止めすぎ」の実害が小さい。PIDの使い回しで
///    誤ってブロックしても、ユーザーは送信をやり直せば済む)
///
/// プロセスが存在しない(`pid` のプロセス自体が生きていない)と確定できる
/// 場合のみ `false` を返す。プロセスの作成時刻を取得できない(アクセス拒否等)
/// 場合も、存在は否定できないので生存とみなす。
fn process_is_alive(pid: u32, proc_start: Option<&str>, started_at_ms: Option<i64>) -> bool {
    let actual_filetime = match probe_process(pid) {
        ProcessProbe::NotFound => return false,
        ProcessProbe::Alive {
            creation_filetime: None,
        } => return true,
        ProcessProbe::Alive {
            creation_filetime: Some(filetime),
        } => filetime as i64,
    };

    if let Some(reported) = proc_start.and_then(|s| s.parse::<u64>().ok()) {
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

/// [`probe_process`] の結果。
#[derive(Debug, PartialEq, Eq)]
enum ProcessProbe {
    /// そのPIDのプロセスは存在しない(唯一「実行中でない」と確定できる結果)。
    NotFound,
    /// プロセスは存在する(またはその可能性を否定できない)。`creation_filetime`
    /// は作成時刻(FILETIME。100ナノ秒単位・1601年起点)で、取得できなければ `None`。
    Alive { creation_filetime: Option<u64> },
}

/// `pid` のプロセスを調べる。`OpenProcess` が「パラメータ不正」(そのPIDが存在
/// しないときのエラー)で失敗した場合だけ `NotFound` とし、それ以外の失敗
/// (アクセス拒否など)は存在を否定できないので `Alive` 扱いにする(分からない
/// ときは止める側に倒す原則)。
fn probe_process(pid: u32) -> ProcessProbe {
    unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => handle,
            Err(e) if e.code() == ERROR_INVALID_PARAMETER.to_hresult() => {
                return ProcessProbe::NotFound
            }
            Err(_) => {
                return ProcessProbe::Alive {
                    creation_filetime: None,
                }
            }
        };
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let result = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
        let _ = CloseHandle(handle);
        ProcessProbe::Alive {
            creation_filetime: result
                .ok()
                .map(|_| ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64),
        }
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

    /// 自プロセス(テストを実行中で確実に生きているPID)の作成時刻。
    fn own_creation_filetime() -> u64 {
        match probe_process(std::process::id()) {
            ProcessProbe::Alive {
                creation_filetime: Some(filetime),
            } => filetime,
            other => panic!("should read this test process's own creation time: {other:?}"),
        }
    }

    /// 現実的に存在しないであろう大きなPID。
    const DEAD_PID: u32 = 999_999_999;

    fn write_ledger(dir: &Path, file_name: &str, content: &str) {
        fs::write(dir.join(file_name), content).unwrap();
    }

    fn write_record(dir: &Path, pid: u32, session_id: &str, proc_start: &str) {
        write_ledger(
            dir,
            &format!("{pid}.json"),
            &format!(r#"{{"pid":{pid},"sessionId":"{session_id}","procStart":"{proc_start}"}}"#),
        );
    }

    fn write_record_with_started_at(
        dir: &Path,
        pid: u32,
        session_id: &str,
        proc_start: &str,
        started_at_ms: i64,
    ) {
        write_ledger(
            dir,
            &format!("{pid}.json"),
            &format!(
                r#"{{"pid":{pid},"sessionId":"{session_id}","procStart":"{proc_start}","startedAt":{started_at_ms}}}"#
            ),
        );
    }

    fn source(dir: &tempfile::TempDir) -> FileRunningSessionSource {
        FileRunningSessionSource::new(dir.path().to_path_buf())
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
    fn is_running_errors_when_sessions_dir_exists_but_cannot_be_read() {
        // 「存在しない」以外の理由で読めないときは、何も分からないので送信を止める
        // (エラー)。ここではディレクトリではなく通常のファイルを指して再現する。
        let dir = tempfile::tempdir().unwrap();
        let not_a_dir = dir.path().join("file.txt");
        fs::write(&not_a_dir, "x").unwrap();

        let result = FileRunningSessionSource::new(not_a_dir).is_running("s1");

        assert!(matches!(result, Err(AppError::Io(_))), "{result:?}");
    }

    #[test]
    fn is_running_returns_false_when_no_record_matches_the_session_id() {
        let dir = tempfile::tempdir().unwrap();
        write_record(dir.path(), std::process::id(), "other-session", "1");

        assert!(!source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_true_when_proc_start_is_a_filetime_matching_exactly() {
        // v2.1.280(Desktop)実測の形式。
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        write_record(dir.path(), pid, "s1", &own_creation_filetime().to_string());

        assert!(source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_true_when_proc_start_is_a_json_number() {
        // procStart が文字列でなく数値で書かれていても読める。
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        write_ledger(
            dir.path(),
            &format!("{pid}.json"),
            &format!(
                r#"{{"pid":{pid},"sessionId":"s1","procStart":{}}}"#,
                own_creation_filetime()
            ),
        );

        assert!(source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_true_when_proc_start_is_a_dotnet_local_tick_value() {
        // v2.1.150(CLI)実測の形式。ホストの実際のタイムゾーンを使って
        // 逆算するため、CI等どのタイムゾーンでも成立する。
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        let bias_minutes =
            local_utc_offset_bias_minutes().expect("should read the local timezone bias");
        let dotnet_local_ticks = own_creation_filetime() as i64 + DOTNET_TICKS_AT_FILETIME_EPOCH
            - bias_minutes as i64 * TICKS_PER_MINUTE;
        write_record(dir.path(), pid, "s1", &dotnet_local_ticks.to_string());

        assert!(source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_true_when_started_at_matches_within_tolerance() {
        let dir = tempfile::tempdir().unwrap();
        let actual_unix_ms = filetime_to_unix_ms(own_creation_filetime() as i64);
        // procStartはどちらの形式にも一致しない値にする。
        write_record_with_started_at(
            dir.path(),
            std::process::id(),
            "s1",
            "1",
            actual_unix_ms + 1_000,
        );

        assert!(source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_falls_back_to_true_when_the_alive_processs_timestamps_do_not_match_any_format() {
        // issue #345再修正: 判定できない場合は安全側(実行中とみなす)。
        let dir = tempfile::tempdir().unwrap();
        write_record(dir.path(), std::process::id(), "s1", "1");

        assert!(source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_false_when_the_recorded_pid_no_longer_exists() {
        let dir = tempfile::tempdir().unwrap();
        // プロセス自体が無いため、安全側フォールバックの対象にもならない
        // (「実行中でない」と確定できるケース)。
        write_record(dir.path(), DEAD_PID, "s1", "123456789");

        assert!(!source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_ignores_non_json_files() {
        let dir = tempfile::tempdir().unwrap();
        write_ledger(dir.path(), "12345.abcdef.key", "not json");

        assert!(!source(&dir).is_running("s1").unwrap());
    }

    // ---- 台帳の揺れ(issue #345 実機検証で判明): 読めない・分からないは止める側 ----

    #[test]
    fn is_running_returns_true_for_a_ledger_without_proc_start() {
        // `claude --resume` で開き直した対話セッション(v2.1.150)の台帳の実例
        // (Lab (PM) の報告。procStart が無い)。pid と startedAt はこのテストの
        // 自プロセスに差し替えてある。
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        write_ledger(
            dir.path(),
            &format!("{pid}.json"),
            &format!(
                r#"{{"pid":{pid},"sessionId":"s1","cwd":"C:\\Users\\yanqi\\prj\\yaoyorozu","startedAt":1790215440370,"version":"2.1.150","peerProtocol":1,"kind":"interactive","entrypoint":"cli","status":"idle","updatedAt":1790215443082}}"#
            ),
        );

        assert!(source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_ignores_a_ledger_without_proc_start_for_another_session() {
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        write_ledger(
            dir.path(),
            &format!("{pid}.json"),
            &format!(r#"{{"pid":{pid},"sessionId":"other","startedAt":1790215440370}}"#),
        );

        assert!(!source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_returns_false_for_a_ledger_without_proc_start_whose_process_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        write_ledger(
            dir.path(),
            &format!("{DEAD_PID}.json"),
            &format!(r#"{{"pid":{DEAD_PID},"sessionId":"s1"}}"#),
        );

        assert!(!source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_uses_the_file_name_pid_when_the_ledger_has_no_pid_field() {
        let dir = tempfile::tempdir().unwrap();
        let pid = std::process::id();
        write_ledger(
            dir.path(),
            &format!("{pid}.json"),
            r#"{"sessionId":"s1","startedAt":1}"#,
        );

        assert!(source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_blocks_when_the_ledger_cannot_be_matched_to_the_session_but_its_process_is_alive()
    {
        // JSONとして読めない(書き込み途中の切れ端など)・オブジェクトでない・
        // sessionId が無い台帳は、対象セッションと照合できない。そのPIDが生きて
        // いるなら、実行中とみなして止める。
        let pid = std::process::id();
        let pid_only = format!(r#"{{"pid":{pid}}}"#);
        for content in [
            r#"{"pid":19104,"sessionId":"s"#,
            "",
            "[]",
            pid_only.as_str(),
        ] {
            let dir = tempfile::tempdir().unwrap();
            write_ledger(dir.path(), &format!("{pid}.json"), content);

            assert!(
                source(&dir).is_running("s1").unwrap(),
                "content: {content:?}"
            );
        }
    }

    #[test]
    fn is_running_does_not_block_on_an_unreadable_ledger_whose_process_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        write_ledger(dir.path(), &format!("{DEAD_PID}.json"), r#"{"sessionId":"#);

        assert!(!source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn is_running_ignores_a_ledger_with_no_identifiable_pid() {
        // 中身にもファイル名にもPIDが無い台帳は、生存を確かめる相手がおらず、
        // ブロックすると永続的に解消できないため無視する(唯一の例外)。
        let dir = tempfile::tempdir().unwrap();
        write_ledger(dir.path(), "garbage.json", r#"{"sessionId":"s1"#);
        write_ledger(dir.path(), "garbage2.json", "not json at all");

        assert!(!source(&dir).is_running("s1").unwrap());
    }

    #[test]
    fn probe_process_treats_a_process_it_may_not_open_as_alive() {
        // PID 4(System)は権限によって開けたり開けなかったりするが、どちらでも
        // 「存在しない」とは判定しない(アクセス拒否を NotFound にしない)。
        assert_ne!(probe_process(4), ProcessProbe::NotFound);
        assert_eq!(probe_process(DEAD_PID), ProcessProbe::NotFound);
    }
}
