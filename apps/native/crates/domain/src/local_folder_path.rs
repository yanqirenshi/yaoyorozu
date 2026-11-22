use std::path::{Path, PathBuf};

/// このマシンのローカルドライブ上のフォルダを指す、検証済みのパス(`C:\repo` のような形)。
///
/// 設定に保存するパス(対象リポジトリ・セッションのルート)と、画面の「パスの確認」が、**同じ規則**で
/// 判定するための型(判定が食い違わないように、規則はここ 1 か所に置く)。クライアントから受け取った
/// 文字列を、そのままファイルの読み書きに使わないための入力検証(native.md §4・§7)でもある。
///
/// 受け付けるのは次の形だけ:
/// - `X:\…` または `X:/…`(`X` は英字 1 文字のドライブ)。`:` はこのドライブ文字の 1 つだけ。
/// - 制御文字(改行・NUL・タブなど)を含まない。
/// - `..` の要素を含まない。
/// - Windows の予約デバイス名(`CON`・`NUL`・`COM1` など)の要素を含まない。
///
/// 断るもの: 相対パス、ドライブ無しの `\…`、ドライブ相対(`C:x`)、UNC(`\\ホスト\共有`)、
/// デバイスの形(`\\?\`・`\\.\`・`\??\`・`GLOBALROOT`)、代替データストリーム(`name::$DATA`)。
/// このアプリは同じマシンのフォルダだけを扱う。UNC を受けると、サーバが指定の宛先へ SMB で読みに
/// 行ってしまう(応答しない宛先では 1 本あたり数十秒かかる)ため、存在の確認の前に形だけで断る。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFolderPath {
    path: PathBuf,
}

/// パスを断った理由。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalFolderPathError {
    Empty,
    TooLong,
    ControlCharacter,
    /// UNC・`\\?\`・`\\.\`・`\??\` など(ネットワークやデバイスの形)。
    NetworkOrDevice,
    /// 相対パス・ドライブ無し・ドライブ相対(`C:x`)。
    NotDriveAbsolute,
    /// ドライブ文字以外の `:`(代替データストリームなど)。
    ExtraColon,
    /// Windows のパスに使えない文字(`< > " | ? *`)。`C:\?\x` のような途中のデバイスの形もここで断る。
    InvalidCharacter,
    ParentDirectory,
    /// `.`・`...`・`.. ` のような、点と空白だけの要素(Windows は末尾の点・空白を落とすので `..` になる)。
    DotsOnlyComponent,
    ReservedDeviceName,
}

impl LocalFolderPathError {
    /// 画面にそのまま出せるメッセージ。
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "パスを入力してください",
            Self::TooLong => "パスが長すぎます",
            Self::ControlCharacter => {
                "パスに制御文字(改行など)・見えない文字(ゼロ幅・向きを変える文字)を含めることはできません"
            }
            Self::InvalidCharacter => "パスに使えない文字(< > \" | ? *)を含んでいます",
            Self::DotsOnlyComponent => "「.」「...」など、点だけの名前は使えません",
            Self::NetworkOrDevice => {
                "ネットワークパス(\\\\ホスト\\…)・デバイスの形(\\\\?\\ など)は使えません。このマシンのドライブ上のフォルダを指定してください"
            }
            Self::NotDriveAbsolute => {
                "ドライブ付きの絶対パス(例: C:\\Users\\you\\prj\\repo)で入力してください"
            }
            Self::ExtraColon => "ドライブ文字以外に「:」を含めることはできません",
            Self::ParentDirectory => "「..」を含むパスは使えません",
            Self::ReservedDeviceName => "予約されたデバイス名(CON・NUL・COM1 など)は使えません",
        }
    }
}

/// パスの長さの上限(文字数)。
const MAX_LEN: usize = 1024;

fn is_separator(c: char) -> bool {
    c == '\\' || c == '/'
}

/// `CON`・`NUL`・`COM1`・`COM¹`(上付き数字も予約)・`CONIN$`・`CONOUT$`…(拡張子付きも)。
fn is_reserved_device_name(component: &str) -> bool {
    let base = component
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_uppercase();
    if matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    // COM0〜COM9・LPT0〜LPT9(`¹`・`²`・`³` も)。
    let numbered = base
        .strip_prefix("COM")
        .or_else(|| base.strip_prefix("LPT"));
    numbered.is_some_and(|rest| {
        let mut it = rest.chars();
        matches!(
            (it.next(), it.next()),
            (Some('0'..='9' | '¹' | '²' | '³'), None)
        )
    })
}

