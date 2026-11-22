//! フロントから受け取った値をそのままパス構築やファイル書き込みに使わない
//! ための入力検証関数群(native.md §4)。どの型にも属さない純粋な真偽値
//! 判定関数のため、機能別ファイルにまとめる(native.md §1)。

/// `content` が構文的に妥当なJSONかを判定する純粋関数。保存前のチェックに
/// 使う(Claude Code本体が読めない壊れたJSONを書き込んでしまう事故の防止。
/// issue #53)。整形は行わない(ユーザーの書式をそのまま保存するため、この
/// 関数はパース可否のみを見る)。
pub fn is_valid_json(content: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(content).is_ok()
}

/// `content` が JSON として正しく、**最上位がオブジェクト**(`{ … }`)かを判定する。設定ファイル
/// (`settings.json`・`settings.local.json`)は Claude Code がオブジェクトとして読むため、配列・数値・
/// 文字列・`null` だけの JSON は書かせない。
pub fn is_valid_json_object(content: &str) -> bool {
    matches!(
        serde_json::from_str::<serde_json::Value>(content),
        Ok(serde_json::Value::Object(_))
    )
}

/// 文字が「断る対象の見えない文字」か。**Unicode の性質**で決める(範囲の並べ書きだと抜ける。
/// U+061C・U+2028・U+3164 など): 制御文字(Cc)・行と段落の区切り(Zl・Zp)・書式の文字(Cf。ゼロ幅・
/// 双方向の制御・BOM・ソフトハイフン・タグ文字など)・既定で無視される文字(Default_Ignorable_Code_Point。
/// ハングルの埋め草 U+3164・U+115F・U+1160・U+FFA0、異体字セレクタ、結合用の U+034F など)。
fn is_invisible_or_control(c: char) -> bool {
    use icu_properties::props::{DefaultIgnorableCodePoint, GeneralCategory};
    use icu_properties::{CodePointMapData, CodePointSetData};
    matches!(
        CodePointMapData::<GeneralCategory>::new().get(c),
        GeneralCategory::Control
            | GeneralCategory::LineSeparator
            | GeneralCategory::ParagraphSeparator
            | GeneralCategory::Format
    ) || CodePointSetData::new::<DefaultIgnorableCodePoint>().contains(c)
}

/// 異体字セレクタ(U+FE00〜U+FE0F、U+E0100〜U+E01EF)。見える文字の直後なら通す(絵文字の表示指定など)。
fn is_variation_selector(c: char) -> bool {
    matches!(c, '\u{FE00}'..='\u{FE0F}' | '\u{E0100}'..='\u{E01EF}')
}

/// 前後の文字との関係で、通してよい見えない文字(ZWJ・ZWNJ・異体字セレクタ)か。
/// - ZWJ(U+200D)・ZWNJ(U+200C): **前後に見える文字がある**場合だけ(絵文字の `👨‍💻` や、ZWNJ を使う
///   言語の名前を断らないため)。前後の見える文字は、異体字セレクタの直後(`❤️‍🔥`)も含む。
/// - 異体字セレクタ: **見える文字の直後**だけ。
fn allowed_joiner(c: char, prev_visible: bool, next_visible: bool) -> bool {
    match c {
        '\u{200C}' | '\u{200D}' => prev_visible && next_visible,
        _ if is_variation_selector(c) => prev_visible,
        _ => false,
    }
}

/// 見える文字か(空白・制御・見えない文字・異体字セレクタ以外)。
fn is_visible(c: char) -> bool {
    // パスの区切りは「見える文字」に数えない(`repo<ZWJ>\x` のように、区切りの隣で見えない文字を許さない)。
    !c.is_whitespace() && !is_invisible_or_control(c) && !matches!(c, '\\' | '/')
}

