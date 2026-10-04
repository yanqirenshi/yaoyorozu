//! `claude` CLI を起動するときの共通の部品(実行ファイルの解決・起動元の環境変数の除去・
//! 起動失敗の分類)。起動したままの子プロセス([`crate::claude_cli_process`])が使う。
//! (issue #392 で、送信のたびに `--print` で起動し直す1回きり送信の実装
//! `claude_cli_agent.rs` を取り除き、残す部品だけをここへ移した。)

use app::AppError;

/// 起動元(Claude Desktop等)を示す環境変数。子プロセスがこれを引き継ぐと、
/// アプリが新規作成したセッションの記録上の起点が実態と異なる値
/// (`entrypoint: "claude-desktop"`)になってしまう。`claude` 起動前に必ず取り除く。
pub(crate) const DESKTOP_LINEAGE_ENV_VARS: &[&str] = &[
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PID",
];

/// 起動する `claude` 実行ファイル。現状はPATH解決に任せているが、参照箇所をこの1関数に
/// 閉じておく(Lab (PM)からの申し送り。issue #345)。アプリが起動する `claude` の解決方法を
/// 差し替える可能性があるため、呼び出し元は必ずこの関数経由にすること(直接 `"claude"` を
/// 書かない)。
pub(crate) fn claude_executable() -> &'static str {
    "claude"
}

/// プロセス起動時の `io::Error` を分類する。実行ファイル自体が見つからない場合と、
/// それ以外の起動失敗を区別する。
///
/// Windows は作業ディレクトリ(`cwd`)が無いときも実行ファイルが無いときと同じ
/// `ErrorKind::NotFound` を返すため(issue #534)、`NotFound` を無条件に「実行ファイルが
/// 無い」とは解釈しない。呼び出し側(`ClaudeCliProcessLauncher::start`)は spawn の前に
/// `cwd.is_dir()` を確かめて `CwdMissing` を返しているが、確認と実際の spawn の間に
/// ディレクトリが削除される競合もあり得るため、ここでも確かめて正しく分類し直す。
pub(crate) fn map_spawn_error(program: &str, cwd: &std::path::Path, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        if !cwd.is_dir() {
            return AppError::CwdMissing(format!(
                "作業ディレクトリが見つかりません: {}",
                cwd.display()
            ));
        }
        AppError::CliNotFound(format!(
            "{program} コマンドが見つかりません。インストールされているか確認してください。"
        ))
    } else {
        AppError::Io(format!("{program} の起動に失敗しました: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;
    use std::path::PathBuf;

    fn not_found() -> std::io::Error {
        std::io::Error::new(ErrorKind::NotFound, "not found")
    }

    #[test]
    fn not_found_with_a_missing_cwd_is_reported_as_cwd_missing() {
        let error = map_spawn_error("claude", &PathBuf::from("Z:/no/such/dir"), not_found());

        assert!(matches!(error, AppError::CwdMissing(_)), "{error:?}");
    }

    #[test]
    fn not_found_with_an_existing_cwd_is_reported_as_cli_not_found() {
        let dir = tempfile::tempdir().unwrap();

        let error = map_spawn_error("claude", dir.path(), not_found());

        assert!(matches!(error, AppError::CliNotFound(_)), "{error:?}");
    }

    #[test]
    fn other_errors_are_reported_as_io_regardless_of_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let error = std::io::Error::new(ErrorKind::PermissionDenied, "denied");

        let error = map_spawn_error("claude", dir.path(), error);

        assert!(matches!(error, AppError::Io(_)), "{error:?}");
    }
}
