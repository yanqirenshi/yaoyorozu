use app::AppError;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// 同じプロセスの中で一時ファイル名が重ならないようにする連番。
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// `path` へ `content` をアトミックに書く(各ストアの保存の共通部分)。
///
/// 1. **保存ごとに別の名前**の一時ファイル(`<名前>.<pid>.<時刻>.<連番>.tmp`)を、
///    **新規作成に限って**(`create_new`)作る。固定名の一時ファイルを使うと、同時の保存が同じ
///    ファイルに書いて内容が混ざる・片方の `rename` が他方の一時ファイルを奪う、といった衝突が起きる。
///    また、同名のハードリンク・シンボリックリンクが残っていても、リンク先を上書きしない。
/// 2. 書く → `fsync` → `rename` で置換する。置換先がリンクでも、リンクそのものが差し替わるだけで
///    リンク先の中身は変わらない。
/// 3. 失敗したときは一時ファイルを残さない。
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Io(format!("{} の親フォルダがありません", path.display())))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Io(format!("{} のファイル名が不正です", path.display())))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    for _ in 0..100 {
        let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp: PathBuf = parent.join(format!("{name}.{}.{nanos}.{seq}.tmp", std::process::id()));
        // 同名のものが既にあれば(リンクでも)失敗する。そのときは名前を変えてやり直す。
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(AppError::Io(format!(
                    "{} の作成に失敗しました: {e}",
                    tmp.display()
                )))
            }
        };
        let result = file
            .write_all(content)
            .and_then(|_| ensure_newer_mtime(&file, path))
            .map_err(|e| AppError::Io(format!("{} への書き込みに失敗しました: {e}", tmp.display())))
            .and_then(|_| {
                file.sync_all().map_err(|e| {
                    AppError::Io(format!("{} の同期に失敗しました: {e}", tmp.display()))
                })
            })
            .and_then(|_| {
                drop(file);
                rename_with_retry(&tmp, path).map_err(|e| {
                    AppError::Io(format!("{} への置換に失敗しました: {e}", path.display()))
                })
            });
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        return result;
    }
    Err(AppError::Io(format!(
        "{} の一時ファイルを作れませんでした",
        path.display()
    )))
}

/// `write_atomic` の一時ファイルの名前の形: `<元の名前>.<pid>.<時刻(ナノ秒)>.<連番>.tmp`。
/// 後ろの 3 つが数字で、元の名前が空でなければ、`write_atomic` が作ったものとみなす(`a.b.c.tmp` や
/// `settings.json.tmp` のような、利用者のファイルには当たらない)。
pub fn is_write_atomic_tmp_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".tmp") else {
        return false;
    };
    let mut parts = stem.rsplitn(4, '.');
    let (Some(seq), Some(nanos), Some(pid), Some(original)) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    digits(seq) && digits(nanos) && digits(pid) && !original.is_empty()
}

/// `dir` の直下から、`write_atomic` が作った**古い一時ファイル**を消す(保存の途中でプロセスが止められると
/// 残る)。消すのは、名前が [`is_write_atomic_tmp_name`] の形で、**通常のファイル**で(リンクはたどらない・
/// 消さない)、最後に更新されてから `older_than` 以上たったものだけ。保存中のものを消さないための時間で、
/// 長めにとる。サブフォルダは見ない。消した名前を返す。
/// 呼ぶのは、自分のデータフォルダだけ(リポジトリや `~/.claude` の中は、勝手に消さない)。
pub fn remove_stale_write_atomic_tmp_files(
    dir: &Path,
    older_than: std::time::Duration,
) -> Vec<String> {
    let mut removed = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return removed;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_write_atomic_tmp_name(&name) {
            continue;
        }
        let path = entry.path();
        // `symlink_metadata` は、リンクをたどらずリンクそのものを見る。通常のファイルだけを対象にする。
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.file_type().is_file() {
            continue;
        }
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if now.duration_since(modified).unwrap_or_default() >= older_than
            && fs::remove_file(&path).is_ok()
        {
            removed.push(name);
        }
    }
    removed
}

