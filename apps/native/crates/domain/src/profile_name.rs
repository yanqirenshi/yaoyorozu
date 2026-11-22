/// プロファイルの表示名(検証済み)。
///
/// 前後の空白は落とし、空・上限(100 文字)超え・制御文字(改行・NUL・タブなど)を含むものは断る。
/// 作成(`create_profile`)と改名(`rename_profile`)が同じ規則で判定するために、規則はここ 1 か所に置く。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileName(String);

/// 名前を断った理由。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileNameError {
    Empty,
    TooLong,
    ControlCharacter,
}

impl ProfileNameError {
    /// 画面にそのまま出せるメッセージ。
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "プロファイル名を入力してください",
            Self::TooLong => "プロファイル名は 100 文字以内で入力してください",
            Self::ControlCharacter => {
                "プロファイル名に制御文字(改行など)・見えない文字(ゼロ幅・向きを変える文字)を含めることはできません"
            }
        }
    }
}

/// 名前の長さの上限(文字数)。
pub const MAX_PROFILE_NAME_CHARS: usize = 100;

impl ProfileName {
    pub fn parse(raw: &str) -> Result<Self, ProfileNameError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ProfileNameError::Empty);
        }
        if crate::contains_forbidden_invisible_or_control(trimmed) {
            return Err(ProfileNameError::ControlCharacter);
        }
        if trimmed.chars().count() > MAX_PROFILE_NAME_CHARS {
            return Err(ProfileNameError::TooLong);
        }
        Ok(Self(trimmed.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_surrounding_whitespace_and_keeps_inner_spaces() {
        assert_eq!(
            ProfileName::parse("  my profile  ").unwrap().as_str(),
            "my profile"
        );
        assert_eq!(
            ProfileName::parse("全角　スペース").unwrap().as_str(),
            "全角　スペース"
        );
    }

    #[test]
    fn rejects_empty_after_trimming() {
        for bad in ["", "   ", "\u{3000}", " \t "] {
            // 全角スペース・タブだけも、トリム後は空。
            assert_eq!(
                ProfileName::parse(bad).unwrap_err(),
                ProfileNameError::Empty,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn rejects_control_characters_inside_the_name() {
        for bad in ["a\nb", "a\r\nb", "a\0b", "a\tb", "\u{7}bell", "a\u{1b}[0m"] {
            assert_eq!(
                ProfileName::parse(bad).unwrap_err(),
                ProfileNameError::ControlCharacter,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn rejects_zero_width_and_bidirectional_control_characters() {
        for bad in [
            "\u{200B}",
            "a\u{200B}b",
            "名前\u{200D}",
            "\u{202E}gpj.exe",
            "a\u{2066}b",
            "\u{2060}x",
            "\u{FEFF}name",
            // 範囲の並べ書きでは抜けていた文字(Unicode の性質で断る)。
            "a\u{061C}b",
            "a\u{2028}b",
            "a\u{2029}b",
            "\u{3164}",
            "名\u{3164}前",
            "a\u{115F}b",
            "a\u{1160}b",
            "a\u{FFA0}b",
            "a\u{00AD}b",
            "a\u{034F}b",
            "a\u{E0041}b",
            // 前後に見える文字が無い ZWJ・ZWNJ・異体字セレクタ。
            "\u{200D}a",
            "a\u{200C} b",
            "\u{FE0F}a",
        ] {
            assert_eq!(
                ProfileName::parse(bad).unwrap_err(),
                ProfileNameError::ControlCharacter,
                "{bad:?}"
            );
        }
        // 見える文字(絵文字・結合文字を含む日本語)は通る。
        assert!(ProfileName::parse("開発 😀 café").is_ok());
    }

    #[test]
    fn allows_zwj_emoji_and_zwnj_language_names() {
        for ok in [
            "👨\u{200D}💻 開発",
            "\u{2764}\u{FE0F}\u{200D}🔥",
            "می\u{200C}خواهم",
            "\u{263A}\u{FE0F}",
            "👩\u{200D}👩\u{200D}👧",
        ] {
            assert!(ProfileName::parse(ok).is_ok(), "{ok:?}");
        }
    }

    #[test]
    fn a_name_without_any_visible_character_is_refused() {
        // 空白だけは、トリム後は空。見えない文字だけは、見えない文字として断る。
        assert_eq!(
            ProfileName::parse(" \u{3000} ").unwrap_err(),
            ProfileNameError::Empty
        );
        assert!(ProfileName::parse("\u{3164}\u{200B}").is_err());
    }

    #[test]
    fn enforces_the_length_limit_in_characters_not_bytes() {
        let exactly = "あ".repeat(MAX_PROFILE_NAME_CHARS);
        assert!(ProfileName::parse(&exactly).is_ok());
        let over = "あ".repeat(MAX_PROFILE_NAME_CHARS + 1);
        assert_eq!(
            ProfileName::parse(&over).unwrap_err(),
            ProfileNameError::TooLong
        );
    }
}
