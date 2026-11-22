//! セッション走査キュー(ハブの会話の一覧の逐次読み込み)。写し元: `tauri/src/session_scan_queue.rs`。
//!
//! 全件の走査(`start`)は、会話ファイル(jsonl)単位に分割して、更新時刻の降順・n 並列で実行し、完了したものから
//! `ServerState.user_sessions` と、常駐しているツリー(`ServerState.pc`)へ反映する。ハブは `pc:data_progress` を
//! きっかけに `get_pc` で取り直す。並列度(既定 6。環境変数 `YAOYOROZU_SCAN_CONCURRENCY` で 1〜16)・ファイルの監視との接続
//! (差分再走査。最短 1 秒の間隔)は、Tauri 版と同じ。
//!
//! 再読み込みとの競合は世代番号(`ServerState.session_scan_generation`)で防ぐ(旧世代の結果は適用しない)。
//! 状態のロックを持ったままファイル I/O・通知をしない(native.md §2)。

use crate::state::resolve_effective_projects_dir;
use crate::AppContext;
use domain::ParsedSession;
use infra::{FileSystemRepository, SessionFileRef};
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

const DEFAULT_CONCURRENCY: usize = 6;

/// 並列度(環境変数での上書きのみ。1〜16 に制限)。
pub fn concurrency() -> usize {
    parse_concurrency(std::env::var("YAOYOROZU_SCAN_CONCURRENCY").ok().as_deref())
}

fn parse_concurrency(value: Option<&str>) -> usize {
    value
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|n| (1..=16).contains(n))
        .unwrap_or(DEFAULT_CONCURRENCY)
}

/// `pc:data_progress` の本文。進捗表示用の軽量な通知で、データ本体は `get_pc` で取り直す。
#[derive(Clone, Serialize)]
pub struct ScanProgressDto {
    pub completed: usize,
    pub total: usize,
}

pub const DATA_LOADING_EVENT: &str = "pc:data_loading";
pub const DATA_LOADED_EVENT: &str = "pc:data_loaded";
pub const DATA_PROGRESS_EVENT: &str = "pc:data_progress";
pub const SESSIONS_UPDATED_EVENT: &str = "pc:sessions_updated";

/// 走査キューを開始し、全件の完了(または中断)まで待つ。完了時は成否によらず `pc_data_loaded` を `true` へ戻して
/// `pc:data_loaded` を出す(画面の「読み込み中」を、いつか必ず解除する)。途中で新しい世代のキューが始まったら、
/// この世代の結果は適用せず静かに終わる(完了の通知も新しい世代に任せる)。
pub async fn start(ctx: AppContext) {
    let (generation, settings) = {
        let mut guard = ctx.state.lock().await;
        guard.session_scan_generation += 1;
        (guard.session_scan_generation, guard.settings.clone())
    };

    let projects_dir = match resolve_effective_projects_dir(&settings) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("走査キュー: ルートディレクトリを解決できませんでした: {e}");
            finish(&ctx, generation, None).await;
            return;
        }
    };

    // (1) 列挙: ディレクトリ列挙 + メタデータだけ(中身は読まない)。
    let dir = projects_dir.clone();
    let refs = tokio::task::spawn_blocking(move || {
        FileSystemRepository::new(dir).enumerate_session_file_refs()
    })
    .await;
    let mut refs: Vec<SessionFileRef> = match refs {
        Ok(Ok(refs)) => refs,
        Ok(Err(e)) => {
            eprintln!("走査キュー: 会話ファイルの列挙に失敗しました: {e}");
            finish(&ctx, generation, None).await;
            return;
        }
        Err(_) => {
            eprintln!("走査キュー: バックグラウンド処理に失敗しました");
            finish(&ctx, generation, None).await;
            return;
        }
    };

    // (2) 更新時刻の降順(新しい会話から先に表示されるように)。
    refs.sort_by_key(|r| std::cmp::Reverse(r.modified_at_ms));
    let total = refs.len();
    let enumerated_paths: HashSet<PathBuf> = refs.iter().map(|r| r.file_path.clone()).collect();
    ctx.events.emit(
        DATA_PROGRESS_EVENT,
        &ScanProgressDto {
            completed: 0,
            total,
        },
    );

    // (3) n 並列で 1 ファイルずつ走査し、完了したものから反映する。
    let semaphore = Arc::new(Semaphore::new(concurrency()));
    let completed = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::with_capacity(refs.len());
    for reference in refs {
        let semaphore = semaphore.clone();
        let ctx = ctx.clone();
        let dir = projects_dir.clone();
        let completed = completed.clone();
        handles.push(tokio::spawn(async move {
            // セマフォは閉じないので、取れないことは無い(取れなければ、そのファイルを諦めるだけ)。
            let Ok(_permit) = semaphore.acquire_owned().await else {
                return;
            };
            let file_path = reference.file_path.clone();
            let parsed = tokio::task::spawn_blocking(move || {
                FileSystemRepository::new(dir).parse_session_file(&reference)
            })
            .await;

            // 走査(ファイル I/O)が終わってからロックを取る。
            let mut guard = ctx.state.lock().await;
            if guard.session_scan_generation != generation {
                return; // 旧世代: 適用しない
            }
            match parsed {
                Ok(Ok(parsed)) => {
                    let state = &mut *guard;
                    app::upsert_parsed_session(&mut state.user_sessions, parsed);
                    app::refresh_user_sessions(&mut state.pc, &state.user_sessions);
                }
                Ok(Err(e)) => eprintln!(
                    "走査キュー: {} の走査に失敗したためスキップします: {e}",
                    file_path.display()
                ),
                Err(_) => eprintln!("走査キュー: バックグラウンド処理に失敗しました"),
            }
            drop(guard);

            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            ctx.events.emit(
                DATA_PROGRESS_EVENT,
                &ScanProgressDto {
                    completed: done,
                    total,
                },
            );
        }));
    }
    for handle in handles {
        let _ = handle.await;
    }

    finish(&ctx, generation, Some(enumerated_paths)).await;
}

