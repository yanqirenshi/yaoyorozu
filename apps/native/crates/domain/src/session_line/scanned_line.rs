//! 走査(`.jsonl` 全行の読み取り)用の、1行分の型付きビュー。
//!
//! 従来の走査は行ごとに `extract_*`(`&Value` 版)を最大9回呼び、そのたびに
//! 「`Value` のディープコピー + `SessionLine` の型付き構築」をやり直していた
//! (実質同じ行を約10回パースする)。`ScannedLine` は行文字列から
//! `SessionLine` を**1回だけ**構築し、各値をそのフィールドから直接読む
//! (issue #302。実データ 52 ファイル・378MB で release 17.4s → 3.2s)。
//!
//! 値の取り出しは `extract_*` と同じ `SessionLine` のメソッド・同じ関数
//! (`message_from_line`)を通すため、抽出結果は `extract_*` と一致する
//! (`extract.rs` のテストで一致を確認している)。

use super::extract::message_from_line;
use super::SessionLine;
use crate::{convert_session_line, LogLine, LogLineConversionError, Message};

pub struct ScannedLine {
    line: SessionLine,
}

impl ScannedLine {
    /// 1行分の文字列から構築する。JSONとして読めない・`SessionLine` として
    /// 読めない行は `None`(`extract_*` が全て `None` を返す行と同じ)。
    pub fn parse(text: &str) -> Option<Self> {
        serde_json::from_str::<SessionLine>(text)
            .ok()
            .map(|line| Self { line })
    }

    /// `extract_session_id` と同じ値。
    pub fn session_id(&self) -> Option<&str> {
        self.line.session_id()
    }

    /// `extract_cwd` と同じ値。
    pub fn cwd(&self) -> Option<&str> {
        self.line.cwd()
    }

    /// `extract_git_branch` と同じ値。
    pub fn git_branch(&self) -> Option<&str> {
        self.line.git_branch()
    }

    /// `extract_slug` と同じ値。
    pub fn slug(&self) -> Option<&str> {
        self.line.slug()
    }

    /// `extract_custom_title` と同じ値。
    pub fn custom_title(&self) -> Option<&str> {
        match &self.line {
            SessionLine::CustomTitle(l) => l.custom_title.as_deref(),
            _ => None,
        }
    }

    /// `extract_ai_title` と同じ値。
    pub fn ai_title(&self) -> Option<&str> {
        match &self.line {
            SessionLine::AiTitle(l) => l.ai_title.as_deref(),
            _ => None,
        }
    }

    /// `extract_mode` と同じ値。
    pub fn mode(&self) -> Option<&str> {
        match &self.line {
            SessionLine::Mode(l) => l.mode.as_deref(),
            _ => None,
        }
    }

    /// `extract_last_prompt` と同じ値。
    pub fn last_prompt(&self) -> Option<&str> {
        match &self.line {
            SessionLine::LastPrompt(l) => l.last_prompt.as_deref(),
            _ => None,
        }
    }

    /// `extract_message` と同じメッセージ(ユーザー・アシスタント両方)。
    pub fn message(&self) -> Option<Message> {
        message_from_line(&self.line)
    }

    /// この1行から、ビューア用のメッセージと `LogLine` を**同時に**取り出す
    /// (issue #350)。会話を開くときは `message()` と `convert_session_line` の
    /// 両方が要るため、同じ行を2回パースしないようここで1回のパース結果を
    /// 分け合う。値は `message()` / `convert_json_line_to_log_line` と同じ
    /// (`SessionLine` を所有権ごと `convert_session_line` へ渡すだけで、
    /// 変換ルールの実装は共有している)。
    pub fn into_message_and_log_line(
        self,
    ) -> (
        Option<Message>,
        Result<Option<LogLine>, LogLineConversionError>,
    ) {
        let message = message_from_line(&self.line);
        (message, convert_session_line(self.line))
    }

    /// ユーザーの発言の本文(`extract_message` が `Role::User` で返すものの
    /// `text`)。アシスタント行では本文を組み立てない(走査で最初のユーザー
    /// 発言を探すときの無駄なコピーを避ける)。
    pub fn user_message_text(&self) -> Option<String> {
        if !matches!(self.line, SessionLine::User(_)) {
            return None;
        }
        // 画像だけの発言(本文が空)はタイトルの元にしない(issue #349)。
        message_from_line(&self.line)
            .map(|m| m.text)
            .filter(|text| !text.trim().is_empty())
    }

    /// `uuid`(issue #345: フォーク系列の根uuid判定用)。
    pub fn uuid(&self) -> Option<&str> {
        self.line.uuid()
    }

