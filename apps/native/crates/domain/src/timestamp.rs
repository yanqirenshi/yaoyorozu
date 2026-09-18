use chrono::DateTime;

/// jsonlの`timestamp`(ISO8601・UTC。例: `"2026-08-16T07:04:52.062Z"`)を
/// エポックミリ秒(`LogLineBase.timestamp: u64`)に変換する(オブジェクト
/// モデル実装 第6弾。issue #208)。パース失敗、または1970-01-01より前
/// (u64で表現できない負値)は`None`を返す。
///
/// クラス図の`LogLine.timestamp`は`u64`(必須)だが、jsonl側は文字列で
/// 欠損・不正値がありうる。呼び出し側(`LogLine`への変換)は、`None`に
/// なった行を勝手にフォールバック(0埋め等)せずスキップし、実データで
/// 実際に発生したかを確認してデザイン側へ報告すること(issue本文の
/// 明示的な指示)。
pub fn parse_iso_timestamp_to_epoch_ms(value: &str) -> Option<u64> {
    let parsed = DateTime::parse_from_rfc3339(value).ok()?;
    u64::try_from(parsed.timestamp_millis()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_iso_timestamp_to_epoch_ms_converts_epoch_itself() {
        assert_eq!(
            parse_iso_timestamp_to_epoch_ms("1970-01-01T00:00:00Z"),
            Some(0)
        );
    }

    #[test]
    fn parse_iso_timestamp_to_epoch_ms_converts_known_value_with_milliseconds() {
        // 2024-01-01T00:00:00.000Z のepoch秒(1704067200)はよく知られた値。
        assert_eq!(
            parse_iso_timestamp_to_epoch_ms("2024-01-01T00:00:00.000Z"),
            Some(1_704_067_200_000)
        );
    }

    #[test]
    fn parse_iso_timestamp_to_epoch_ms_preserves_millisecond_precision() {
        assert_eq!(
            parse_iso_timestamp_to_epoch_ms("2024-01-01T00:00:00.123Z"),
            Some(1_704_067_200_123)
        );
    }

    #[test]
    fn parse_iso_timestamp_to_epoch_ms_returns_none_for_malformed_string() {
        assert_eq!(parse_iso_timestamp_to_epoch_ms("not-a-timestamp"), None);
    }

    #[test]
    fn parse_iso_timestamp_to_epoch_ms_returns_none_for_empty_string() {
        assert_eq!(parse_iso_timestamp_to_epoch_ms(""), None);
    }

    #[test]
    fn parse_iso_timestamp_to_epoch_ms_returns_none_for_dates_before_epoch() {
        // u64は負値を表現できないため、1970-01-01より前はNoneにする。
        assert_eq!(
            parse_iso_timestamp_to_epoch_ms("1969-12-31T23:59:59Z"),
            None
        );
    }
}