/// 終了処理。世代が現行のままなら、列挙に無かったパスの後始末をして、`pc_data_loaded` を `true` へ戻す。
/// `pc:data_loaded` はロックを離してから出す。
async fn finish(ctx: &AppContext, generation: u64, enumerated_paths: Option<HashSet<PathBuf>>) {
    {
        let mut guard = ctx.state.lock().await;
        if guard.session_scan_generation != generation {
            return; // 新しい世代が走っている: 完了の通知もそちらに任せる
        }
        if let Some(paths) = enumerated_paths {
            app::retain_enumerated_parsed_sessions(&mut guard.user_sessions, &paths);
            guard
                .loaded_log_lines
                .retain(|path, _| paths.contains(path));
            guard.loaded_messages.retain(|path, _| paths.contains(path));
        }
        let state = &mut *guard;
        app::refresh_user_sessions(&mut state.pc, &state.user_sessions);
        guard.pc_data_loaded = true;
    }
    ctx.events.emit(DATA_LOADED_EVENT, &());
}

/// 差分再走査の最短間隔。書き込み中の jsonl は頻繁に更新されるので、1 回の処理が終わるたびにこの時間だけ待ってから、
/// その間に溜まった変更(同じファイルは 1 件に畳む)をまとめて処理する。
pub const RESCAN_MIN_INTERVAL: Duration = Duration::from_secs(1);

/// ファイル監視が検知した会話ファイル(`paths`)の変更を、差分再走査の待ち行列へ入れる。ワーカーは高々 1 つで、
/// 動いていなければここで起動する(`app::RescanQueue`)。`handle` は、ファイル監視のスレッド(tokio の外)から
/// 呼ぶために、実行環境を渡す。
///
/// 反映があれば `pc:sessions_updated` を 1 回出す。全件の走査(`start`)との整合は、世代番号で取る
/// (全件の走査が始まると世代が上がり、同じファイルをそちらが読み直す)。`pc_data_loaded` は変えない。
pub fn enqueue_changed(ctx: AppContext, handle: &tokio::runtime::Handle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    handle.spawn(async move {
        let should_start_worker = ctx.state.lock().await.session_rescan.push(paths);
        if should_start_worker {
            run_rescan_worker(ctx).await;
        }
    });
}

/// 差分再走査のワーカー。待ち行列が空になるまで「取り出す → 処理 → 最短間隔待つ」を繰り返し、空を確認した時点
/// (取り出しと同じロックの中)で止まる。
async fn run_rescan_worker(ctx: AppContext) {
    loop {
        let (batch, generation, settings) = {
            let mut guard = ctx.state.lock().await;
            match guard.session_rescan.take_or_stop() {
                Some(batch) => (batch, guard.session_scan_generation, guard.settings.clone()),
                None => return,
            }
        };
        if rescan_batch(&ctx, generation, &settings, batch).await {
            ctx.events.emit(SESSIONS_UPDATED_EVENT, &());
        }
        tokio::time::sleep(RESCAN_MIN_INTERVAL).await;
    }
}

/// 差分再走査の結果 1 件。読み直すのは「読み込み済み(会話を開いたことがある)ファイル」の変更のときだけで、
/// それ以外は `None`(行の遅延読み込みの原則は変えない)。
enum RescanOutcome {
    Parsed(Box<ParsedSession>, Option<app::ReloadedSession>),
    Removed(PathBuf),
    Failed(PathBuf, String),
}