/// 名前・パスに、**断る対象の制御文字・見えない文字**(改行・NUL・タブ・ゼロ幅・向きを変える文字・
/// ハングルの埋め草など)が含まれるか。ZWJ・ZWNJ は前後に見える文字があるときだけ、異体字セレクタは
/// 見える文字の直後だけ通す。名前やパスに入れると、見えない名前・表示の向きを変える名前
/// (`…exe.txt` に見える `…txt.exe` など)を作れてしまう。
pub fn contains_forbidden_invisible_or_control(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    // 直前の文字が「見える文字」(または、それにつく異体字セレクタ)か。
    let mut prev_visible = false;
    for (i, &c) in chars.iter().enumerate() {
        if is_invisible_or_control(c) {
            let next_visible = chars.get(i + 1).copied().is_some_and(is_visible);
            if !allowed_joiner(c, prev_visible, next_visible) {
                return true;
            }
            // 通した見えない文字の直後は、「見える文字につながっている」とみなす(`❤` `FE0F` `ZWJ` `🔥`)。
            // ZWJ の直後は次の文字が見えることを上で確かめている。異体字セレクタのあとはつながりを保つ。
            prev_visible = is_variation_selector(c);
        } else {
            prev_visible = is_visible(c);
        }
    }
    false
}

/// 文字列に、**書式の文字(Cf)・既定で無視される文字・制御文字・行と段落の区切り**が 1 つでも含まれるか。
/// `contains_forbidden_invisible_or_control` と違い、ZWJ・ZWNJ・異体字セレクタの例外を認めない
/// (ブランチ名のように、絵文字や、ZWNJ を使う言語の名前を通す必要が無いもの用)。
pub fn contains_format_or_ignorable_character(text: &str) -> bool {
    text.chars().any(is_invisible_or_control)
}

/// 名前に、見える文字が 1 つ以上あるか(空白や、見えない文字だけの名前を断る)。
pub fn has_visible_character(text: &str) -> bool {
    text.chars().any(is_visible)
}

/// `session_id` がファイルパスの構築に使って安全な形式(英数字とハイフンのみ)
/// かを検証する。フロントから受け取った値をそのままパスに使わないための
/// 入力検証(native.md §4。`<フォルダ>/<id>.jsonl` 以外を指せないようにする)。
pub fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// プロジェクトフォルダ名(`~/.claude/projects/` 直下の1階層)がパスの構築に
/// 使って安全な形式かを検証する(issue #313)。フロントから受け取った値を
/// そのままパスに使わないための入力検証(native.md §4)。空・`.`・`..`・
/// パス区切り(`/` `\`)・`:`・NUL を含むものは拒否する。`:` は、Windows では `dir.join("C:x")` が
/// ドライブ指定付きのパスと解釈され、`dir` の外を指してしまうため(Claude Code のフォルダ名は
/// `:` を `-` に置き換えているので、正しい名前には現れない)。
pub fn is_valid_project_dir_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '\0'))
}

/// ルールファイル名がパスの構築に使って安全な形式かを検証する。フロントから
/// 受け取った値をそのままパスに使わないための入力検証(native.md §4)。
/// パス区切り(`/` `\`)・`..` を含まず、`.md` で終わる単一セグメントのみ
/// 許可する。これにより `<repo_dir>/.claude/rules/<file_name>` の解決先が
/// 常にそのディレクトリ配下に収まることを保証する(issue #61)。
pub fn is_valid_rule_file_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && file_name.ends_with(".md")
        && !file_name.contains('/')
        && !file_name.contains('\\')
        && !file_name.contains(':')
        && !file_name.contains('\0')
        && !file_name.contains("..")
}

/// スキル名(`.claude/skills/` 直下のディレクトリ名)がパスの構築に使って
/// 安全な形式かを検証する。`is_valid_rule_file_name` と同じ流儀だが、
/// 拡張子条件は無い(ディレクトリ名のため。issue #65)。これにより
/// `<repo_dir>/.claude/skills/<name>/SKILL.md` の解決先が常にそのディレクトリ
/// 配下に収まることを保証する。
pub fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains(':')
        && !name.contains('\0')
        && !name.contains("..")
}

