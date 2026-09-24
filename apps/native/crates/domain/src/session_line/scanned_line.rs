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
use crate::Message;

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
}
