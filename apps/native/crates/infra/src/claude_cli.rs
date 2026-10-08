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

/// `claude_executable()` が実行ファイルをどう決めたか(issue #583)。起動失敗の文面
/// (`map_spawn_error`)に「解決できたパスで起動した」か「PATH から見つけられず名前の
/// まま OS の解決に委ねた」かを残すために持つ(以前は両方とも `String` で返していて
/// 区別が付かなかった)。`Command::new` にはどちらの場合も中身の値をそのまま渡す。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ClaudeProgram {
    /// `PATH` × `PATHEXT` の自前の走査(Windows のみ)で見つかった実行ファイルのフルパス。
    Resolved(std::path::PathBuf),
    /// 見つけられなかった(Windows)、またはそもそも自前の走査をしない(非Windows。
    /// 従来どおり OS 自身の `PATH` 解決に委ねる)。
    Unresolved { name: String },
}

impl ClaudeProgram {
    /// `Command::new` に渡す値。
    pub(crate) fn as_os_str(&self) -> &std::ffi::OsStr {
        match self {
            Self::Resolved(path) => path.as_os_str(),
            Self::Unresolved { name } => std::ffi::OsStr::new(name),
        }
    }

    /// `CliNotFound`/`CwdMissing` の文面にこれまでどおり使う表示用の値(issue #583で
    /// この2つの文面は変えない。従来 `self.program: String` だったときの値と同じ)。
    fn display_value(&self) -> String {
        match self {
            Self::Resolved(path) => path.display().to_string(),
            Self::Unresolved { name } => name.clone(),
        }
    }
}

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
pub(crate) fn claude_executable() -> ClaudeProgram {
    #[cfg(windows)]
    {
        if let Some(path) = windows_path_resolution::resolve("claude") {
            // 秘匿情報ではない。次に同種の問題を調べやすくするため起動時に1回出す(issue #556)。
            eprintln!("claude の実行ファイルを解決しました: {}", path.display());
            return ClaudeProgram::Resolved(path);
        }
    }
    ClaudeProgram::Unresolved {
        name: "claude".to_string(),
    }
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
                // `Path::is_file()` は内部で `fs::metadata` のエラーを `false` として
                // 飲み込む(無かった場合も読めなかった場合も区別が付かない)。issue #583:
                // 「そこに無かった」(`NotFound`。探索を続けるだけでよい)と「あったが
                // 読めなかった」(それ以外のエラー。原因が記録に残らないと#576のような
                // 調査で詰まる)を区別するため、`fs::metadata` を自分で呼ぶ。
                match std::fs::metadata(&candidate) {
                    Ok(meta) if meta.is_file() => return Some(candidate),
                    // 存在はするがファイルではない(ディレクトリ等)。次の候補へ。
                    Ok(_) => {}
                    // 無かっただけ。想定内なので黙って次の候補へ。
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    // それ以外(権限・パスの形式など)。秘匿情報ではないので候補パスと
                    // 理由を残す(#556 の `eprintln!` と同じ扱い)。探索の順序・対象は
                    // 変えない(cmd.exe と同じ順序のまま次の候補へ進む)。
                    Err(e) => {
                        eprintln!(
                            "claude の候補 {} を確認できませんでした: {e}",
                            candidate.display()
                        );
                    }
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

        #[test]
        fn a_candidate_that_cannot_be_read_does_not_stop_the_search() {
            // issue #583: `fs::metadata` が `NotFound` 以外のエラーを返す候補があっても、
            // 探索を止めずに後続の候補・ディレクトリへ進むこと。埋め込み NUL は Windows の
            // API が確実に拒否する(`ErrorKind::InvalidInput` 相当)ため、ACL 操作なしで
            // 決定的に「読めない」状況を再現できる。
            let base = tempfile::tempdir().unwrap();
            let broken_dir = base.path().join("claude\u{0}broken");
            let second_dir = base.path().join("second");
            fs::create_dir_all(&second_dir).unwrap();
            touch(&second_dir.join("claude.exe"));
            let path_var = std::env::join_paths([broken_dir, second_dir.clone()]).unwrap();

            let found = resolve_in(&path_var, ".COM;.EXE;.BAT;.CMD", "claude")
                .expect("1番目のディレクトリで読めなくても、2番目で見つかるはず");

            assert_same_path(&found, &second_dir.join("claude.exe"));
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
///
/// `NotFound` 以外(`Io` に落ちる経路)の文面には、実行ファイルをどう決めたか
/// (解決できたフルパス、またはPATHから見つけられず名前のまま起動したこと)と作業
/// ディレクトリを入れる(issue #583)。`#576` の調査で、この情報が無かったために
/// 原因の切り分けにユーザーとの往復が何度も必要になった。`CliNotFound`/`CwdMissing`
/// は既に具体的なので文面を変えない。
///
/// PATH から解決できなかった場合は、「app を起動し直すと直ることがある」旨も添える。
/// `#576` の実際の原因は、app(とその親の Explorer プロセス)の起動後に winget で
/// `claude` を入れたため、起動済みプロセスの PATH に新しい実行ファイルの場所が
/// 反映されていなかったことだった。Windows のプロセスは起動後に外部で行われた PATH の
/// 変更を認識しないため、app を再起動して PATH を読み直すことが直接の対処になる。
pub(crate) fn map_spawn_error(
    program: &ClaudeProgram,
    cwd: &std::path::Path,
    e: std::io::Error,
) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        if !cwd.is_dir() {
            return AppError::CwdMissing(format!(
                "作業ディレクトリが見つかりません: {}",
                cwd.display()
            ));
        }
        let program = program.display_value();
        AppError::CliNotFound(format!(
            "{program} コマンドが見つかりません。インストールされているか確認してください。"
        ))
    } else {
        let resolution_note = match program {
            ClaudeProgram::Resolved(_) => String::new(),
            ClaudeProgram::Unresolved { name } => {
                format!(
                    "(PATH から {name} を見つけられなかったため、名前のまま起動しました。\
                     app の起動後に {name} をインストールした場合、PATH の変更はこの app の\
                     プロセスには反映されません。app を起動し直すと解決することがあります)"
                )
            }
        };
        AppError::Io(format!(
            "{} の起動に失敗しました: {e}{resolution_note}。作業ディレクトリ: {}",
            program.display_value(),
            cwd.display()
        ))
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

    fn unresolved() -> ClaudeProgram {
        ClaudeProgram::Unresolved {
            name: "claude".to_string(),
        }
    }

    #[test]
    fn not_found_with_a_missing_cwd_is_reported_as_cwd_missing() {
        let error = map_spawn_error(&unresolved(), &PathBuf::from("Z:/no/such/dir"), not_found());

        assert!(matches!(error, AppError::CwdMissing(_)), "{error:?}");
    }

    #[test]
    fn not_found_with_an_existing_cwd_is_reported_as_cli_not_found() {
        let dir = tempfile::tempdir().unwrap();

        let error = map_spawn_error(&unresolved(), dir.path(), not_found());

        assert!(matches!(error, AppError::CliNotFound(_)), "{error:?}");
        // issue #583: CliNotFound の文面は変えない(従来どおり program の表示値のみ)。
        let AppError::CliNotFound(message) = error else {
            unreachable!()
        };
        assert_eq!(
            message,
            "claude コマンドが見つかりません。インストールされているか確認してください。"
        );
    }

    #[test]
    fn other_errors_with_an_unresolved_program_say_so_and_include_the_cwd() {
        // issue #583: 解決できなかった(PATHから見つけられなかった)ことを文面に明示する。
        // これが分かれば #576 のような調査で最初の報告だけで済む。
        let dir = tempfile::tempdir().unwrap();
        let error = std::io::Error::new(ErrorKind::PermissionDenied, "denied (os error 448)");

        let error = map_spawn_error(&unresolved(), dir.path(), error);

        assert!(matches!(error, AppError::Io(_)), "{error:?}");
        let AppError::Io(message) = error else {
            unreachable!()
        };
        assert!(
            message.contains("PATH から claude を見つけられなかったため、名前のまま起動しました"),
            "{message}"
        );
        assert!(
            message.contains(&dir.path().display().to_string()),
            "{message}"
        );
        assert!(message.contains("os error 448"), "{message}");
    }

    #[test]
    fn other_errors_with_an_unresolved_program_also_suggest_restarting_the_app() {
        // issue #583 への追記(#576 の原因確定後): app の起動後に winget 等で claude を
        // 入れた場合、起動済みの app プロセスの PATH には反映されない。app を起動し直すと
        // PATH を読み直して直ることがある旨を、解決できなかったときの文面に添える。
        let dir = tempfile::tempdir().unwrap();
        let error = std::io::Error::new(ErrorKind::PermissionDenied, "denied (os error 448)");

        let error = map_spawn_error(&unresolved(), dir.path(), error);

        let AppError::Io(message) = error else {
            unreachable!("{error:?}")
        };
        assert!(
            message.contains("app を起動し直すと解決することがあります"),
            "{message}"
        );
    }

    #[test]
    fn other_errors_with_a_resolved_program_show_the_resolved_path_and_the_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let resolved_path = dir.path().join("claude.cmd");
        let program = ClaudeProgram::Resolved(resolved_path.clone());
        let error = std::io::Error::new(ErrorKind::PermissionDenied, "denied");

        let error = map_spawn_error(&program, dir.path(), error);

        assert!(matches!(error, AppError::Io(_)), "{error:?}");
        let AppError::Io(message) = error else {
            unreachable!()
        };
        assert!(
            message.contains(&resolved_path.display().to_string()),
            "{message}"
        );
        assert!(
            message.contains(&dir.path().display().to_string()),
            "{message}"
        );
        assert!(
            !message.contains("見つけられなかった"),
            "解決できているので「見つけられなかった」とは書かない: {message}"
        );
    }
}
