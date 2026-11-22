//! データフォルダとポートの決め方。
//!
//! MSI 版(`com.yaoyorozu.native`)のフォルダは読まない・書かない。同じフォルダを使うと
//! トークンを上書きし、後の段階では自動再開が本番のセッションに再開を試みる(native.md §8)。
//!
//! 守りは**名前の文字列の比較ではなく、解決した実体のパスで行う**。相対指定(`.`・`..`)、
//! 末尾のドット、8.3 の短い名前、ジャンクション、シンボリックリンクはすべて解いてから比べる。
//! 判定は何かを作る・書く前に終え、断った場合に何も残さない(`resolve_data_dir` は読むだけ)。

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

/// データフォルダを上書きする環境変数。
pub const DATA_DIR_ENV_VAR: &str = "YAOYOROZU_DATA_DIR";
/// ポートを上書きする環境変数。
pub const PORT_ENV_VAR: &str = "YAOYOROZU_SERVER_PORT";
/// 既定のポート(Tauri 版のローカル API 14200 とは別)。
pub const DEFAULT_PORT: u16 = 14210;
/// 既定のデータフォルダ名(`%APPDATA%` の下)。
pub const DATA_DIR_NAME: &str = "com.yaoyorozu.server";
/// 触ってはいけない MSI 版のフォルダ名。
pub const FORBIDDEN_DIR_NAME: &str = "com.yaoyorozu.native";

/// `\\?\C:\...` のような拡張長パスの接頭辞を外す(`\\?\UNC\...` は `\\...` にする)。
/// `canonicalize` の結果をほかのパスと同じ形で比べ・表示するため。
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

/// パスを実体のパスへ解決する。何も作らない・書かない。
///
/// 1. 相対指定は `base`(作業フォルダ)から絶対パスにし、`.`・`..`・末尾のドットを取り除く。
/// 2. 実在する一番深い親を `canonicalize`(ジャンクション・シンボリックリンク・8.3 の短い名前を解く)する。
/// 3. まだ無い残りの要素を足す。残りの要素がフォルダ名として扱えない(`:` を含む=代替データストリーム、
///    末尾がドットや空白、`..`)なら断る。
fn resolve_real_path(path: &Path, base: &Path) -> Result<PathBuf, String> {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    };
    // `:` を含む要素(`name::$INDEX_ALLOCATION` など)は、最初に断る(ドライブ文字は Prefix なので別)。
    for component in joined.components() {
        if let Component::Normal(name) = component {
            if name.to_string_lossy().contains(':') {
                return Err(format!(
                    "フォルダ名として扱えない指定です(':' を含む): {}",
                    joined.display()
                ));
            }
        }
    }
    let absolute = std::path::absolute(&joined)
        .map_err(|e| format!("パスを解決できません({}): {e}", joined.display()))?;

    // 実在する一番深い親を探し、その先(まだ無い部分)を別に取っておく。
    let mut existing = absolute.clone();
    let mut rest: Vec<OsString> = Vec::new();
    loop {
        match std::fs::symlink_metadata(&existing) {
            Ok(_) => break,
            Err(_) => {
                let Some(name) = existing.file_name().map(OsString::from) else {
                    return Err(format!("パスを解決できません: {}", absolute.display()));
                };
                rest.push(name);
                if !existing.pop() {
                    return Err(format!("パスを解決できません: {}", absolute.display()));
                }
            }
        }
    }
    let mut resolved = strip_verbatim(
        &std::fs::canonicalize(&existing)
            .map_err(|e| format!("パスを解決できません({}): {e}", existing.display()))?,
    );
    for name in rest.into_iter().rev() {
        let text = name.to_string_lossy();
        if text == ".." || text.ends_with('.') || text.ends_with(' ') {
            return Err(format!(
                "フォルダ名として扱えない指定です: {}",
                absolute.display()
            ));
        }
        resolved.push(name);
    }
    Ok(resolved)
}

/// 比べやすい形(要素ごとの小文字)にする。Windows のパスは大文字小文字を区別しない。
fn lowered_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

/// `path` が `forbidden` 自身、またはその下か。
fn is_inside(path: &Path, forbidden: &Path) -> bool {
    let (p, f) = (lowered_components(path), lowered_components(forbidden));
    p.len() >= f.len() && p[..f.len()] == f[..]
}

