//! クライアントへ返すエラーの文面から、サーバのパスを取り除く。
//!
//! I/O のエラーは `"<フルパス> が見つかりません: …"` のように、サーバのフォルダ構成(ユーザー名・
//! ホームの場所・データフォルダなど)を含む。クライアントへは、次の形に絞って返し、詳しい内容(フルパスを
//! 含む)はサーバのログ(標準エラー)へ出す。エラーを DTO にする 1 か所(`dto.rs` の `From<app::AppError>`)から
//! 呼ぶので、どの command のエラーも、ここを通る。
//!
//! - **ホームの下**: `~\<ホームからの相対>`(ホームのフォルダより上、つまりユーザー名は出さない)。
//!   3 つ以上のフォルダ・名前が続くときは、`~\…\<最後のフォルダ>\<名前>`。
//! - **ホームの外**: `…\<最後のフォルダ>\<名前>`(プロジェクト名・ファイル名まで)。

/// 文面の中のドライブ付きパス(`C:\…`・`C:/…`、`\\?\C:\…`)・UNC(`\\ホスト\…`)を絞る。
/// パスの終わりは、最後の区切りのあとの最初の空白(全角を含む)・`:`・`「」()` の前。
/// ホームのフォルダは、環境変数(`USERPROFILE`・`HOME`)から求める。
pub fn redact_paths(message: &str) -> String {
    let home = std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok());
    redact_paths_with_home(message, home.as_deref())
}