/// `~/.claude` からの相対パスが、`~/.claude` 配下に収まることを保証できる
/// 形式かを検証する。フロントから受け取った値をそのままパスに使わないための
/// 入力検証(native.md §4)。空文字列はルート(`~/.claude` 自身)を表す。
/// 区切りは `/` のみとし、各セグメントは空・`.`・`..` を禁止、`\`(Windowsの
/// 区切り)・`:`(ドライブ指定・代替データストリーム)・NULを含まないこと。
/// 先頭の `/`(絶対パス)は空セグメントとして弾かれる。
pub fn is_valid_claude_dir_path(path: &str) -> bool {
    path.is_empty()
        || path.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && !segment.contains(['\\', ':', '\0'])
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_valid_json_accepts_valid_json() {
        assert!(is_valid_json(r#"{"key": "value"}"#));
    }

    #[test]
    fn is_valid_json_rejects_malformed_json() {
        assert!(!is_valid_json(r#"{"key": "value""#));
    }

    #[test]
    fn is_valid_json_rejects_empty_string() {
        assert!(!is_valid_json(""));
    }

    #[test]
    fn is_valid_session_id_accepts_uuid_shaped_strings() {
        assert!(is_valid_session_id("a36bcf64-6d83-4043-a1e5-e9eecd3bba80"));
    }

    #[test]
    fn is_valid_session_id_rejects_empty_string() {
        assert!(!is_valid_session_id(""));
    }

    #[test]
    fn is_valid_session_id_rejects_path_traversal_attempts() {
        for bad in ["../../etc/passwd", "a/b", "a\\b", "a.jsonl", "a b"] {
            assert!(!is_valid_session_id(bad), "should reject {bad:?}");
        }
    }

    #[test]
    fn is_valid_project_dir_name_accepts_claude_code_folder_names() {
        for good in ["C--Users-yanqi-prj-yaoyorozu", "-home-user-proj", "a.b"] {
            assert!(is_valid_project_dir_name(good), "should accept {good:?}");
        }
    }

    #[test]
    fn is_valid_project_dir_name_rejects_path_traversal_attempts() {
        for bad in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            "../x",
            "a\0b",
            "C:",
            "C:x",
            "D:foo",
            "a:b",
            "x::$INDEX_ALLOCATION",
        ] {
            assert!(!is_valid_project_dir_name(bad), "should reject {bad:?}");
        }
    }

    #[test]
    fn is_valid_rule_file_name_accepts_plain_md_file_names() {
        for good in ["native.md", "web.md", "a-b_c.md"] {
            assert!(is_valid_rule_file_name(good), "should accept {good:?}");
        }
    }

    #[test]
    fn is_valid_rule_file_name_rejects_path_traversal_and_non_md() {
        for bad in [
            "",
            "../native.md",
            "../../etc/passwd.md",
            "a/native.md",
            "a\\native.md",
            "/etc/passwd.md",
            "native.txt",
            "native.md.txt",
            "..md",
            "C:x.md",
            "C:native.md",
            "a\0.md",
            "x.md::$DATA.md",
        ] {
            assert!(!is_valid_rule_file_name(bad), "should reject {bad:?}");
        }
    }

    #[test]
    fn is_valid_skill_name_accepts_plain_directory_names() {
        for good in ["release", "code-review", "a_b"] {
            assert!(is_valid_skill_name(good), "should accept {good:?}");
        }
    }

    #[test]
    fn is_valid_skill_name_rejects_path_traversal() {
        for bad in [
            "",
            "..",
            "../etc",
            "../../etc/passwd",
            "a/b",
            "a\\b",
            "/etc",
            "C:",
            "C:x",
            "a:b",
            "a\0b",
        ] {
            assert!(!is_valid_skill_name(bad), "should reject {bad:?}");
        }
    }

    #[test]
    fn is_valid_claude_dir_path_accepts_root_and_relative_paths() {
        assert!(is_valid_claude_dir_path(""));
        assert!(is_valid_claude_dir_path("projects"));
        assert!(is_valid_claude_dir_path("projects/C--Users-foo/abc.jsonl"));
        assert!(is_valid_claude_dir_path(".credentials.json"));
        assert!(is_valid_claude_dir_path("plugins/..hidden"));
    }

    #[test]
    fn is_valid_claude_dir_path_rejects_paths_that_may_escape() {
        for path in [
            "..",
            "../x",
            "projects/..",
            "projects/../..",
            ".",
            "./projects",
            "/",
            "/etc",
            "projects/",
            "a//b",
            "C:",
            "C:/Windows",
            "a\\b",
            "..\\x",
            "file:stream",
            "a\0b",
        ] {
            assert!(
                !is_valid_claude_dir_path(path),
                "{path:?} should be rejected"
            );
        }
    }
}
