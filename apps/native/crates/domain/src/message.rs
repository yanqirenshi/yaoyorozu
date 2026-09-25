use crate::{MessageKind, Role};

/// 送信の失敗に関する、メッセージの見分け(issue #364)。
///
/// ビューアから送信すると、Claude Code は先に質問を会話ファイルへ書き込み、そのあと
/// AI に問い合わせる。問い合わせが失敗すると、会話ファイルには「答えのない質問」と
/// 「失敗を示す AI 側のエラー行」が残る(Claude Code 自体の動き。#345 の検証 B-2)。
/// 会話ファイルは書き換えず、表示のための印だけを付ける。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MessageStatus {
    /// 通常のメッセージ。
    #[default]
    Normal,
    /// 答えのない質問: 直後(表示される並びで)が送信失敗のエラー行である user メッセージ。
    FailedQuestion,
    /// 送信失敗のエラー行(`isApiErrorMessage: true` の AI 側の行)のうち、直前が
    /// 答えのない質問(`FailedQuestion`)のもの。次に送信すると、その質問にもまとめて答える。
    ErrorForQuestion,
    /// 送信失敗のエラー行のうち、直前に AI の返答があるもの(返答の途中で失敗した)。
    Error,
}

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
    /// 送信の失敗に関する見分け(issue #364)。行から取り出した直後は、エラー行だけが
    /// `Error`(それ以外は `Normal`)。質問との対応は `mark_failed_questions` が付ける。
    pub status: MessageStatus,
    /// セッション間メッセージの受信・送信・送信の結果の見分け(issue #437)。
    pub kind: MessageKind,
}

/// 送信の結果([`MessageKind::PeerSendResult`])のうち、対応する送信([`MessageKind::PeerSent`]。
/// `tool_use_id` が同じ)が無いものを取り除く(issue #437)。行から取り出した時点では、
/// 送信の結果らしい形(`success` と `msg_id` / `message` を持つ JSON)の tool_result の行を
/// すべて拾うので、`SendMessage` 以外のツールの結果が混ざりうる。記録順(古い順)の一覧に使う。
pub fn keep_peer_send_results_of_sent_messages(messages: &mut Vec<Message>) {
    let sent_ids: std::collections::HashSet<String> = messages
        .iter()
        .filter_map(|m| match &m.kind {
            MessageKind::PeerSent { tool_use_id, .. } => Some(tool_use_id.clone()),
            _ => None,
        })
        .collect();
    messages.retain(|m| match &m.kind {
        MessageKind::PeerSendResult { tool_use_id, .. } => sent_ids.contains(tool_use_id),
        _ => true,
    });
}

/// 送信失敗のエラー行(`Error`)の直前が user メッセージなら、その user メッセージを
/// 「答えのない質問」(`FailedQuestion`)にし、エラー行を `ErrorForQuestion` にする
/// (issue #364)。`messages` は**記録順**(古い順)で、表示される並びそのもの
/// (tool 結果だけの行など、表示されない行は含まれていない)。
///
/// 直前が AI の返答なら、返答の途中で失敗したもので、質問には答えが出ているため
/// 何も変えない(エラー行は `Error` のまま)。
pub fn mark_failed_questions(messages: &mut [Message]) {
    for i in 1..messages.len() {
        if messages[i].status != MessageStatus::Error {
            continue;
        }
        if messages[i - 1].role == Role::User {
            messages[i - 1].status = MessageStatus::FailedQuestion;
            messages[i].status = MessageStatus::ErrorForQuestion;
        }
    }
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
                kind: MessageKind::Normal,
                status: MessageStatus::Normal,
            },
            Message {
                role: Role::Assistant,
                text: "second".to_string(),
                timestamp: "2".to_string(),
                uuid: None,
                image_count: 0,
                kind: MessageKind::Normal,
                status: MessageStatus::Normal,
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
            kind: MessageKind::Normal,
            status: MessageStatus::Normal,
        }
    }

    fn with(role: Role, status: MessageStatus, text: &str) -> Message {
        Message {
            role,
            status,
            ..message(text)
        }
    }

    #[test]
    fn mark_failed_questions_marks_the_unanswered_question_and_its_error_line() {
        // 質問 → 答え → 質問(失敗)→ エラー行 → 次の質問 → 答え
        let mut messages = vec![
            with(Role::User, MessageStatus::Normal, "q1"),
            with(Role::Assistant, MessageStatus::Normal, "a1"),
            with(Role::User, MessageStatus::Normal, "q2"),
            with(Role::Assistant, MessageStatus::Error, "err"),
            with(Role::User, MessageStatus::Normal, "q3"),
            with(Role::Assistant, MessageStatus::Normal, "a3"),
        ];

        mark_failed_questions(&mut messages);

        let statuses: Vec<MessageStatus> = messages.iter().map(|m| m.status).collect();
        assert_eq!(
            statuses,
            vec![
                MessageStatus::Normal,
                MessageStatus::Normal,
                MessageStatus::FailedQuestion,
                MessageStatus::ErrorForQuestion,
                MessageStatus::Normal,
                MessageStatus::Normal,
            ]
        );
    }

    #[test]
    fn mark_failed_questions_leaves_a_mid_turn_error_after_an_assistant_reply_alone() {
        let mut messages = vec![
            with(Role::User, MessageStatus::Normal, "q"),
            with(Role::Assistant, MessageStatus::Normal, "partial answer"),
            with(Role::Assistant, MessageStatus::Error, "err"),
        ];

        mark_failed_questions(&mut messages);

        assert_eq!(messages[0].status, MessageStatus::Normal);
        assert_eq!(messages[2].status, MessageStatus::Error);
    }

    #[test]
    fn mark_failed_questions_handles_edges_and_consecutive_errors() {
        // 先頭がエラー行(直前なし)・空・エラー行が続く場合。
        let mut messages = vec![with(Role::Assistant, MessageStatus::Error, "err")];
        mark_failed_questions(&mut messages);
        assert_eq!(messages[0].status, MessageStatus::Error);

        mark_failed_questions(&mut []);

        let mut messages = vec![
            with(Role::User, MessageStatus::Normal, "q"),
            with(Role::Assistant, MessageStatus::Error, "err1"),
            with(Role::Assistant, MessageStatus::Error, "err2"),
        ];
        mark_failed_questions(&mut messages);
        let statuses: Vec<MessageStatus> = messages.iter().map(|m| m.status).collect();
        assert_eq!(
            statuses,
            vec![
                MessageStatus::FailedQuestion,
                MessageStatus::ErrorForQuestion,
                MessageStatus::Error,
            ],
            "最初のエラー行だけが質問に対応する"
        );
    }

    #[test]
    fn mark_failed_questions_does_not_touch_a_user_message_followed_by_a_normal_reply() {
        let mut messages = vec![
            with(Role::User, MessageStatus::Normal, "q"),
            with(Role::Assistant, MessageStatus::Normal, "a"),
        ];
        mark_failed_questions(&mut messages);
        assert!(messages.iter().all(|m| m.status == MessageStatus::Normal));
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
