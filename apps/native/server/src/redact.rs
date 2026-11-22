//! クライアントへ返すエラーの文面から、サーバのパスを取り除く。
//!
//! I/O のエラーは `"<フルパス> が見つかりません: …"` のように、サーバのフォルダ構成(ユーザー名・
//! ホームの場所・データフォルダなど)を含む。クライアントへは、**プロジェクト名・ファイル名まで**
//! (最後の 1 つ前のフォルダ名とファイル名)に絞って返し、詳しい内容(フルパスを含む)はサーバのログ
//! (標準エラー)へ出す。エラーを DTO にする 1 か所(`dto.rs` の `From<app::AppError>`)から呼ぶので、
//! どの command のエラーも、ここを通る。

/// 文面の中のドライブ付きパス(`C:\…`・`C:/…`、`\\?\C:\…`)・UNC(`\\ホスト\…`)を、`…\<最後のフォルダ>\<名前>`
/// に置き換える。パスの終わりは、最後の区切りのあとの最初の空白(全角を含む)・`:`・`「」()` の前。
pub fn redact_paths(message: &str) -> String {
    let chars: Vec<char> = message.chars().collect();
    let mut out = String::with_capacity(message.len());
    let mut i = 0;
    while i < chars.len() {
        match path_start(&chars, i) {
            Some(body_start) => {
                let (segments, end) = read_path(&chars, body_start);
                out.push_str(&shorten(&segments));
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

fn is_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// パスの途中・終わりに現れない文字(セグメントの区切り)。
fn is_segment_char(c: char) -> bool {
    !(is_sep(c) || c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

/// `i` からパス(ドライブ付き・UNC・`\\?\`)が始まるなら、区切りを含む本体の開始位置を返す。
fn path_start(chars: &[char], i: usize) -> Option<usize> {
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
                return Some(j + 3);
            }
        }
        return Some(j);
    }
    // `C:\…`・`C:/…`
    if chars[i].is_ascii_alphabetic()
        && !before_is_word
        && chars.get(i + 1) == Some(&':')
        && chars.get(i + 2).is_some_and(|c| is_sep(*c))
    {
        return Some(i + 3);
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

fn shorten(segments: &[String]) -> String {
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

    #[test]
    fn keeps_only_the_project_folder_and_the_file_name() {
        assert_eq!(
            redact_paths(
                r"C:\Users\yanqi\.claude\projects\C--proj\no-such.jsonl が見つかりません: 指定されたファイルが見つかりません。 (os error 2)"
            ),
            "…\\C--proj\\no-such.jsonl が見つかりません: 指定されたファイルが見つかりません。 (os error 2)"
        );
        assert_eq!(
            redact_paths(
                r"C:\Users\x\AppData\Roaming\com.yaoyorozu.server\settings.json の作成に失敗しました: アクセスが拒否されました"
            ),
            "…\\com.yaoyorozu.server\\settings.json の作成に失敗しました: アクセスが拒否されました"
        );
    }

    #[test]
    fn handles_forward_slashes_verbatim_prefixes_unc_and_spaces_in_folders() {
        assert_eq!(
            redact_paths("C:/Users/Some Name/prj/repo/CLAUDE.md を開けませんでした"),
            "…\\repo\\CLAUDE.md を開けませんでした"
        );
        assert_eq!(
            redact_paths(r"\\?\C:\a\b\c.txt が見つかりません"),
            "…\\b\\c.txt が見つかりません"
        );
        assert_eq!(
            redact_paths(r"\\host\share\dir\f.md を読めません"),
            "…\\dir\\f.md を読めません"
        );
        assert_eq!(redact_paths(r"C:\x.json が無い"), "…\\x.json が無い");
    }

    #[test]
    fn redacts_every_path_in_a_message_and_leaves_other_text_alone() {
        assert_eq!(
            redact_paths(r"C:\a\b\one.md を C:\c\d\two.md へ置換できません"),
            "…\\b\\one.md を …\\d\\two.md へ置換できません"
        );
        let plain = "指定されたプロファイルが見つかりません(profile: a:b)";
        assert_eq!(redact_paths(plain), plain);
        assert_eq!(
            redact_paths("セッションIDを取得できませんでした"),
            "セッションIDを取得できませんでした"
        );
        // 単語の途中の `x:\` は、パスとして扱わない。
        assert_eq!(redact_paths(r"ax:\b"), r"ax:\b");
    }

    #[test]
    fn the_result_never_contains_a_drive_letter_or_the_user_name() {
        let out = redact_paths(
            r"C:\Users\secret-user\AppData\Local\Temp\.tmpAbC\home\.claude\projects\proj\s.jsonl を開けませんでした: x",
        );
        assert!(!out.contains("secret-user") && !out.contains("C:") && !out.contains("Temp"));
        assert!(out.contains("proj\\s.jsonl"));
    }
}