impl LocalFolderPath {
    /// 文字列を検証してパスにする。前後の空白は落とす。
    pub fn parse(raw: &str) -> Result<Self, LocalFolderPathError> {
        use LocalFolderPathError as E;
        let text = raw.trim();
        if text.is_empty() {
            return Err(E::Empty);
        }
        if text.chars().count() > MAX_LEN {
            return Err(E::TooLong);
        }
        if crate::contains_forbidden_invisible_or_control(text) {
            return Err(E::ControlCharacter);
        }
        let chars: Vec<char> = text.chars().collect();
        // UNC・デバイス(`\\host`・`//host`・`\\?\`・`\\.\`・`\??\`)。先頭の区切りが 2 つ、または `\??\`。
        if chars.len() >= 2 && is_separator(chars[0]) && is_separator(chars[1]) {
            return Err(E::NetworkOrDevice);
        }
        if text.starts_with("\\??\\") || text.to_ascii_uppercase().contains("GLOBALROOT") {
            return Err(E::NetworkOrDevice);
        }
        // `X:\` または `X:/` で始まること。
        let drive_ok = chars.len() >= 3
            && chars[0].is_ascii_alphabetic()
            && chars[1] == ':'
            && is_separator(chars[2]);
        if !drive_ok {
            return Err(E::NotDriveAbsolute);
        }
        let rest = &text[2..];
        if rest.contains(':') {
            return Err(E::ExtraColon);
        }
        // Windows のパスに使えない文字。`C:\\?\x` のような、途中に現れるデバイスの形もここで断る。
        if rest.contains(['<', '>', '"', '|', '?', '*']) {
            return Err(E::InvalidCharacter);
        }
        for component in rest.split(is_separator) {
            if component == ".." {
                return Err(E::ParentDirectory);
            }
            // 末尾の点・空白は Windows が落とす(`.. ` や `...` は `..` になる)。点と空白だけの要素は断る。
            if !component.is_empty() && component.trim_end_matches(['.', ' ']).is_empty() {
                return Err(E::DotsOnlyComponent);
            }
            if is_reserved_device_name(component) {
                return Err(E::ReservedDeviceName);
            }
        }
        Ok(Self {
            path: PathBuf::from(text),
        })
    }

    pub fn as_path(&self) -> &Path {
        &self.path
    }

