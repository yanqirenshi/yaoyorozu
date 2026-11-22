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
