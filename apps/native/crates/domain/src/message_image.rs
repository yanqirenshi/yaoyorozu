use crate::session_line::SessionLine;
use crate::ImageMediaType;

/// 会話ログの1行(user 行)に含まれる画像1枚(issue #349)。ビューアが
/// 「画像 n 枚」を押したときに、その行の画像だけをオンデマンドで取り出すために使う
/// (メッセージ一覧には画像本体を載せない)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageImage {
    pub media_type: ImageMediaType,
    pub data_base64: String,
}

/// 会話ログの生の1行から、表示できる画像(base64 ソース・対応形式)を記録順に
/// 取り出す。user 行以外・JSON として読めない行・画像の無い行は空。
pub fn extract_message_images(raw_line: &str) -> Vec<MessageImage> {
    match serde_json::from_str::<SessionLine>(raw_line) {
        Ok(SessionLine::User(line)) => line
            .base64_images()
            .into_iter()
            .map(|(media_type, data)| MessageImage {
                media_type,
                data_base64: data.to_string(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_images_in_recorded_order_and_skips_non_images() {
        let line = r#"{"type":"user","uuid":"u1","message":{"role":"user","content":[
            {"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}},
            {"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"BBBB"}},
            {"type":"image","source":{"type":"url","url":"https://example.com/x.png"}},
            {"type":"text","text":"見て"}]}}"#;

        let images = extract_message_images(line);

        assert_eq!(
            images,
            vec![
                MessageImage {
                    media_type: ImageMediaType::Png,
                    data_base64: "AAAA".to_string()
                },
                MessageImage {
                    media_type: ImageMediaType::Jpeg,
                    data_base64: "BBBB".to_string()
                },
            ]
        );
    }

    #[test]
    fn returns_empty_for_lines_without_images() {
        assert!(extract_message_images(r#"{"type":"user","message":{"content":"hi"}}"#).is_empty());
        assert!(
            extract_message_images(r#"{"type":"assistant","message":{"content":[]}}"#).is_empty()
        );
        assert!(extract_message_images("not json").is_empty());
    }
}
