//! セッションのタイトル表示に関わる、特定の型に属さない純粋関数(native.md
//! §1: 型に属さない関数は機能別ファイルにまとめる)。

/// 表示用に文字列を切り詰める。長い本文を一覧にそのまま出さないため。
pub fn excerpt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(max_chars).collect();
        format!("{truncated}…")
    }
}

/// セッションのタイトルを決める。優先順位: 最後の `custom-title`(空文字は
/// 無視)→ 先頭のユーザーメッセージの冒頭(40文字程度に省略)→
/// セッションIDの先頭8桁(issue #33)。
pub fn resolve_session_title(
    last_custom_title: Option<&str>,
    first_user_message: Option<&str>,
    session_id: &str,
) -> String {
    if let Some(title) = last_custom_title {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(text) = first_user_message {
        let trimmed = excerpt(text, 40);
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    session_id.chars().take(8).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excerpt_returns_trimmed_text_when_within_limit() {
        assert_eq!(excerpt("  hello  ", 10), "hello");
    }

    #[test]
    fn excerpt_truncates_and_appends_ellipsis_when_over_limit() {
        assert_eq!(excerpt("hello world", 5), "hello…");
    }

    #[test]
    fn resolve_session_title_prefers_custom_title() {
        let title = resolve_session_title(Some("会話タイトル"), Some("hello"), "abcdef01-…");
        assert_eq!(title, "会話タイトル");
    }

    #[test]
    fn resolve_session_title_ignores_blank_custom_title() {
        let title = resolve_session_title(Some("   "), Some("hello"), "abcdef01-…");
        assert_eq!(title, "hello");
    }

    #[test]
    fn resolve_session_title_falls_back_to_first_user_message_excerpt() {
        let long_text = "a".repeat(60);
        let title = resolve_session_title(None, Some(&long_text), "abcdef01-…");
        assert_eq!(title, format!("{}…", "a".repeat(40)));
    }

    #[test]
    fn resolve_session_title_falls_back_to_session_id_prefix_when_nothing_else() {
        let title = resolve_session_title(None, None, "abcdef0123456789");
        assert_eq!(title, "abcdef01");
    }
}