/// [`redact_paths`] の、ホームのフォルダを引数で受ける版(テスト用)。
pub fn redact_paths_with_home(message: &str, home: Option<&str>) -> String {
    let home = home.and_then(parse_home);
    let chars: Vec<char> = message.chars().collect();
    let mut out = String::with_capacity(message.len());
    let mut i = 0;
    while i < chars.len() {
        match path_start(&chars, i) {
            Some((drive, body_start)) => {
                let (segments, end) = read_path(&chars, body_start);
                out.push_str(&shorten(drive, &segments, home.as_ref()));
                i = end;
            }
            None => {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    out
}

/// ホームのフォルダ(ドライブ + セグメント)。
struct Home {
    drive: Option<char>,
    segments: Vec<String>,
}

fn parse_home(home: &str) -> Option<Home> {
    let chars: Vec<char> = home.chars().collect();
    let (drive, body_start) = path_start(&chars, 0)?;
    let mut segments: Vec<String> = chars[body_start..]
        .iter()
        .collect::<String>()
        .split(is_sep)
        .map(str::to_string)
        .collect();
    while segments.last().is_some_and(String::is_empty) {
        segments.pop();
    }
    if segments.is_empty() {
        return None; // ドライブの直下をホームとは扱わない
    }
    Some(Home { drive, segments })
}

fn is_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// パスの途中・終わりに現れない文字(セグメントの区切り)。
fn is_segment_char(c: char) -> bool {
    !(is_sep(c) || c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

/// `i` からパス(ドライブ付き・UNC・`\\?\`)が始まるなら、(ドライブ文字, 区切りを含む本体の開始位置)を返す。
fn path_start(chars: &[char], i: usize) -> Option<(Option<char>, usize)> {
    let before_is_word = i > 0 && (chars[i - 1].is_alphanumeric() || chars[i - 1] == '_');
    // `\\?\C:\…`・`\\.\…`・UNC `\\host\…`
    if chars[i] == '\\' && chars.get(i + 1) == Some(&'\\') && !before_is_word {
        let mut j = i + 2;
        if matches!(chars.get(j), Some('?') | Some('.')) && chars.get(j + 1) == Some(&'\\') {
            j += 2;
            // `\\?\C:\…`
            if chars.get(j).is_some_and(|c| c.is_ascii_alphabetic())
                && chars.get(j + 1) == Some(&':')
                && chars.get(j + 2).is_some_and(|c| is_sep(*c))
            {
                return Some((Some(chars[j].to_ascii_uppercase()), j + 3));
            }
        }
        return Some((None, j));
    }
    // `C:\…`・`C:/…`
    if chars[i].is_ascii_alphabetic()
        && !before_is_word
        && chars.get(i + 1) == Some(&':')
        && chars.get(i + 2).is_some_and(|c| is_sep(*c))
    {
        return Some((Some(chars[i].to_ascii_uppercase()), i + 3));
    }
    None
}

/// `start` からセグメントを読む。区切りで終わるセグメントはすべて取り込み(空白を含んでもよい)、
/// 最後の区切りのあとの名前は、最初の空白・`:` などで止める。戻り値は(セグメント, 読み終わった位置)。
fn read_path(chars: &[char], start: usize) -> (Vec<String>, usize) {
    let mut segments = Vec::new();
    let mut i = start;
    loop {
        // 次の区切りまでのセグメント。
        let mut j = i;
        while j < chars.len() && is_segment_char(chars[j]) {
            j += 1;
        }
        if j < chars.len() && is_sep(chars[j]) {
            segments.push(chars[i..j].iter().collect());
            i = j + 1;
            continue;
        }
        // 最後の名前: 空白・`:` などの手前まで。
        let mut k = i;
        while k < chars.len()
            && is_segment_char(chars[k])
            && !chars[k].is_whitespace()
            && !matches!(chars[k], '(' | ')' | '「' | '」' | '、' | '。' | ',' | ';')
        {
            k += 1;
        }
        segments.push(chars[i..k].iter().collect());
        return (segments, k);
    }
}

/// ホームの下かどうか(ドライブが同じで、ホームのセグメントが先頭に並ぶ。大文字小文字は区別しない)。
fn relative_to_home<'a>(
    drive: Option<char>,
    segments: &'a [String],
    home: Option<&Home>,
) -> Option<&'a [String]> {
    let home = home?;
    if drive.is_none() || drive != home.drive || segments.len() < home.segments.len() {
        return None;
    }
    let same = home
        .segments
        .iter()
        .zip(segments)
        .all(|(h, s)| h.to_lowercase() == s.to_lowercase());
    same.then(|| &segments[home.segments.len()..])
}

fn shorten(drive: Option<char>, segments: &[String], home: Option<&Home>) -> String {
    if let Some(rest) = relative_to_home(drive, segments, home) {
        // ホームの下: ホームのフォルダより上(ユーザー名)は出さない。
        let rest: Vec<&str> = rest
            .iter()
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .collect();
        return match rest.len() {
            0 => "~".to_string(),
            1 | 2 => format!("~\\{}", rest.join("\\")),
            n => format!("~\\…\\{}\\{}", rest[n - 2], rest[n - 1]),
        };
    }
    let name = segments.last().map(String::as_str).unwrap_or("");
    let dir = segments
        .len()
        .checked_sub(2)
        .and_then(|i| segments.get(i))
        .map(String::as_str)
        .filter(|d| !d.is_empty());
    match dir {
        Some(dir) => format!("…\\{dir}\\{name}"),
        None => format!("…\\{name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: Option<&str> = Some(r"C:\Users\secret-user");

    #[test]
    fn outside_the_home_keeps_only_the_last_folder_and_the_file_name() {
        assert_eq!(
            redact_paths_with_home(
                r"D:\work\repos\proj\no-such.jsonl が見つかりません: 指定されたファイルが見つかりません。 (os error 2)",
                HOME
            ),
            "…\\proj\\no-such.jsonl が見つかりません: 指定されたファイルが見つかりません。 (os error 2)"
        );
        assert_eq!(
            redact_paths_with_home(r"C:\ProgramData\app\settings.json を開けません", HOME),
            "…\\app\\settings.json を開けません"
        );
    }

    #[test]
    fn under_the_home_the_user_name_is_never_shown() {
        // ホームの直下(最後のフォルダがユーザー名になっていた失敗)。
        assert_eq!(
            redact_paths_with_home(r"C:\Users\secret-user\.claude が見つかりません", HOME),
            "~\\.claude が見つかりません"
        );
        assert_eq!(
            redact_paths_with_home(r"C:\Users\secret-user\x.json を開けません", HOME),
            "~\\x.json を開けません"
        );
        assert_eq!(
            redact_paths_with_home(r"C:\Users\secret-user を読めません", HOME),
            "~ を読めません"
        );
        // 浅いものはそのまま(~ からの相対)、深いものは最後のフォルダと名前まで。
        assert_eq!(
            redact_paths_with_home(
                r"C:\Users\secret-user\.claude\projects\proj1\s.jsonl が無い",
                HOME
            ),
            "~\\…\\proj1\\s.jsonl が無い"
        );
        assert_eq!(
            redact_paths_with_home(r"C:\Users\secret-user\.claude\CLAUDE.md が無い", HOME),
            "~\\.claude\\CLAUDE.md が無い"
        );
        // 区切りの種類・大文字小文字・拡張長のパスでも、同じ。
        for text in [
            "c:/users/SECRET-USER/.claude/x.md",
            r"\\?\C:\Users\secret-user\.claude\x.md",
        ] {
            let out = redact_paths_with_home(text, HOME);
            assert!(!out.to_lowercase().contains("secret-user"), "{out}");
            assert_eq!(out, "~\\.claude\\x.md");
        }
    }

    #[test]
    fn a_different_user_or_drive_is_not_the_home() {
        assert_eq!(
            redact_paths_with_home(r"C:\Users\other-user\.claude\x.md を開けません", HOME),
            "…\\.claude\\x.md を開けません"
        );
        assert_eq!(
            redact_paths_with_home(r"D:\Users\secret-user\.claude\x.md を開けません", HOME),
            "…\\.claude\\x.md を開けません"
        );
    }

    #[test]
    fn handles_forward_slashes_verbatim_prefixes_unc_and_spaces_in_folders() {
        assert_eq!(
            redact_paths_with_home("D:/Some Name/prj/repo/CLAUDE.md を開けませんでした", HOME),
            "…\\repo\\CLAUDE.md を開けませんでした"
        );
        assert_eq!(
            redact_paths_with_home(r"\\?\D:\a\b\c.txt が見つかりません", HOME),
            "…\\b\\c.txt が見つかりません"
        );
        assert_eq!(
            redact_paths_with_home(r"\\host\share\dir\f.md を読めません", HOME),
            "…\\dir\\f.md を読めません"
        );
        assert_eq!(
            redact_paths_with_home(r"D:\x.json が無い", HOME),
            "…\\x.json が無い"
        );
    }

    #[test]
    fn redacts_every_path_in_a_message_and_leaves_other_text_alone() {
        assert_eq!(
            redact_paths_with_home(r"D:\a\b\one.md を D:\c\d\two.md へ置換できません", HOME),
            "…\\b\\one.md を …\\d\\two.md へ置換できません"
        );
        let plain = "指定されたプロファイルが見つかりません(profile: a:b)";
        assert_eq!(redact_paths_with_home(plain, HOME), plain);
        assert_eq!(
            redact_paths_with_home("セッションIDを取得できませんでした", HOME),
            "セッションIDを取得できませんでした"
        );
        // 単語の途中の `x:\` は、パスとして扱わない。
        assert_eq!(redact_paths_with_home(r"ax:\b", HOME), r"ax:\b");
        // ホームが分からないときも、ホームの外と同じ(最後のフォルダと名前まで)に絞る。
        assert_eq!(
            redact_paths_with_home(r"C:\Users\x\.claude\a.md が無い", None),
            "…\\.claude\\a.md が無い"
        );
    }

    #[test]
    fn the_result_never_contains_a_drive_letter_or_the_user_name() {
        let out = redact_paths_with_home(
            r"C:\Users\secret-user\AppData\Local\Temp\.tmpAbC\home\.claude\projects\proj\s.jsonl を開けませんでした: x",
            HOME,
        );
        assert!(
            !out.contains("secret-user") && !out.contains("C:") && !out.contains("Temp"),
            "{out}"
        );
        assert!(out.contains("proj\\s.jsonl"));
    }
}