/// データフォルダを決める。`env_dir` は [`DATA_DIR_ENV_VAR`] の値、`appdata` は `%APPDATA%`、
/// `cwd` は相対指定の基準(作業フォルダ)。
///
/// 返すのは**解決済みの実体のパス**。MSI 版のフォルダ(名前が `com.yaoyorozu.native` のフォルダ、
/// または本物の `%APPDATA%\com.yaoyorozu.native` の実体)自身かその下を指していたらエラーにする。
/// 何も作らない・書かない(呼び出し側は、この結果を得てからフォルダを作ること)。
pub fn resolve_data_dir(
    env_dir: Option<&str>,
    appdata: Option<&str>,
    cwd: &Path,
) -> Result<PathBuf, String> {
    let requested = match env_dir.map(str::trim).filter(|v| !v.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => {
            let appdata = appdata
                .filter(|v| !v.is_empty())
                .ok_or("%APPDATA% が見つかりません。YAOYOROZU_DATA_DIR を指定してください")?;
            Path::new(appdata).join(DATA_DIR_NAME)
        }
    };
    let resolved = resolve_real_path(&requested, cwd)?;
    let refuse = |why: &str| {
        Err(format!(
            "MSI 版のフォルダ({FORBIDDEN_DIR_NAME})は使えません({why}): 指定 {} → 実体 {}",
            requested.display(),
            resolved.display()
        ))
    };

    // 名前が同じフォルダ(実体のパスの途中を含む)は、どこにあっても断る。
    if lowered_components(&resolved)
        .iter()
        .any(|c| c == FORBIDDEN_DIR_NAME)
    {
        return refuse("名前");
    }
    // 本物の %APPDATA%\com.yaoyorozu.native を、同じ方法で解決したものと比べる。
    if let Some(appdata) = appdata.filter(|v| !v.is_empty()) {
        let real_msi = resolve_real_path(&Path::new(appdata).join(FORBIDDEN_DIR_NAME), cwd)?;
        if is_inside(&resolved, &real_msi) {
            return refuse("実体");
        }
    }
    Ok(resolved)
}