    pub fn into_path_buf(self) -> PathBuf {
        self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_drive_absolute_paths() {
        for good in [
            r"C:\Users\you\prj\repo",
            "C:/Users/you/prj/repo",
            r"d:\x",
            r"C:\",
            r"  C:\repo  ",
            r"C:\日本語\フォルダ",
            r"C:\a.b\c-d_e",
            r"C:\repo\.git",
        ] {
            assert!(
                LocalFolderPath::parse(good).is_ok(),
                "should accept {good:?}"
            );
        }
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let p = LocalFolderPath::parse("  C:\\repo \t").unwrap();
        assert_eq!(p.as_path(), Path::new(r"C:\repo"));
    }

    #[test]
    fn rejects_empty_and_too_long() {
        assert_eq!(
            LocalFolderPath::parse("").unwrap_err(),
            LocalFolderPathError::Empty
        );
        assert_eq!(
            LocalFolderPath::parse("   ").unwrap_err(),
            LocalFolderPathError::Empty
        );
        let long = format!("C:\\{}", "a".repeat(2000));
        assert_eq!(
            LocalFolderPath::parse(&long).unwrap_err(),
            LocalFolderPathError::TooLong
        );
    }

    #[test]
    fn rejects_relative_and_drive_relative_paths() {
        for bad in [
            "repo",
            r"repo\x",
            r".\repo",
            "..",
            r"\repo",
            "/repo",
            "C:",
            "C:x",
            r"C:repo\x",
            "1:\\x",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::NotDriveAbsolute,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn rejects_unc_and_device_forms_by_shape() {
        for bad in [
            r"\\host\share\x",
            "//host/share/x",
            r"\\?\C:\repo",
            r"\\.\C:\repo",
            r"\\?\UNC\host\share",
            r"\??\C:\repo",
            r"\\?\GLOBALROOT\Device\HarddiskVolume1",
            r"C:\x\GLOBALROOT",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::NetworkOrDevice,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn rejects_extra_colons_and_alternate_data_streams() {
        for bad in [
            r"C:\repo::$INDEX_ALLOCATION",
            r"C:\repo:stream",
            r"C:\a:b\c",
            r"C:\repo::$DATA",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::ExtraColon,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn rejects_control_characters_including_newlines_and_nul() {
        for bad in [
            "C:\\repo\nx",
            "C:\\repo\r\nx",
            "C:\\re\0po",
            "C:\\re\tpo",
            "C:\\a\u{7}b",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::ControlCharacter,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn rejects_parent_directory_components() {
        for bad in [r"C:\a\..\b", r"C:\..", "C:/a/../b", r"C:\a\..\..\Windows"] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::ParentDirectory,
                "{bad:?}"
            );
        }
        // `..` を名前の一部に持つだけなら通る。
        assert!(LocalFolderPath::parse(r"C:\a..b\c").is_ok());
    }

    #[test]
    fn rejects_reserved_device_names() {
        for bad in [
            r"C:\CON",
            r"C:\x\nul",
            r"C:\a\COM1",
            r"C:\LPT9.txt",
            r"C:\aux.log",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::ReservedDeviceName,
                "{bad:?}"
            );
        }
        assert!(LocalFolderPath::parse(r"C:\console\COM10").is_ok());
    }

    #[test]
    fn rejects_superscript_com_lpt_and_console_devices() {
        for bad in [
            "C:\\a\\COM\u{b9}",
            "C:\\a\\com\u{b2}.txt",
            "C:\\a\\LPT\u{b3}",
            "C:\\a\\COM1",
            r"C:\a\COM0",
            r"C:\a\lpt0.txt",
            r"C:\a\CONIN$",
            r"C:\a\conout$",
            r"C:\a\CONIN$.txt",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::ReservedDeviceName,
                "{bad:?}"
            );
        }
        // 予約名に見えて、そうでないもの。
        for good in [
            r"C:\a\COM10",
            r"C:\a\COMX",
            r"C:\a\CONINX",
            "C:\\a\\COM\u{2074}",
        ] {
            assert!(LocalFolderPath::parse(good).is_ok(), "{good:?}");
        }
    }

    #[test]
    fn rejects_device_forms_in_the_middle_and_other_invalid_characters() {
        for bad in [
            r"C:\\?\x",
            r"C:\a\?\x",
            r"C:\a\b*",
            r"C:\a<b",
            r"C:\a>b",
            "C:\\a\"b",
            r"C:\a|b",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::InvalidCharacter,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn rejects_components_made_only_of_dots_and_spaces() {
        for bad in [
            r"C:\a\.\b",
            r"C:\a\...\b",
            "C:\\a\\.. \\b",
            "C:\\a\\. \\b",
            r"C:\a\....",
            "C:\\a\\ \\b",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::DotsOnlyComponent,
                "{bad:?}"
            );
        }
        // `..` そのものは別の理由(親のフォルダ)で断る。名前の一部に点があるだけなら通る。
        assert_eq!(
            LocalFolderPath::parse(r"C:\a\..\b").unwrap_err(),
            LocalFolderPathError::ParentDirectory
        );
        assert!(LocalFolderPath::parse(r"C:\a.b\.git\c...d").is_ok());
    }

    #[test]
    fn rejects_invisible_and_direction_changing_characters_by_unicode_property() {
        for c in [
            '\u{200B}',
            '\u{200E}',
            '\u{200F}',
            '\u{202A}',
            '\u{202B}',
            '\u{202C}',
            '\u{202D}',
            '\u{202E}',
            '\u{2060}',
            '\u{2063}',
            '\u{2066}',
            '\u{2069}',
            '\u{FEFF}',
            '\u{061C}',
            '\u{2028}',
            '\u{2029}',
            '\u{3164}',
            '\u{115F}',
            '\u{1160}',
            '\u{FFA0}',
            '\u{00AD}',
            '\u{034F}',
            '\u{180E}',
            '\u{E0041}',
        ] {
            let path = format!("C:\\repo{c}x\\y");
            assert_eq!(
                LocalFolderPath::parse(&path).unwrap_err(),
                LocalFolderPathError::ControlCharacter,
                "U+{:04X}",
                c as u32
            );
        }
        // 見える日本語・絵文字などは通る。
        assert!(LocalFolderPath::parse("C:\\日本語\\フォルダ\\😀").is_ok());
    }

    #[test]
    fn zwj_and_zwnj_are_allowed_only_between_visible_characters() {
        // 絵文字の結合・ZWNJ を使う言語の名前は通す。
        for ok in [
            "C:\\work\\👨\u{200D}💻",
            "C:\\work\\\u{2764}\u{FE0F}\u{200D}🔥",
            "C:\\work\\می\u{200C}خواهم",
            "C:\\work\\a\u{FE0F}b",
        ] {
            assert!(LocalFolderPath::parse(ok).is_ok(), "{ok:?}");
        }
        // 前後に見える文字が無い(区切り・空白・端の)ZWJ・ZWNJ・異体字セレクタは断る。
        for bad in [
            "C:\\work\\\u{200D}a",
            "C:\\work\\a\u{200D}",
            "C:\\work\\a\u{200D}\\b",
            "C:\\work\\a \u{200D}b",
            "C:\\work\\a\u{200C}\u{200C}b",
            "C:\\work\\\u{FE0F}a",
            "C:\\work\\ \u{FE0F}a",
        ] {
            assert_eq!(
                LocalFolderPath::parse(bad).unwrap_err(),
                LocalFolderPathError::ControlCharacter,
                "{bad:?}"
            );
        }
    }
}
