//! `claude` CLI の版の判定(issue #437。Phase 3。PoC #429 レポート §6)。
//!
//! セッション間メッセージ(`ListAgents` / `SendMessage` と受信口)は CLI 2.1.268 以降で使える
//! (Lab が実測。PoC #429 レポート §6)。それより古い版(PATH の 2.1.150 など)には機能自体が無く、
//! 一覧に出ず、送っても「見つからない」になる。app は起動前に版を読み、古ければその旨を状態バー
//! (と一覧項目)に出す
//! (起動は止めない。会話の対話そのものは古い版でも使える)。

/// セッション間メッセージが使える最小の版(`major.minor.patch`)。
pub const MIN_PEER_MESSAGING_VERSION: (u32, u32, u32) = (2, 1, 268);

/// `claude --version` の出力(`2.1.150 (Claude Code)` など)から版を取り出す。数字の
/// 並び(`major.minor.patch`)が先頭に無ければ `None`。
pub fn parse_cli_version(text: &str) -> Option<(u32, u32, u32)> {
    let token = text.split_whitespace().next()?;
    let mut parts = token.trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some((major, minor, patch))
}

/// `claude --version` の出力が、セッション間メッセージに対応した版か。読めない版は
/// `None`(分からない。警告は出さない)。
pub fn supports_peer_messaging(version_text: &str) -> Option<bool> {
    parse_cli_version(version_text).map(|version| version >= MIN_PEER_MESSAGING_VERSION)
}

/// 対応していない版のときの、画面に出す説明(対応している・分からないときは `None`)。
pub fn peer_messaging_warning(version_text: &str) -> Option<String> {
    (supports_peer_messaging(version_text) == Some(false)).then(|| {
        let (major, minor, patch) = MIN_PEER_MESSAGING_VERSION;
        format!(
            "この claude(版 {})は、セッション間メッセージに対応していません({major}.{minor}.{patch} 以上が必要)。会話の対話は使えます",
            version_text.split_whitespace().next().unwrap_or("?")
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_read_from_the_head_of_the_version_output() {
        assert_eq!(
            parse_cli_version("2.1.150 (Claude Code)"),
            Some((2, 1, 150))
        );
        assert_eq!(parse_cli_version("2.1.280"), Some((2, 1, 280)));
        assert_eq!(parse_cli_version("v2.2.0\n"), Some((2, 2, 0)));
    }

    #[test]
    fn an_unreadable_version_is_unknown() {
        for text in ["", "claude", "2.1", "a.b.c", "not a version"] {
            assert_eq!(parse_cli_version(text), None, "{text:?}");
            assert_eq!(supports_peer_messaging(text), None, "{text:?}");
            assert_eq!(peer_messaging_warning(text), None, "{text:?}");
        }
    }

    #[test]
    fn versions_below_2_1_268_do_not_support_peer_messaging() {
        assert_eq!(
            supports_peer_messaging("2.1.150 (Claude Code)"),
            Some(false)
        );
        assert_eq!(supports_peer_messaging("2.1.267"), Some(false));
        assert_eq!(supports_peer_messaging("1.9.999"), Some(false));
    }

    #[test]
    fn versions_from_2_1_268_support_peer_messaging() {
        assert_eq!(supports_peer_messaging("2.1.268"), Some(true));
        assert_eq!(supports_peer_messaging("2.1.269 (Claude Code)"), Some(true));
        assert_eq!(supports_peer_messaging("2.2.0"), Some(true));
        assert_eq!(supports_peer_messaging("3.0.0"), Some(true));
    }

    #[test]
    fn the_warning_names_the_version_and_the_required_one_only_when_unsupported() {
        let warning = peer_messaging_warning("2.1.150 (Claude Code)").unwrap();

        assert!(warning.contains("2.1.150"));
        assert!(warning.contains("2.1.268"));
        assert_eq!(peer_messaging_warning("2.1.268 (Claude Code)"), None);
    }
}
