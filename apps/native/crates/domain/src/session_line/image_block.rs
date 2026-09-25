use crate::ImageMediaType;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ImageBlock {
    #[serde(default)]
    pub source: serde_json::Value,
}

impl ImageBlock {
    /// base64 ソースの画像なら `(形式, base64データ)` を返す。URL 参照など
    /// base64 以外のソース、対応外の形式(`image/svg+xml` 等)は `None`
    /// (表示用に取り出す画像を許可リストで絞る。issue #349)。
    pub fn base64_source(&self) -> Option<(ImageMediaType, &str)> {
        let source = self.source.as_object()?;
        if source.get("type")?.as_str()? != "base64" {
            return None;
        }
        let media_type = ImageMediaType::from_mime(source.get("media_type")?.as_str()?)?;
        let data = source.get("data")?.as_str()?;
        Some((media_type, data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn block(source: serde_json::Value) -> ImageBlock {
        ImageBlock { source }
    }

    #[test]
    fn base64_source_reads_media_type_and_data() {
        let b = block(json!({"type": "base64", "media_type": "image/png", "data": "AAAA"}));
        assert_eq!(b.base64_source(), Some((ImageMediaType::Png, "AAAA")));
    }

    #[test]
    fn base64_source_rejects_url_sources_and_unsupported_types() {
        assert_eq!(
            block(json!({"type": "url", "url": "https://example.com/a.png"})).base64_source(),
            None
        );
        assert_eq!(
            block(json!({"type": "base64", "media_type": "image/svg+xml", "data": "AAAA"}))
                .base64_source(),
            None
        );
        assert_eq!(block(json!(null)).base64_source(), None);
    }
}
