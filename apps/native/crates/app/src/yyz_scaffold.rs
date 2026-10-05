//! リポジトリに `yyz/`(Web アプリが実行時に読む仕様データの置き場所。issue #543)を作る
//! (issue #547)。設定画面から明示的に指示したときだけ作り、登録時などに自動で作らない。
//!
//! 作る内容は [`YYZ_SCAFFOLD_FILES`] の1か所にまとめる。親イシュー #543 の移行が進んで
//! 対応するドキュメント(`spec/<doc>.json`)が増えたら、ここに足す。

use crate::AppError;
use std::path::Path;

/// `yyz/` 配下に作るファイル1つ。
pub struct YyzScaffoldFile {
    /// `repository_path` からの相対パス(例 `"yyz/README.md"`)。
    pub relative_path: &'static str,
    /// 無いときに書き込む内容。既存のファイルは絶対に上書きしない([`YyzScaffoldWriter::ensure_file`])。
    pub default_content: &'static str,
}

/// README の内容(issue #547 本文の決定どおり)。
const README_CONTENT: &str = "\
# yyz/

このフォルダはこのリポジトリの**仕様データ**です。YAOYOROZU の Web アプリが実行時に読みます。

- `spec/<doc>.json` に**計算を含まない素の値**で置いてください(計算・表示の定義は Web アプリ側にあります)。
- git にコミットして履歴を残してください(仕様は git が真。コードと同じ扱いです)。
- 対応している `<doc>` は移行が進むにつれて増えます。いまは `wbs` / `deployment` / `unchi` です。
  親イシュー https://github.com/yanqirenshi/yaoyorozu/issues/543 を参照してください。
";

/// 空の WBS(issue #547 本文の決定どおり。`yaoyorozu/yyz/spec/wbs.json` と同じキー)。
const EMPTY_WBS_JSON: &str = "{\"projects\":[],\"wbs\":[],\"workpackages\":[],\"edges\":[]}\n";

/// 空の構成図(issue #548 で移行済みの `yaoyorozu/yyz/spec/deployment.json` と同じキー)。
const EMPTY_DEPLOYMENT_JSON: &str = "{\"nodes\":[],\"edges\":[]}\n";

/// 空のポンチ絵(issue #548 で移行済みの `yaoyorozu/yyz/spec/unchi.json` と同じキー)。
const EMPTY_UNCHI_JSON: &str = "{\"nodes\":[],\"edges\":[]}\n";

pub const YYZ_SCAFFOLD_FILES: &[YyzScaffoldFile] = &[
    YyzScaffoldFile {
        relative_path: "yyz/README.md",
        default_content: README_CONTENT,
    },
    YyzScaffoldFile {
        relative_path: "yyz/spec/wbs.json",
        default_content: EMPTY_WBS_JSON,
    },
    YyzScaffoldFile {
        relative_path: "yyz/spec/deployment.json",
        default_content: EMPTY_DEPLOYMENT_JSON,
    },
    YyzScaffoldFile {
        relative_path: "yyz/spec/unchi.json",
        default_content: EMPTY_UNCHI_JSON,
    },
];

/// `yyz/` への書き込み(port)。実体(ファイル作成)は infra。
pub trait YyzScaffoldWriter {
    /// `relative_path` がすでにあるか(副作用なし。問い合わせ用)。
    fn file_exists(&self, repository_path: &Path, relative_path: &str) -> Result<bool, AppError>;
    /// 無ければ(必要なら親ディレクトリも)作る。すでにあれば何もしない
    /// (**絶対に上書きしない**。issue #547)。
    fn ensure_file(
        &self,
        repository_path: &Path,
        relative_path: &str,
        content: &str,
    ) -> Result<(), AppError>;
}

/// ファイル1つの現在の状態(問い合わせ・作成のどちらの結果にも使う)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YyzScaffoldFileStatus {
    pub relative_path: String,
    pub exists: bool,
}

/// `yyz/` 一式の状態。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YyzScaffoldStatus {
    pub files: Vec<YyzScaffoldFileStatus>,
    /// 全部あるか(画面側がボタンを押せなくする判断に使う)。
    pub complete: bool,
}

fn ensure_repository_exists(repository_path: &Path) -> Result<(), AppError> {
    if !repository_path.is_dir() {
        return Err(AppError::CwdMissing(format!(
            "リポジトリが見つかりません: {}",
            repository_path.display()
        )));
    }
    Ok(())
}

