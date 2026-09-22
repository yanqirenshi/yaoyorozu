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

/// `session_id` がファイルパスの構築に使って安全な形式(英数字とハイフンのみ)
/// かを検証する。フロントから受け取った値をそのままパスに使わないための
/// 入力検証(native.md §4。`<フォルダ>/<id>.jsonl` 以外を指せないようにする)。
pub fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// プロジェクトフォルダ名(`~/.claude/projects/` 直下の1階層)がパスの構築に
/// 使って安全な形式かを検証する(issue #313)。フロントから受け取った値を
/// そのままパスに使わないための入力検証(native.md §4)。空・`.`・`..`・
/// パス区切り(`/` `\`)・NUL を含むものは拒否する。
pub fn is_valid_project_dir_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.chars().any(|c| c == '/' || c == '\\' || c == '\0')
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
        && !file_name.contains("..")
}

/// スキル名(`.claude/skills/` 直下のディレクトリ名)がパスの構築に使って
/// 安全な形式かを検証する。`is_valid_rule_file_name` と同じ流儀だが、
/// 拡張子条件は無い(ディレクトリ名のため。issue #65)。これにより
/// `<repo_dir>/.claude/skills/<name>/SKILL.md` の解決先が常にそのディレクトリ
/// 配下に収まることを保証する。
pub fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
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
        for bad in ["", ".", "..", "a/b", "a\\b", "../x", "a\0b"] {
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
