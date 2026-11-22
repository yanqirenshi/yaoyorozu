use base64::{engine::general_purpose::STANDARD, Engine};
use std::fmt;

/// 1回の送信に添付できる画像の最大枚数(issue #349)。
///
/// 根拠(Anthropic 公式 Vision ドキュメント。2026-09-24 確認):
/// 枚数そのものの上限は API 100枚(200kコンテキストのモデル)・claude.ai 20枚/回だが、
/// 実際に先に効くのは**リクエスト全体 32MB**の上限。1枚の上限(下の
/// [`MAX_IMAGE_BASE64_LEN`])と掛け合わせて 5枚 × 5,000,000 = 25MB とし、本文・会話
/// 履歴(画像は毎ターン再送される)の分の余裕(約7MB)を残す。
pub const MAX_IMAGES_PER_MESSAGE: usize = 5;

/// 1枚あたりの上限(**base64エンコード後**の文字数)。
///
/// 根拠(同上): 1枚あたりの上限は API 直が 10MB(base64)、Amazon Bedrock / Google
/// Cloud 経由が 5MB(base64)、claude.ai が 10MB。どの経路でも通る最小値の 5MB を、
/// 1MB=1,000,000 とする側(小さい方)に丸めて 5,000,000 とした。元のバイト数では
/// 約3.75MB。
pub const MAX_IMAGE_BASE64_LEN: usize = 5_000_000;

/// 添付できる画像の形式。中身(マジックナンバー)から判定する(拡張子や
/// クライアントが申告した MIME は信用しない)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageMediaType {
    Png,
    Jpeg,
    Gif,
    Webp,
}

impl ImageMediaType {
    pub fn as_mime(&self) -> &'static str {
        match self {
            ImageMediaType::Png => "image/png",
            ImageMediaType::Jpeg => "image/jpeg",
            ImageMediaType::Gif => "image/gif",
            ImageMediaType::Webp => "image/webp",
        }
    }

    /// MIME 文字列から対応形式を引く。対応外は `None`(会話ログの画像ブロックを
    /// 表示用に取り出すときの許可リストにも使う)。
    pub fn from_mime(mime: &str) -> Option<Self> {
        match mime {
            "image/png" => Some(ImageMediaType::Png),
            "image/jpeg" => Some(ImageMediaType::Jpeg),
            "image/gif" => Some(ImageMediaType::Gif),
            "image/webp" => Some(ImageMediaType::Webp),
            _ => None,
        }
    }

    /// 先頭バイト列(マジックナンバー)から形式を判定する。
    fn detect(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
            Some(ImageMediaType::Png)
        } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(ImageMediaType::Jpeg)
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            Some(ImageMediaType::Gif)
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(ImageMediaType::Webp)
        } else {
            None
        }
    }
}

/// 検証済みの添付画像。`data_base64` は検証に使った元の文字列をそのまま持つ
/// (送信時に再エンコードしない)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageAttachment {
    pub media_type: ImageMediaType,
    pub data_base64: String,
}

/// 添付画像の検証エラー。`Display` はそのままユーザー向けの理由になる。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageAttachmentError {
    Empty,
    InvalidBase64,
    UnsupportedFormat,
    TooLarge { base64_len: usize, max: usize },
    TooMany { count: usize, max: usize },
}

impl fmt::Display for ImageAttachmentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ImageAttachmentError::Empty => write!(f, "画像データが空です"),
            ImageAttachmentError::InvalidBase64 => write!(f, "画像データを読み取れませんでした"),
            ImageAttachmentError::UnsupportedFormat => write!(
                f,
                "対応していない画像形式です(PNG / JPEG / GIF / WebP のみ添付できます)"
            ),
            ImageAttachmentError::TooLarge { base64_len, max } => write!(
                f,
                "画像のサイズが上限を超えています(約{:.1}MB。上限は約{:.1}MB)",
                decoded_megabytes(*base64_len),
                decoded_megabytes(*max)
            ),
            ImageAttachmentError::TooMany { max, .. } => {
                write!(f, "画像は1回の送信に{max}枚までです")
            }
        }
    }
}

/// base64 の文字数から元のバイト数(MB)の概算を求める(表示用)。
fn decoded_megabytes(base64_len: usize) -> f64 {
    base64_len as f64 * 0.75 / 1_000_000.0
}

/// 添付を1枚追加した結果が枚数上限を超えないかを検証する。`count` は追加後の枚数。
pub fn validate_image_count(count: usize) -> Result<(), ImageAttachmentError> {
    if count > MAX_IMAGES_PER_MESSAGE {
        return Err(ImageAttachmentError::TooMany {
            count,
            max: MAX_IMAGES_PER_MESSAGE,
        });
    }
    Ok(())
}

/// 1枚の画像(base64、`data:` プレフィックス無し)を検証する。サイズ → base64 として
/// 妥当か → 形式(中身のマジックナンバー)の順に調べ、大きすぎるデータをデコード
/// する前に弾く。
pub fn validate_image_attachment(
    data_base64: &str,
) -> Result<ImageAttachment, ImageAttachmentError> {
    if data_base64.is_empty() {
        return Err(ImageAttachmentError::Empty);
    }
    if data_base64.len() > MAX_IMAGE_BASE64_LEN {
        return Err(ImageAttachmentError::TooLarge {
            base64_len: data_base64.len(),
            max: MAX_IMAGE_BASE64_LEN,
        });
    }
    let bytes = STANDARD
        .decode(data_base64)
        .map_err(|_| ImageAttachmentError::InvalidBase64)?;
    let media_type =
        ImageMediaType::detect(&bytes).ok_or(ImageAttachmentError::UnsupportedFormat)?;
    Ok(ImageAttachment {
        media_type,
        data_base64: data_base64.to_string(),
    })
}