/// 変更のあった会話ファイルを走査して、`user_sessions` と常駐ツリー(`pc`)へ反映する。何か反映したら `true`。
async fn rescan_batch(
    ctx: &AppContext,
    generation: u64,
    settings: &domain::Settings,
    batch: Vec<PathBuf>,
) -> bool {
    let projects_dir = match resolve_effective_projects_dir(settings) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("差分再走査: ルートディレクトリを解決できませんでした: {e}");
            return false;
        }
    };

    // 行を読み直す対象(読み込み済みのファイル)を、I/O の前の短いロックで確定する。
    let loaded_paths: HashSet<PathBuf> = {
        let guard = ctx.state.lock().await;
        batch
            .iter()
            .filter(|path| guard.loaded_log_lines.contains_key(*path))
            .cloned()
            .collect()
    };

    // 走査(ファイル I/O)はロックの外で行う。
    let mut outcomes = Vec::with_capacity(batch.len());
    for path in batch {
        let dir = projects_dir.clone();
        let target = path.clone();
        let reload_lines = loaded_paths.contains(&path);
        let outcome = tokio::task::spawn_blocking(move || {
            let repo = FileSystemRepository::new(dir);
            match repo.session_file_ref(&target) {
                None => RescanOutcome::Removed(target),
                Some(reference) => match repo.parse_session_file(&reference) {
                    Ok(parsed) => {
                        let lines = if reload_lines {
                            app::reload_session(&repo, &reference.project, &reference.session_id)
                                .inspect_err(|e| {
                                    eprintln!(
                                        "差分再走査: {} の行の再読込に失敗しました(行キャッシュは前回のまま): {e}",
                                        target.display()
                                    )
                                })
                                .ok()
                        } else {
                            None
                        };
                        RescanOutcome::Parsed(Box::new(parsed), lines)
                    }
                    Err(e) => RescanOutcome::Failed(target, e.to_string()),
                },
            }
        })
        .await;
        match outcome {
            Ok(outcome) => outcomes.push(outcome),
            Err(_) => eprintln!(
                "差分再走査: バックグラウンド処理に失敗しました: {}",
                path.display()
            ),
        }
    }

    let mut guard = ctx.state.lock().await;
    if guard.session_scan_generation != generation {
        return false; // 全件の走査が始まった: そちらが同じファイルを読み直す
    }
    let mut changed = false;
    for outcome in outcomes {
        match outcome {
            RescanOutcome::Parsed(parsed, reloaded) => {
                if let Some(reloaded) = reloaded {
                    guard.store_loaded_session(parsed.conversation_file_path.clone(), reloaded);
                }
                app::upsert_parsed_session(&mut guard.user_sessions, *parsed);
                changed = true;
            }
            RescanOutcome::Removed(path) => {
                changed |= app::remove_parsed_session(&mut guard.user_sessions, &path);
                let removed_lines = guard.loaded_log_lines.remove(&path).is_some();
                let removed_messages = guard.loaded_messages.remove(&path).is_some();
                if removed_lines || removed_messages {
                    changed = true;
                }
            }
            RescanOutcome::Failed(path, message) => eprintln!(
                "差分再走査: {} の走査に失敗したためスキップします: {message}",
                path.display()
            ),
        }
    }
    if changed {
        let state = &mut *guard;
        app::refresh_user_sessions(&mut state.pc, &state.user_sessions);
    }
    changed
}

/// 「git の観測 → 全件の走査」を始める。**始めたらすぐ返る**(終わりは `pc:data_loaded` で知らせる)。
/// すでに走っている最中なら、新しく始めない(二重に走らせない)。始めたら `true`。
/// 起動時の読み込みと、`reconcile_git_state` の両方が使う。
pub async fn begin_reload(ctx: &AppContext) -> bool {
    {
        let mut guard = ctx.state.lock().await;
        if guard.reload_running {
            return false;
        }
        guard.reload_running = true;
        guard.pc_data_loaded = false;
    }
    ctx.events.emit(DATA_LOADING_EVENT, &());
    let ctx = ctx.clone();
    tokio::spawn(async move {
        // git の観測(台帳の更新)に失敗しても、走査は行う(失敗はログだけ)。
        if let Err(e) = crate::running::reload_git_ledger(&ctx).await {
            eprintln!("Git 台帳の更新に失敗しました: {e}");
        }
        start(ctx.clone()).await;
        ctx.state.lock().await.reload_running = false;
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrency_defaults_to_6_and_accepts_1_to_16() {
        assert_eq!(parse_concurrency(None), 6);
        assert_eq!(parse_concurrency(Some("1")), 1);
        assert_eq!(parse_concurrency(Some("16")), 16);
        assert_eq!(parse_concurrency(Some("0")), 6);
        assert_eq!(parse_concurrency(Some("17")), 6);
        assert_eq!(parse_concurrency(Some("abc")), 6);
    }
}