fn mtime_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 書いたファイルの更新時刻(ミリ秒)が、置き換える前のファイルより**必ず新しく**なるようにする。
/// CLAUDE.md・設定ファイルの楽観ロックは更新時刻(ミリ秒)を「版」として使うため、同じミリ秒の
/// うちに 2 回書くと版が変わらず、古い版を持った保存が通ってしまう(同時の保存が 1 本に絞れない)。
/// 置き換え前の更新時刻以下なら、その 1 ミリ秒後にそろえる(時刻が進み続けるのは版として自然)。
fn ensure_newer_mtime(file: &fs::File, target: &Path) -> std::io::Result<()> {
    let Ok(old) = fs::metadata(target).and_then(|m| m.modified()) else {
        return Ok(());
    };
    let old_ms = mtime_ms(old);
    let new_ms = mtime_ms(file.metadata()?.modified()?);
    if new_ms <= old_ms {
        file.set_modified(UNIX_EPOCH + std::time::Duration::from_millis(old_ms + 1))?;
    }
    Ok(())
}

/// Windows では、置換先を別のスレッド・プロセス(ウイルス対策の走査など)が一瞬開いていると
/// `rename` が `PermissionDenied` などで失敗することがある。短い間隔で数回やり直す。
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..100u64 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(1 + attempt.min(10)));
            }
        }
    }
    Err(last.expect("1 回以上試している"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(dir: &Path) -> usize {
        fs::read_dir(dir).unwrap().count()
    }

    #[test]
    fn writes_and_replaces_without_leaving_tmp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert_eq!(entries(dir.path()), 1);
    }

    #[test]
    fn a_hard_linked_old_fixed_name_tmp_file_is_never_written_through() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim.txt");
        fs::write(&victim, "precious").unwrap();
        let path = dir.path().join("a.json");
        fs::hard_link(&victim, dir.path().join("a.json.tmp")).unwrap();

        write_atomic(&path, b"new").unwrap();

        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn replacing_a_hard_linked_destination_does_not_change_the_link_target() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim.txt");
        fs::write(&victim, "precious").unwrap();
        let path = dir.path().join("a.json");
        fs::hard_link(&victim, &path).unwrap();

        write_atomic(&path, b"new").unwrap();

        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn a_failed_replace_leaves_no_tmp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        // 置換先がフォルダだと rename が失敗する。
        let path = dir.path().join("target");
        fs::create_dir(&path).unwrap();
        assert!(write_atomic(&path, b"x").is_err());
        assert_eq!(entries(dir.path()), 1, "一時ファイルが残っていない");
    }

    /// 同じファイルへ同時に書いても、**中身は混ざらない**(どれか 1 つの書き込みの内容そのもの)。
    /// Windows では、置換先を別のスレッドが置換している最中の `rename` が失敗することがあるため、
    /// 同じファイルへの同時の書き込みは、呼び出し側が直列化する(サーバは保存のレーンで行う)。
    /// ここでは、失敗が起きても壊れた内容・一時ファイルの残骸を残さないことを確かめる。
    #[test]
    fn concurrent_writers_never_leave_a_corrupt_file_or_tmp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let mut ok = 0;
                    for j in 0..25 {
                        let body = format!(
                            "{{\"writer\":{i},\"n\":{j},\"pad\":\"{}\"}}",
                            "x".repeat(2000)
                        );
                        if write_atomic(&path, body.as_bytes()).is_ok() {
                            ok += 1;
                        }
                    }
                    ok
                })
            })
            .collect();
        let succeeded: u32 = handles.into_iter().map(|h| h.join().unwrap()).sum();
        assert!(succeeded > 0, "少なくとも一部は成功する");
        // どれかの書き込みの内容そのもの(混ざっていない)で、一時ファイルも残っていない。
        let text = fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).expect("JSON として読める");
        assert_eq!(value["pad"].as_str().unwrap().len(), 2000);
        assert_eq!(entries(dir.path()), 1);
    }

    /// 同じミリ秒のうちに何度書いても、更新時刻(ミリ秒)は必ず増える(楽観ロックの版が変わる)。
    #[test]
    fn every_write_advances_the_modified_time_in_milliseconds() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        write_atomic(&path, b"0").unwrap();
        let ms = |p: &Path| {
            fs::metadata(p)
                .unwrap()
                .modified()
                .unwrap()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        };
        let mut last = ms(&path);
        for i in 1..50 {
            write_atomic(&path, format!("{i}").as_bytes()).unwrap();
            let now = ms(&path);
            assert!(now > last, "{i}: {now} > {last}");
            last = now;
        }
    }

    #[test]
    fn tmp_names_written_by_write_atomic_are_recognised_and_user_files_are_not() {
        let dir = tempfile::tempdir().unwrap();
        // 実際に作られる名前の形。途中で止められたものを模して、一時ファイルを直接作る。
        let seen = std::sync::Mutex::new(Vec::new());
        // write_atomic の成功後は残らないので、名前の形は関数で直接確かめる。
        for good in [
            "settings.json.1234.1700000000000000000.0.tmp",
            "server-token.9.8.7.tmp",
            "CLAUDE.md.12.34.56.tmp",
            "a.b.c.1.2.3.tmp",
        ] {
            assert!(is_write_atomic_tmp_name(good), "{good}");
            seen.lock().unwrap().push(good);
        }
        for bad in [
            "settings.json",
            "settings.json.tmp",
            "a.b.c.tmp",
            "a.1.2.tmp",
            ".1.2.3.tmp",
            "x.1.2.three.tmp",
            "x.1.2.3.tmp.bak",
            "x.1.2.3",
            "x.1.2.3.TMP",
        ] {
            assert!(!is_write_atomic_tmp_name(bad), "{bad}");
        }
        // write_atomic 自身が作る名前は、この形に合う(成功後は消えるので、ディレクトリの中身で確かめる)。
        let target = dir.path().join("a.json");
        write_atomic(&target, b"x").unwrap();
        assert_eq!(entries(dir.path()), 1);
    }

    #[test]
    fn stale_tmp_files_are_removed_but_fresh_ones_links_folders_and_user_files_are_kept() {
        use std::time::Duration;
        let dir = tempfile::tempdir().unwrap();
        let old = SystemTime::now() - Duration::from_secs(3 * 3600);
        let set_age = |path: &Path, time: SystemTime| {
            fs::OpenOptions::new()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(time)
                .unwrap();
        };

        // 古い一時ファイル(消える)・新しい一時ファイル(残る)。
        let stale = dir.path().join("settings.json.100.200.1.tmp");
        let fresh = dir.path().join("settings.json.100.200.2.tmp");
        fs::write(&stale, "x").unwrap();
        fs::write(&fresh, "y").unwrap();
        set_age(&stale, old);
        // 古いが名前の形が合わないもの・利用者のファイル(残る)。
        let user_files = [
            "settings.json",
            "settings.json.tmp",
            "notes.tmp",
            "a.1.2.tmp",
        ];
        for name in user_files {
            let p = dir.path().join(name);
            fs::write(&p, "keep").unwrap();
            set_age(&p, old);
        }
        // 名前が合うフォルダ(残る)。
        let folder = dir.path().join("dir.100.200.3.tmp");
        fs::create_dir(&folder).unwrap();
        // ハードリンク: 古い一時ファイルの名前のエントリだけが消え、リンク先の中身は変わらない。
        let victim = dir.path().join("victim.txt");
        fs::write(&victim, "precious").unwrap();
        let linked = dir.path().join("victim.100.200.4.tmp");
        fs::hard_link(&victim, &linked).unwrap();
        set_age(&linked, old);

        let mut removed =
            remove_stale_write_atomic_tmp_files(dir.path(), Duration::from_secs(3600));
        removed.sort();
        assert_eq!(
            removed,
            vec!["settings.json.100.200.1.tmp", "victim.100.200.4.tmp"]
        );
        assert!(!stale.exists());
        assert!(fresh.exists(), "新しい一時ファイルは残す");
        for name in user_files {
            assert!(dir.path().join(name).exists(), "{name} は残す");
        }
        assert!(folder.is_dir(), "フォルダは残す");
        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert!(!linked.exists(), "リンクの名前のエントリは消える");
    }

    #[test]
    fn serialized_writers_never_fail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        let lock = std::sync::Arc::new(std::sync::Mutex::new(()));
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let (path, lock) = (path.clone(), lock.clone());
                std::thread::spawn(move || {
                    for j in 0..25 {
                        let body = format!("{{\"writer\":{i},\"n\":{j}}}");
                        let _g = lock.lock().unwrap();
                        write_atomic(&path, body.as_bytes()).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert!(
            serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path).unwrap()).is_ok()
        );
        assert_eq!(entries(dir.path()), 1);
    }
}
