//! セッションの表示名(タイトル)の変更(issue #523)。
//!
//! 調査(issue #523 本文の指示): 実行中の `claude` CLI に、起動後にタイトルを変える
//! stream-json の手段(`control_request` の subtype 等)は無い。`crates/infra/src/
//! claude_stream_json.rs` が扱う subtype は `initialize` / `set_model` /
//! `set_permission_mode` / `interrupt` のみで、PoC #382・#429 のレポートにも記述が無い。
//! 表示名(`--name`)は起動時の引数でのみ決まる。
//!
//! そのため、会話ファイル(jsonl)へ `custom-title` 行を追記して**タイトルだけ**を
//! 変える([`crate::SessionSource::append_custom_title`])。実行中プロセスが
//! セッション間メッセージの宛先に使う名前(起動時の `--name`)はこれでは変わらず、
//! 次にその会話を起動し直すまで古い名前のままになる(呼び出し側で利用者に伝えること)。

use crate::running_session::MAX_NAME_CHARS;
use crate::{AppError, SessionSource};
use domain::{is_valid_project_dir_name, is_valid_session_id};

/// セッションの表示名(タイトル)を変える。`project` / `session_id` の検証は
/// [`domain::is_valid_project_dir_name`] / [`domain::is_valid_session_id`](native.md §4:
/// パスの構成要素になるため)。`title` は空不可・[`MAX_NAME_CHARS`] 文字以内・
/// 制御文字(改行を含む)不可(起動時の表示名 [`crate::running_session::RunningSession`]
/// 系の検証と同じ規則)。
pub fn rename_session(
    source: &dyn SessionSource,
    project: &str,
    session_id: &str,
    title: &str,
) -> Result<(), AppError> {
    if !is_valid_project_dir_name(project) {
        return Err(AppError::InvalidInput(
            "不正なプロジェクト名です".to_string(),
        ));
    }
    if !is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let title = validate_title(title)?;
    source.append_custom_title(project, session_id, &title)
}

/// 表示名の検証: 空不可([`crate::running_session`] の起動時の表示名は省略可だが、
/// 変更は明示操作なので空を許さない)。
fn validate_title(title: &str) -> Result<String, AppError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "表示名を入力してください".to_string(),
        ));
    }
    if trimmed.chars().count() > MAX_NAME_CHARS || trimmed.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(format!(
            "表示名は {MAX_NAME_CHARS} 文字以内で、改行などを含めないでください"
        )));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakeSource {
        appended: RefCell<Vec<(String, String, String)>>,
        fail: bool,
    }

    impl SessionSource for FakeSource {
        fn list_projects(&self) -> Result<Vec<domain::Project>, AppError> {
            unimplemented!()
        }
        fn read_session(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<crate::SessionContent, AppError> {
            unimplemented!()
        }
        fn session_fingerprint(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<crate::FileFingerprint, AppError> {
            unimplemented!()
        }
        fn session_cwd(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<std::path::PathBuf, AppError> {
            unimplemented!()
        }
        fn list_sessions(&self, _project: &str) -> Result<Vec<domain::SessionSummary>, AppError> {
            unimplemented!()
        }
        fn list_parsed_sessions(
            &self,
            _project: &str,
        ) -> Result<Vec<domain::ParsedSession>, AppError> {
            unimplemented!()
        }
        fn session_line_raw(
            &self,
            _project: &str,
            _session_id: &str,
            _uuid: &str,
        ) -> Result<String, AppError> {
            unimplemented!()
        }
        fn append_custom_title(
            &self,
            project: &str,
            session_id: &str,
            title: &str,
        ) -> Result<(), AppError> {
            if self.fail {
                return Err(AppError::Io("boom".to_string()));
            }
            self.appended.borrow_mut().push((
                project.to_string(),
                session_id.to_string(),
                title.to_string(),
            ));
            Ok(())
        }
    }

    #[test]
    fn renames_with_a_trimmed_title() {
        let source = FakeSource::default();

        rename_session(&source, "proj-a", "s1", "  新しい名前  ").unwrap();

        assert_eq!(
            source.appended.borrow().as_slice(),
            &[(
                "proj-a".to_string(),
                "s1".to_string(),
                "新しい名前".to_string()
            )]
        );
    }

    #[test]
    fn rejects_a_blank_title() {
        let source = FakeSource::default();

        let err = rename_session(&source, "proj-a", "s1", "   ").unwrap_err();

        assert!(matches!(err, AppError::InvalidInput(_)));
        assert!(source.appended.borrow().is_empty());
    }

    #[test]
    fn rejects_a_title_with_control_characters_or_over_the_limit() {
        let source = FakeSource::default();

        assert!(matches!(
            rename_session(&source, "proj-a", "s1", "改行\nあり"),
            Err(AppError::InvalidInput(_))
        ));
        let too_long = "あ".repeat(MAX_NAME_CHARS + 1);
        assert!(matches!(
            rename_session(&source, "proj-a", "s1", &too_long),
            Err(AppError::InvalidInput(_))
        ));
        assert!(source.appended.borrow().is_empty());
    }

    #[test]
    fn rejects_an_invalid_project_or_session_id_without_touching_the_source() {
        let source = FakeSource::default();

        assert!(matches!(
            rename_session(&source, "../escape", "s1", "name"),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            rename_session(&source, "proj-a", "../escape", "name"),
            Err(AppError::InvalidInput(_))
        ));
        assert!(source.appended.borrow().is_empty());
    }

    #[test]
    fn propagates_a_write_failure() {
        let source = FakeSource {
            fail: true,
            ..Default::default()
        };

        let err = rename_session(&source, "proj-a", "s1", "name").unwrap_err();

        assert!(matches!(err, AppError::Io(_)));
    }
}
