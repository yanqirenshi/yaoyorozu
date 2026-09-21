use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// これを超えたら古いログを `<name>.1` へ退避して新しく始める(診断用のため
/// ローテーションの作り込みはしない。issue #261)。
const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// GitHub 認証まわりの診断ログ(issue #261)。#54 の対応後も再ログイン案内が
/// 再発しているため、いつ・どの操作で・どのインスタンスがトークンを無効と
/// 判断/削除したかの証拠を残す。`app_data_dir` 配下の追記式ファイル
/// (1行1イベント)で、ローカル専用。
///
/// - トークン全文・Authorization ヘッダは書かない(識別は `token_fingerprint`
///   の先頭・末尾数文字のみ)。
/// - ベストエフォート: 書き込みに失敗してもアプリの動作を妨げない(エラーは
///   握りつぶす)。
/// - 複数インスタンス(dev / リリース / worktree 検証)がキーチェーンを共有
///   しているため、各行に `instance`(PID・identifier・実行パス等)を含める。
///   追記の排他は OS の追記書き込み(1行を1回の `write_all` で書く)に任せる。
pub struct GithubAuthLog {
    path: PathBuf,
    instance: String,
}

impl GithubAuthLog {
    pub fn new(path: PathBuf, instance: String) -> Self {
        Self { path, instance }
    }

    /// 1イベントを1行で追記する。`detail` の改行は空白に置き換える。
    pub fn record(&self, event: &str, detail: &str) {
        let line = format_line(now_epoch_secs(), &self.instance, event, detail);
        let _ = self.append(&line);
    }

    fn append(&self, line: &str) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0) > MAX_LOG_BYTES {
            let rotated = PathBuf::from(format!("{}.1", self.path.display()));
            let _ = fs::rename(&self.path, rotated);
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(line.as_bytes())
    }
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// トークンの識別用の印。先頭4文字・末尾4文字と長さだけを返し、全文は
/// 復元できない(12文字未満は先頭・末尾を出さず長さだけ)。
pub fn token_fingerprint(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    let len = chars.len();
    if len < 12 {
        return format!("(len {len})");
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[len - 4..].iter().collect();
    format!("{head}...{tail}(len {len})")
}

fn format_line(epoch_secs: u64, instance: &str, event: &str, detail: &str) -> String {
    let detail = detail.replace(['\r', '\n'], " ");
    format!(
        "{} [{}] {} {}\n",
        format_utc(epoch_secs),
        instance,
        event,
        detail
    )
}

/// エポック秒を `YYYY-MM-DDTHH:MM:SSZ`(UTC)に整形する(時刻ライブラリを
/// 増やさないための自前実装。日付は Howard Hinnant の civil_from_days)。
fn format_utc(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86_400) as i64;
    let secs_of_day = epoch_secs % 86_400;

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{year:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs_of_day / 3_600,
        secs_of_day % 3_600 / 60,
        secs_of_day % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_utc_formats_known_epochs() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_utc(1_000_000_000), "2001-09-09T01:46:40Z");
        // うるう年の2月29日
        assert_eq!(format_utc(1_709_210_096), "2024-02-29T12:34:56Z");
    }

    #[test]
    fn token_fingerprint_never_contains_the_full_token() {
        let token = "gho_abcdefghijklmnopqrstuvwxyz0123456789";
        let fp = token_fingerprint(token);
        assert_eq!(fp, "gho_...6789(len 40)");
        assert!(!fp.contains("abcdefghijkl"));
    }

    #[test]
    fn token_fingerprint_hides_head_and_tail_for_short_tokens() {
        assert_eq!(token_fingerprint("short"), "(len 5)");
    }

    #[test]
    fn format_line_puts_instance_event_and_detail_on_a_single_line() {
        let line = format_line(0, "pid=1 id=x", "http_401", "a\nb\r\nc");
        assert_eq!(line, "1970-01-01T00:00:00Z [pid=1 id=x] http_401 a b  c\n");
    }

    #[test]
    fn record_appends_lines_and_keeps_earlier_ones() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("github-auth.log");
        let a = GithubAuthLog::new(path.clone(), "pid=1 id=a".to_string());
        let b = GithubAuthLog::new(path.clone(), "pid=2 id=b".to_string());

        a.record("login_success", "token=gho_...6789(len 40)");
        b.record("token_deleted", "trigger=logout");

        let content = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("[pid=1 id=a] login_success"));
        assert!(lines[1].contains("[pid=2 id=b] token_deleted"));
    }

    #[test]
    fn record_does_not_fail_when_the_path_is_unwritable() {
        // ディレクトリをファイルとして開こうとして失敗させる。パニックも
        // エラー伝播もしない(ベストエフォート)。
        let dir = tempfile::tempdir().unwrap();
        let log = GithubAuthLog::new(dir.path().to_path_buf(), "pid=1".to_string());
        log.record("http_401", "x");
    }

    #[test]
    fn record_rotates_an_oversized_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("github-auth.log");
        fs::write(&path, vec![b'x'; (MAX_LOG_BYTES + 1) as usize]).unwrap();
        let log = GithubAuthLog::new(path.clone(), "pid=1".to_string());

        log.record("startup_check", "result=resolved");

        assert!(dir.path().join("github-auth.log.1").is_file());
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content.lines().count(), 1);
    }
}
