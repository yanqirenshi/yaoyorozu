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

/// 起動する `claude` 実行ファイル。参照箇所をこの1関数に閉じておく(Lab (PM)からの
/// 申し送り。issue #345)。アプリが起動する `claude` の解決方法を差し替える可能性がある
/// ため、呼び出し元は必ずこの関数経由にすること(直接 `"claude"` を書かない)。
///
/// Windows: Rust 標準の `Command::new` は `PATH` を見るが `PATHEXT`(`.CMD` / `.BAT` 等)
/// を見ない(`claude` と `claude.exe` しか探さない)。Volta・npm のグローバルインストール等で
/// `claude` の実体が `claude.cmd` だと、入っていても「見つかりません」になる(issue #556)。
/// `PATH` × `PATHEXT` を自分で走査し、見つかった実ファイルのフルパスを返す。見つからなければ
/// `"claude"` をそのまま返し、従来どおり `Command::new` の `ErrorKind::NotFound` 起点の
/// `CliNotFound`([`map_spawn_error`])に委ねる。
/// 非Windows は従来どおり`PATH`解決をOSに任せる(`"claude"`を返すだけ)。
pub(crate) fn claude_executable() -> String {
    #[cfg(windows)]
    {
        if let Some(path) = windows_path_resolution::resolve("claude") {
            // 秘匿情報ではない。次に同種の問題を調べやすくするため起動時に1回出す(issue #556)。
            eprintln!("claude の実行ファイルを解決しました: {}", path.display());
            return path.display().to_string();
        }
    }
    "claude".to_string()
}

#[cfg(windows)]
mod windows_path_resolution {
    use std::ffi::OsStr;
    use std::path::PathBuf;

    /// `PATHEXT` が無い(通常は無いはずだが、念のため)ときの既定値。Windows の既定の並びの
    /// 先頭4つ(`.COM` → `.EXE` → `.BAT` → `.CMD`)。
    const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";

    /// `PATH` × `PATHEXT` を走査して `name`(拡張子無し)の実行ファイルを探す。cmd.exe と同じ
    /// 順序(各 `PATH` ディレクトリの中で `PATHEXT` の並び順に拡張子を試し、見つかった時点で
    /// 確定する。ディレクトリをまたいで他拡張子を優先しない)。
    pub(super) fn resolve(name: &str) -> Option<PathBuf> {
        let path_var = std::env::var_os("PATH")?;
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| DEFAULT_PATHEXT.to_string());
        resolve_in(&path_var, &pathext, name)
    }

    /// テストから直接呼べるよう、環境変数の読み取りと走査を分けたもの(プロセス全体の
    /// `PATH`/`PATHEXT` を書き換えるテストは並行実行と相性が悪いため)。
    pub(super) fn resolve_in(path_var: &OsStr, pathext: &str, name: &str) -> Option<PathBuf> {
        let extensions: Vec<&str> = pathext.split(';').filter(|s| !s.is_empty()).collect();
        for dir in std::env::split_paths(path_var) {
            for ext in &extensions {
                // `PATHEXT` の大文字小文字(通常は大文字)はファイル名の実際の表記と
                // 一致しないことがあるが、ファイルシステムは大文字小文字を区別しないため
                // `Command::new` に渡す実行には影響しない。
                let candidate = dir.join(format!("{name}{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        None
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::fs;

        fn touch(path: &std::path::Path) {
            fs::write(path, "").unwrap();
        }

        /// `PATHEXT` の大文字小文字は実際のファイル名と一致しないことがある
        /// (ファイルシステムは大文字小文字を区別しない)ため、比較は大文字小文字を
        /// 無視する。
        fn assert_same_path(found: &std::path::Path, expected: &std::path::Path) {
            assert!(
                found
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&expected.to_string_lossy()),
                "found={found:?} expected={expected:?}"
            );
        }

        #[test]
        fn finds_a_cmd_file_when_only_the_cmd_extension_matches() {
            let dir = tempfile::tempdir().unwrap();
            touch(&dir.path().join("claude.cmd"));

            let found = resolve_in(dir.path().as_os_str(), ".COM;.EXE;.BAT;.CMD", "claude")
                .expect("should find claude.cmd");

            assert_same_path(&found, &dir.path().join("claude.cmd"));
        }

        #[test]
        fn prefers_the_extension_earlier_in_pathext_within_the_same_directory() {
            let dir = tempfile::tempdir().unwrap();
            touch(&dir.path().join("claude.cmd"));
            touch(&dir.path().join("claude.exe"));

            let found = resolve_in(dir.path().as_os_str(), ".COM;.EXE;.BAT;.CMD", "claude")
                .expect("should find one of them");

            assert_same_path(&found, &dir.path().join("claude.exe"));
        }

        #[test]
        fn does_not_cross_into_a_later_directory_once_the_earlier_one_has_a_match() {
            let first = tempfile::tempdir().unwrap();
            let second = tempfile::tempdir().unwrap();
            touch(&first.path().join("claude.cmd"));
            touch(&second.path().join("claude.exe"));
            let path_var = std::env::join_paths([first.path(), second.path()]).unwrap();

            let found = resolve_in(&path_var, ".COM;.EXE;.BAT;.CMD", "claude")
                .expect("should find one of them");

            assert_same_path(&found, &first.path().join("claude.cmd"));
        }

        #[test]
        fn returns_none_when_nothing_matches_anywhere() {
            let dir = tempfile::tempdir().unwrap();

            let found = resolve_in(dir.path().as_os_str(), ".COM;.EXE;.BAT;.CMD", "claude");

            assert_eq!(found, None);
        }

        #[test]
        fn falls_back_to_default_pathext_order_when_pathext_is_empty() {
            let dir = tempfile::tempdir().unwrap();
            touch(&dir.path().join("claude.bat"));

            let found = resolve_in(dir.path().as_os_str(), "", "claude");

            assert_eq!(
                found, None,
                "空のPATHEXTでは何も試さない(呼び出し側が既定値を渡す)"
            );
        }
    }
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
