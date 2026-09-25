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

/// プロセス起動時の `io::Error` を分類する。
/// 実行ファイル自体が見つからない場合と、それ以外の起動失敗を区別する。
pub(crate) fn map_spawn_error(program: &str, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::CliNotFound(format!(
            "{program} コマンドが見つかりません。インストールされているか確認してください。"
        ))
    } else {
        AppError::Io(format!("{program} の起動に失敗しました: {e}"))
    }
}
