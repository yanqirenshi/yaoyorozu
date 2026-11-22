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
            Self::ControlCharacter => "プロファイル名に改行などの制御文字を含めることはできません",
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
        if trimmed.chars().any(char::is_control) {
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