/// ポートを決める。数値として読めない・`0` は既定へ戻す。
pub fn resolve_port(env_value: Option<&str>) -> u16 {
    env_value
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|&p| p != 0)
        .unwrap_or(DEFAULT_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 使い捨ての場所に、`AppData\com.yaoyorozu.native`(おとり)を作る。
    struct Decoy {
        _root: tempfile::TempDir,
        root: PathBuf,
        appdata: PathBuf,
        msi: PathBuf,
    }

    fn decoy() -> Decoy {
        let tmp = tempfile::tempdir().unwrap();
        // 比べる側と同じ形(拡張長なし・短い名前なし)にそろえる。
        let root = strip_verbatim(&fs::canonicalize(tmp.path()).unwrap());
        let appdata = root.join("AppData");
        let msi = appdata.join(FORBIDDEN_DIR_NAME);
        fs::create_dir_all(&msi).unwrap();
        fs::write(msi.join("settings.json"), "{}").unwrap();
        Decoy {
            _root: tmp,
            root,
            appdata,
            msi,
        }
    }

    fn resolve(d: &Decoy, env_dir: &str, cwd: &Path) -> Result<PathBuf, String> {
        resolve_data_dir(Some(env_dir), Some(d.appdata.to_str().unwrap()), cwd)
    }

    fn file_count(dir: &Path) -> usize {
        walk(dir)
    }
    fn walk(dir: &Path) -> usize {
        fs::read_dir(dir)
            .map(|it| {
                it.flatten()
                    .map(|e| {
                        1 + if e.path().is_dir() {
                            walk(&e.path())
                        } else {
                            0
                        }
                    })
                    .sum()
            })
            .unwrap_or(0)
    }

    #[test]
    fn default_dir_is_under_appdata_with_the_server_name() {
        let d = decoy();
        let dir = resolve_data_dir(None, Some(d.appdata.to_str().unwrap()), &d.root).unwrap();
        assert!(dir.ends_with(DATA_DIR_NAME));
        // 解決しただけで、フォルダは作らない。
        assert!(!dir.exists());
    }

    #[test]
    fn env_dir_overrides_and_missing_folders_are_allowed() {
        let d = decoy();
        let want = d.root.join("data").join("sub");
        let dir = resolve(&d, want.to_str().unwrap(), &d.root).unwrap();
        assert_eq!(dir, want);
        assert!(!want.exists());
    }

    #[test]
    fn missing_appdata_is_an_error_without_an_override() {
        assert!(resolve_data_dir(None, None, Path::new(".")).is_err());
    }

    #[test]
    fn the_msi_folder_is_refused_by_name_and_by_real_path() {
        let d = decoy();
        assert!(resolve(&d, d.msi.to_str().unwrap(), &d.root).is_err());
        assert!(resolve(&d, &d.msi.join("viewer-tabs").to_string_lossy(), &d.root).is_err());
        let upper = d.msi.to_string_lossy().to_uppercase();
        assert!(resolve(&d, &upper, &d.root).is_err());
        // 名前が同じなら、本物でなくても(別の場所でも)断る。
        let other = d.root.join("elsewhere").join(FORBIDDEN_DIR_NAME);
        assert!(resolve(&d, other.to_str().unwrap(), &d.root).is_err());
    }

    #[test]
    fn dot_when_the_working_directory_is_the_msi_folder_is_refused() {
        let d = decoy();
        assert!(resolve(&d, ".", &d.msi).is_err());
        assert!(resolve(&d, "sub", &d.msi).is_err());
    }

    #[test]
    fn dotdot_from_below_the_msi_folder_is_refused() {
        let d = decoy();
        let child = d.msi.join("child");
        fs::create_dir_all(&child).unwrap();
        assert!(resolve(&d, "..", &child).is_err());
        // 親(AppData)を指すのは MSI 版のフォルダではないので通る(中身には触れない)。
        assert!(resolve(&d, "..", &d.msi).is_ok());
    }

    #[test]
    fn a_trailing_dot_does_not_get_past_the_check() {
        let d = decoy();
        let dotted = format!("{}.", d.msi.display());
        assert!(resolve(&d, &dotted, &d.root).is_err());
        let dotted_child = format!("{}.\\x", d.msi.display());
        assert!(resolve(&d, &dotted_child, &d.root).is_err());
    }

    #[test]
    fn a_name_that_cannot_be_a_folder_is_refused_without_writing_anything() {
        let d = decoy();
        let before = file_count(&d.root);
        let ads = format!("{}::$INDEX_ALLOCATION", d.msi.display());
        assert!(resolve(&d, &ads, &d.root).is_err());
        assert!(resolve(&d, &format!("{}:stream", d.msi.display()), &d.root).is_err());
        // まだ無いフォルダの、末尾がドット・空白の要素も断る。
        assert!(resolve(&d, &format!("{}\\new.", d.root.display()), &d.root).is_ok_or_normalized());
        assert_eq!(file_count(&d.root), before, "何も作られていないこと");
    }

    /// `std::path::absolute` が末尾のドットを取り除くなら通る(実体は同じフォルダ)。どちらでも
    /// 「MSI 版のフォルダに入らない」ことだけを確かめる。
    trait OkOrNormalized {
        fn is_ok_or_normalized(&self) -> bool;
    }
    impl OkOrNormalized for Result<PathBuf, String> {
        fn is_ok_or_normalized(&self) -> bool {
            match self {
                Ok(p) => !lowered_components(p)
                    .iter()
                    .any(|c| c == FORBIDDEN_DIR_NAME),
                Err(_) => true,
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_short_8_3_name_does_not_get_past_the_check() {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::GetShortPathNameW;
        let d = decoy();
        let long = HSTRING::from(d.msi.as_os_str());
        let mut buf = [0u16; 1024];
        let n = unsafe { GetShortPathNameW(&long, Some(&mut buf)) } as usize;
        if n == 0 {
            eprintln!("8.3 の短い名前を取得できないため飛ばす");
            return;
        }
        let short = PathBuf::from(String::from_utf16_lossy(&buf[..n]));
        if short.file_name() == d.msi.file_name() {
            eprintln!("このボリュームは 8.3 の短い名前を作らないため飛ばす");
            return;
        }
        assert!(
            resolve(&d, short.to_str().unwrap(), &d.root).is_err(),
            "{}",
            short.display()
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_to_the_msi_folder_does_not_get_past_the_check() {
        let d = decoy();
        let link = d.root.join("link");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&d.msi)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !made {
            eprintln!("ジャンクションを作れないため飛ばす");
            return;
        }
        assert!(resolve(&d, link.to_str().unwrap(), &d.root).is_err());
        assert!(resolve(&d, &link.join("x").to_string_lossy(), &d.root).is_err());
    }

    #[test]
    fn port_falls_back_to_default() {
        assert_eq!(resolve_port(None), DEFAULT_PORT);
        assert_eq!(resolve_port(Some(" 14220 ")), 14220);
        for bad in ["", "0", "x", "-1", "99999999"] {
            assert_eq!(resolve_port(Some(bad)), DEFAULT_PORT, "{bad:?}");
        }
    }
}