    /// `parentUuid`(issue #345: フォーク系列の根uuid判定用)。
    pub fn parent_uuid(&self) -> Option<&str> {
        self.line.parent_uuid()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert_json_line_to_log_line;
    use crate::session_line::{
        extract_ai_title, extract_custom_title, extract_cwd, extract_git_branch,
        extract_last_prompt, extract_message, extract_mode, extract_session_id, extract_slug,
    };
    use crate::Role;

    /// 実データで観測される主な行の形を網羅した標本。
    const SAMPLE_LINES: &[&str] = &[
        r#"{"type":"user","uuid":"u1","sessionId":"s1","cwd":"/work/a","gitBranch":"main","slug":"quiet-fox","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"hello"}}"#,
        r#"{"type":"user","sessionId":"s1","message":{"role":"user","content":[{"type":"text","text":"画像を見てください"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}]}}"#,
        r#"{"type":"user","sessionId":"s1","message":{"role":"user","content":"   "}}"#,
        r#"{"type":"user","sessionId":"s1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"x"}]}}"#,
        r#"{"type":"assistant","uuid":"u2","sessionId":"s1","cwd":"/work/b","gitBranch":"HEAD","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"t","signature":"s"},{"type":"text","text":"first"},{"type":"tool_use","id":"toolu_1","name":"x","input":{}},{"type":"text","text":"second"}]}}"#,
        r#"{"type":"custom-title","customTitle":"タイトル","sessionId":"s1"}"#,
        r#"{"type":"ai-title","aiTitle":"AI タイトル","sessionId":"s1"}"#,
        r#"{"type":"mode","mode":"plan","sessionId":"s1"}"#,
        r#"{"type":"last-prompt","lastPrompt":"最後のプロンプト","sessionId":"s1"}"#,
        r#"{"type":"system","subtype":"informational","content":"x","level":"info","sessionId":"s1","cwd":"/work/c"}"#,
        r#"{"type":"queue-operation","operation":"enqueue","sessionId":"s1"}"#,
        r#"{"type":"some-future-type","sessionId":"s1"}"#,
        r#"{"type":"user"}"#,
        r#"{"no_type":true}"#,
        r#"[1,2,3]"#,
        r#"not json at all"#,
        r#""#,
    ];

    /// 走査用の新しい読み方(`ScannedLine`)が、従来の `extract_*`(`&Value` 版)と
    /// 全標本・全項目で同じ結果になる(issue #302 の同一性の保証)。
    #[test]
    fn scanned_line_matches_extract_functions_for_all_samples() {
        for text in SAMPLE_LINES {
            let value = serde_json::from_str::<serde_json::Value>(text).ok();
            let scanned = ScannedLine::parse(text);

            let old = |f: fn(&serde_json::Value) -> Option<String>| value.as_ref().and_then(f);
            let new = |f: fn(&ScannedLine) -> Option<&str>| {
                scanned.as_ref().and_then(f).map(String::from)
            };

            assert_eq!(
                old(extract_session_id),
                new(ScannedLine::session_id),
                "{text}"
            );
            assert_eq!(old(extract_cwd), new(ScannedLine::cwd), "{text}");
            assert_eq!(
                old(extract_git_branch),
                new(ScannedLine::git_branch),
                "{text}"
            );
            assert_eq!(old(extract_slug), new(ScannedLine::slug), "{text}");
            assert_eq!(
                old(extract_custom_title),
                new(ScannedLine::custom_title),
                "{text}"
            );
            assert_eq!(old(extract_ai_title), new(ScannedLine::ai_title), "{text}");
            assert_eq!(old(extract_mode), new(ScannedLine::mode), "{text}");
            assert_eq!(
                old(extract_last_prompt),
                new(ScannedLine::last_prompt),
                "{text}"
            );

            let parts = |m: Message| (m.role, m.text, m.timestamp, m.uuid);
            let old_message = value.as_ref().and_then(extract_message);
            let new_message = scanned.as_ref().and_then(ScannedLine::message);
            assert_eq!(
                old_message.clone().map(parts),
                new_message.map(parts),
                "{text}"
            );

            let old_user_text = old_message.filter(|m| m.role == Role::User).map(|m| m.text);
            let new_user_text = scanned.as_ref().and_then(ScannedLine::user_message_text);
            assert_eq!(old_user_text, new_user_text, "{text}");
        }
    }

    /// 会話を開くための1回パース(`into_message_and_log_line`)が、従来の2本の読み方
    /// (`extract_message` と `convert_json_line_to_log_line`。どちらも `&Value` 版)と
    /// 全標本で同じ結果になる(issue #350 の同一性の保証)。
    #[test]
    fn into_message_and_log_line_matches_old_readers_for_all_samples() {
        for text in SAMPLE_LINES {
            let value = serde_json::from_str::<serde_json::Value>(text).ok();
            let old_message = value.as_ref().and_then(extract_message);
            let old_log_line = match value.as_ref() {
                Some(v) => convert_json_line_to_log_line(v),
                None => Ok(None),
            };

            let (new_message, new_log_line) = match ScannedLine::parse(text) {
                Some(scanned) => scanned.into_message_and_log_line(),
                None => (None, Ok(None)),
            };

            let parts = |m: Message| (m.role, m.text, m.timestamp, m.uuid, m.image_count);
            assert_eq!(old_message.map(parts), new_message.map(parts), "{text}");
            assert_eq!(old_log_line, new_log_line, "{text}");
        }
    }

    /// チェーン行なのに `uuid`/`timestamp` を変換できない行は、従来と同じ理由の `Err` になる。
    #[test]
    fn into_message_and_log_line_reports_the_same_conversion_error() {
        let text =
            r#"{"type":"user","sessionId":"s1","message":{"role":"user","content":"hello"}}"#;
        let value = serde_json::from_str::<serde_json::Value>(text).unwrap();
        let (message, log_line) = ScannedLine::parse(text)
            .unwrap()
            .into_message_and_log_line();
        assert_eq!(log_line, convert_json_line_to_log_line(&value));
        assert!(log_line.is_err(), "uuid が無い行は変換できない");
        // 表示用のメッセージは、LogLine に変換できなくても取り出せる(従来どおり)。
        assert_eq!(message.map(|m| m.text), Some("hello".to_string()));
    }
}