/// 今の状態を確かめる(副作用なし)。
pub fn yyz_scaffold_status(
    writer: &dyn YyzScaffoldWriter,
    repository_path: &Path,
) -> Result<YyzScaffoldStatus, AppError> {
    ensure_repository_exists(repository_path)?;
    let files = YYZ_SCAFFOLD_FILES
        .iter()
        .map(|file| {
            Ok(YyzScaffoldFileStatus {
                relative_path: file.relative_path.to_string(),
                exists: writer.file_exists(repository_path, file.relative_path)?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let complete = files.iter().all(|f| f.exists);
    Ok(YyzScaffoldStatus { files, complete })
}

/// 足りないものだけ作り、作ったあとの状態を返す。既存のファイルは絶対に上書きしない。
pub fn create_yyz_scaffold(
    writer: &dyn YyzScaffoldWriter,
    repository_path: &Path,
) -> Result<YyzScaffoldStatus, AppError> {
    ensure_repository_exists(repository_path)?;
    for file in YYZ_SCAFFOLD_FILES {
        writer.ensure_file(repository_path, file.relative_path, file.default_content)?;
    }
    yyz_scaffold_status(writer, repository_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    #[derive(Default)]
    struct FakeWriter {
        existing: RefCell<BTreeSet<String>>,
        fail_ensure_for: Option<&'static str>,
    }

    impl YyzScaffoldWriter for FakeWriter {
        fn file_exists(
            &self,
            _repository_path: &Path,
            relative_path: &str,
        ) -> Result<bool, AppError> {
            Ok(self.existing.borrow().contains(relative_path))
        }

        fn ensure_file(
            &self,
            _repository_path: &Path,
            relative_path: &str,
            _content: &str,
        ) -> Result<(), AppError> {
            if self.fail_ensure_for == Some(relative_path) {
                return Err(AppError::Io("boom".to_string()));
            }
            self.existing.borrow_mut().insert(relative_path.to_string());
            Ok(())
        }
    }

    fn existing_repo() -> PathBuf {
        // テスト環境に必ずある、存在するディレクトリ(内容は見ない。is_dir() の
        // 確認だけに使う)。
        std::env::temp_dir()
    }

    #[test]
    fn status_reports_missing_when_nothing_exists_yet() {
        let writer = FakeWriter::default();

        let status = yyz_scaffold_status(&writer, &existing_repo()).unwrap();

        assert!(!status.complete);
        assert!(status.files.iter().all(|f| !f.exists));
        assert_eq!(status.files.len(), YYZ_SCAFFOLD_FILES.len());
    }

    #[test]
    fn create_makes_every_file_and_reports_complete() {
        let writer = FakeWriter::default();

        let status = create_yyz_scaffold(&writer, &existing_repo()).unwrap();

        assert!(status.complete);
        assert!(status.files.iter().all(|f| f.exists));
    }

    #[test]
    fn create_only_makes_the_missing_ones_and_never_touches_existing_ones() {
        let writer = FakeWriter::default();
        // README だけ先にある状態を作る。
        writer
            .existing
            .borrow_mut()
            .insert("yyz/README.md".to_string());

        let status = create_yyz_scaffold(&writer, &existing_repo()).unwrap();

        assert!(status.complete);
        // README はそのまま(ensure_file は呼ばれても中身を上書きしない実装だが、
        // ここでは「既にあったものにも ensure_file は呼ばれる」ことだけ確認する。
        // 上書きしないことは infra 側の実装で保証・テストする)。
        assert!(
            status
                .files
                .iter()
                .find(|f| f.relative_path == "yyz/README.md")
                .unwrap()
                .exists
        );
    }

    #[test]
    fn create_is_idempotent_a_second_call_changes_nothing_and_still_reports_complete() {
        let writer = FakeWriter::default();
        create_yyz_scaffold(&writer, &existing_repo()).unwrap();

        let status = create_yyz_scaffold(&writer, &existing_repo()).unwrap();

        assert!(status.complete);
    }

    #[test]
    fn status_and_create_fail_when_the_repository_directory_does_not_exist() {
        let writer = FakeWriter::default();
        let missing = PathBuf::from("Z:/no/such/repo-for-yyz-scaffold-test");

        assert!(matches!(
            yyz_scaffold_status(&writer, &missing),
            Err(AppError::CwdMissing(_))
        ));
        assert!(matches!(
            create_yyz_scaffold(&writer, &missing),
            Err(AppError::CwdMissing(_))
        ));
    }

    #[test]
    fn create_propagates_a_write_failure_without_silently_succeeding() {
        let writer = FakeWriter {
            fail_ensure_for: Some("yyz/README.md"),
            ..Default::default()
        };

        let err = create_yyz_scaffold(&writer, &existing_repo()).unwrap_err();

        assert!(matches!(err, AppError::Io(_)));
    }
}
