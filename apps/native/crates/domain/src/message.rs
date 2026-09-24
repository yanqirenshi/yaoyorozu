use crate::Role;

#[derive(Debug, Clone)]
pub struct Message {
    pub role: Role,
    pub text: String,
    pub timestamp: String,
    /// メッセージの組み立て元の会話チェーン行の `uuid`(issue #313)。元の jsonl 行を
    /// 引き当てるためのキー。行に `uuid` が無ければ `None`。
    pub uuid: Option<String>,
    /// この行に含まれる表示可能な画像(base64 ソース・対応形式)の枚数(issue #349)。
    /// 画像本体は持たない(必要なときだけ `extract_message_images` で取り出す)。
    pub image_count: usize,
}

/// 会話ログは記録順(古い順)で保持されるため、表示直前に反転して新しい順にする。
pub fn order_messages_newest_first(messages: &mut [Message]) {
    messages.reverse();
}

/// `messages` から `offset` 件スキップした後、最大 `limit` 件を切り出す。
/// IPC 1回で会話全件を返さないための範囲指定に使う。
pub fn paginate_messages(messages: &[Message], offset: usize, limit: usize) -> Vec<Message> {
    messages.iter().skip(offset).take(limit).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_messages_newest_first_reverses_record_order() {
        let mut messages = vec![
            Message {
                role: Role::User,
                text: "first".to_string(),
                timestamp: "1".to_string(),
                uuid: None,
                image_count: 0,
            },
            Message {
                role: Role::Assistant,
                text: "second".to_string(),
                timestamp: "2".to_string(),
                uuid: None,
                image_count: 0,
            },
        ];

        order_messages_newest_first(&mut messages);

        let texts: Vec<&str> = messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["second", "first"]);
    }

    fn message(text: &str) -> Message {
        Message {
            role: Role::User,
            text: text.to_string(),
            timestamp: String::new(),
            uuid: None,
            image_count: 0,
        }
    }

    #[test]
    fn paginate_messages_slices_by_offset_and_limit() {
        let messages = vec![message("a"), message("b"), message("c"), message("d")];

        let page = paginate_messages(&messages, 1, 2);

        let texts: Vec<&str> = page.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["b", "c"]);
    }

    #[test]
    fn paginate_messages_returns_empty_when_offset_exceeds_length() {
        let messages = vec![message("a")];
        assert!(paginate_messages(&messages, 5, 10).is_empty());
    }

    #[test]
    fn paginate_messages_returns_remaining_when_limit_exceeds_length() {
        let messages = vec![message("a"), message("b")];
        let page = paginate_messages(&messages, 0, 10);
        assert_eq!(page.len(), 2);
    }
}