/// 送信する全画像を検証する(枚数 → 各画像)。1枚でも違反があれば全体をエラーにする。
pub fn validate_image_attachments(
    images: &[String],
) -> Result<Vec<ImageAttachment>, ImageAttachmentError> {
    validate_image_count(images.len())?;
    images
        .iter()
        .map(|data| validate_image_attachment(data))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(bytes: &[u8]) -> String {
        STANDARD.encode(bytes)
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F'];
    const GIF: &[u8] = b"GIF89a\x01\x00\x01\x00";
    const WEBP: &[u8] = b"RIFF\x24\x00\x00\x00WEBPVP8 ";

    #[test]
    fn detects_each_supported_format_from_its_magic_number() {
        assert_eq!(
            validate_image_attachment(&b64(PNG)).unwrap().media_type,
            ImageMediaType::Png
        );
        assert_eq!(
            validate_image_attachment(&b64(JPEG)).unwrap().media_type,
            ImageMediaType::Jpeg
        );
        assert_eq!(
            validate_image_attachment(&b64(GIF)).unwrap().media_type,
            ImageMediaType::Gif
        );
        assert_eq!(
            validate_image_attachment(&b64(WEBP)).unwrap().media_type,
            ImageMediaType::Webp
        );
    }

    #[test]
    fn keeps_the_original_base64_string() {
        let data = b64(PNG);
        assert_eq!(validate_image_attachment(&data).unwrap().data_base64, data);
    }

    #[test]
    fn rejects_unsupported_formats() {
        // BMP・テキスト・RIFFだがWEBPではないもの(WAV)。
        for bytes in [
            &b"BM\x00\x00\x00\x00"[..],
            b"hello world!",
            b"RIFF\x00\x00\x00\x00WAVEfmt ",
        ] {
            assert_eq!(
                validate_image_attachment(&b64(bytes)),
                Err(ImageAttachmentError::UnsupportedFormat)
            );
        }
    }

    #[test]
    fn rejects_empty_and_invalid_base64() {
        assert_eq!(
            validate_image_attachment(""),
            Err(ImageAttachmentError::Empty)
        );
        assert_eq!(
            validate_image_attachment("not base64 !!!"),
            Err(ImageAttachmentError::InvalidBase64)
        );
    }

    #[test]
    fn rejects_oversized_data_before_decoding() {
        // 上限ちょうどは通り(形式は別途)、1文字超えるとサイズ超過。
        let too_big = "A".repeat(MAX_IMAGE_BASE64_LEN + 1);
        assert_eq!(
            validate_image_attachment(&too_big),
            Err(ImageAttachmentError::TooLarge {
                base64_len: MAX_IMAGE_BASE64_LEN + 1,
                max: MAX_IMAGE_BASE64_LEN
            })
        );
        let at_limit = "A".repeat(MAX_IMAGE_BASE64_LEN);
        assert_ne!(
            validate_image_attachment(&at_limit),
            Err(ImageAttachmentError::TooLarge {
                base64_len: MAX_IMAGE_BASE64_LEN,
                max: MAX_IMAGE_BASE64_LEN
            })
        );
    }

    #[test]
    fn validates_the_count_limit() {
        assert!(validate_image_count(MAX_IMAGES_PER_MESSAGE).is_ok());
        assert_eq!(
            validate_image_count(MAX_IMAGES_PER_MESSAGE + 1),
            Err(ImageAttachmentError::TooMany {
                count: MAX_IMAGES_PER_MESSAGE + 1,
                max: MAX_IMAGES_PER_MESSAGE
            })
        );
    }

    #[test]
    fn validate_image_attachments_checks_count_then_every_image() {
        let ok = b64(PNG);
        assert_eq!(
            validate_image_attachments(&[ok.clone(), ok.clone()])
                .unwrap()
                .len(),
            2
        );

        let bad = b64(b"hello world!");
        assert_eq!(
            validate_image_attachments(&[ok.clone(), bad]),
            Err(ImageAttachmentError::UnsupportedFormat)
        );

        let too_many = vec![ok; MAX_IMAGES_PER_MESSAGE + 1];
        assert!(matches!(
            validate_image_attachments(&too_many),
            Err(ImageAttachmentError::TooMany { .. })
        ));
        assert_eq!(validate_image_attachments(&[]).unwrap(), vec![]);
    }

    #[test]
    fn error_messages_state_the_reason() {
        assert!(ImageAttachmentError::UnsupportedFormat
            .to_string()
            .contains("PNG"));
        let too_large = ImageAttachmentError::TooLarge {
            base64_len: 8_000_000,
            max: MAX_IMAGE_BASE64_LEN,
        }
        .to_string();
        assert!(
            too_large.contains("6.0MB") && too_large.contains("3.8MB"),
            "{too_large}"
        );
        assert!(ImageAttachmentError::TooMany { count: 6, max: 5 }
            .to_string()
            .contains("5枚"));
    }

    #[test]
    fn from_mime_only_accepts_supported_types() {
        assert_eq!(
            ImageMediaType::from_mime("image/png"),
            Some(ImageMediaType::Png)
        );
        assert_eq!(ImageMediaType::from_mime("image/svg+xml"), None);
        assert_eq!(ImageMediaType::from_mime("text/html"), None);
    }
}
