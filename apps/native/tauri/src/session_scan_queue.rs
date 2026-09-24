//! セッション走査キュー。
//!
//! 従来はセッション一覧の走査(段階1)を全プロジェクト一括のブロッキング
//! 処理で行っていたが、これを **jsonlファイル単位** に分割し、
//! 更新時刻(mtime)の降順・n並列で実行して、完了したものから
//! `AppState.user_sessions` へ反映する。ハブは `pc:data_progress` を
//! 契機に `get_pc` で取り直すことで、新しいセッションから順に
//! 逐次表示される。
//!
//! - 列挙(`enumerate_session_file_refs`)はディレクトリ列挙とメタデータの
//!   取得のみで、ファイルの中身は読まない(キューの実行優先度は mtime で
//!   近似する。timestamp を使う機能が無く近似で足りるため、正確な値は取らない。
//!   issue #296 のスコープ再評価で「やらない」と判断した)
//! - 段階2(`Session`/`SessionFile`への組み立て)は**常駐化**した(Session常駐化
//!   PoC): 素材(`user_sessions`)を変更した箇所が `app::refresh_user_sessions` で
//!   `AppState.pc` 内の保持ツリーを更新し、`get_pc` は組み立てをしない
//! - 段階3(`LogLine`)は従来どおり遅延読み込み(開いたときに読む)だが、
//!   読み込み済みファイルに変更があれば差分再走査が行も自動で読み直す
//!   (`rescan_batch`)
//! - 並列度は既定6。環境変数 `YAOYOROZU_SCAN_CONCURRENCY` での上書きのみ対応する。
//!   走査のパース高速化(issue #302)後の実測で、並列度は4〜6で頭打ち(52ファイルの
//!   全件が 4並列0.89s / 6並列0.81s / 8並列0.74s / 12並列0.80s)のため、設定
//!   (settings.json)へは昇格しない(issue #296 のスコープ再評価)
//! - 進捗イベント(`pc:data_progress`)はファイル完了ごとに発火する。全件が1秒
//!   未満で終わり、ハブ側は末尾デバウンス(300ms)で取り直すため、送信側での
//!   間引きはしない(同上)
//! - ファイル監視との接続(issue #311): `SessionWatcher` が検知した会話ファイルの
//!   変更だけを `enqueue_changed` で差分再走査し、`user_sessions` へ upsert /
//!   削除して `pc:sessions_updated` で通知する(全件再走査はしない)。詳細は
//!   `enqueue_changed` を参照
//! - 再読み込み・プロファイル切替との競合は世代番号
//!   (`AppState.session_scan_generation`)で防ぐ(旧世代の結果は適用しない)

use crate::state::{self, AppState};
use domain::ParsedSession;
use infra::{FileSystemRepository, SessionFileRef};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, Semaphore};

const DEFAULT_CONCURRENCY: usize = 6;

/// 並列度。PoC: 環境変数での上書きのみ(1〜16に制限)。
fn concurrency() -> usize {
    std::env::var("YAOYOROZU_SCAN_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|n| (1..=16).contains(n))
        .unwrap_or(DEFAULT_CONCURRENCY)
}

/// `pc:data_progress` のペイロード。進捗表示用の軽量な通知に留め、
/// データ本体は購読側が `get_pc` で取り直す(native.md §3)。
#[derive(Clone, serde::Serialize)]
struct ScanProgressDto {
    completed: usize,
    total: usize,
}

/// 走査キューを開始し、全件の完了(または中断)まで待つ。
///
/// 完了時は成否によらず `pc_data_loaded` を `true` へ戻して
/// `pc:data_loaded` を発火する(issue #218 の「永久loading防止」の保証を
/// 従来の一括読み込みから引き継ぐ)。途中で新しい世代のキューが開始された
/// 場合、この世代の結果は適用せず静かに終了する(完了イベントも新世代側に
/// 任せる)。
pub async fn start(app_handle: tauri::AppHandle) {
    let (generation, settings) = {
        let state = app_handle.state::<Mutex<AppState>>();
        let mut guard = state.lock().await;
        guard.session_scan_generation += 1;
        (guard.session_scan_generation, guard.settings.clone())
    };

    let projects_dir = match state::resolve_effective_projects_dir(&settings) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("走査キュー: ルートディレクトリを解決できませんでした: {e}");
            finish(&app_handle, generation, None).await;
            return;
        }
    };

    // (1) 列挙: ディレクトリ列挙 + metadata のみ(中身は読まない)
    let dir = projects_dir.clone();
    let refs = tauri::async_runtime::spawn_blocking(move || {
        FileSystemRepository::new(dir).enumerate_session_file_refs()
    })
    .await;
    let mut refs: Vec<SessionFileRef> = match refs {
        Ok(Ok(refs)) => refs,
        Ok(Err(e)) => {
            eprintln!("走査キュー: 会話ファイルの列挙に失敗しました: {e}");
            finish(&app_handle, generation, None).await;
            return;
        }
        Err(_) => {
            eprintln!("走査キュー: バックグラウンド処理に失敗しました");
            finish(&app_handle, generation, None).await;
            return;
        }
    };

    // (2) 更新時刻の降順(新しいセッションから先に表示されるように)
    refs.sort_by_key(|r| std::cmp::Reverse(r.modified_at_ms));
    let total = refs.len();
    let enumerated_paths: HashSet<PathBuf> = refs.iter().map(|r| r.file_path.clone()).collect();
    let _ = app_handle.emit(
        "pc:data_progress",
        ScanProgressDto {
            completed: 0,
            total,
        },
    );

    // (3) n並列で1ファイルずつ走査し、完了したものから反映する
    let semaphore = Arc::new(Semaphore::new(concurrency()));
    let completed = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::with_capacity(refs.len());
    for reference in refs {
        let semaphore = semaphore.clone();
        let app = app_handle.clone();
        let dir = projects_dir.clone();
        let completed = completed.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            // Semaphore は close しないため acquire は失敗しない(失敗時は
            // そのファイルを諦めるだけで、キュー全体は止めない)
            let Ok(_permit) = semaphore.acquire_owned().await else {
                return;
            };
            let file_path = reference.file_path.clone();
            let parsed = tauri::async_runtime::spawn_blocking(move || {
                FileSystemRepository::new(dir).parse_session_file(&reference)
            })
            .await;

            // 走査(ファイルI/O)が終わってからロックを取る(native.md §2)
            let state = app.state::<Mutex<AppState>>();
            let mut guard = state.lock().await;
            if guard.session_scan_generation != generation {
                return; // 旧世代: 適用しない
            }
            match parsed {
                Ok(Ok(parsed)) => {
                    let state_mut = &mut *guard;
                    app::upsert_parsed_session(&mut state_mut.user_sessions, parsed);
                    // 常駐化: 素材の変更を保持ツリー(AppState.pc)へ反映する
                    app::refresh_user_sessions(&mut state_mut.pc, &state_mut.user_sessions);
                }
                Ok(Err(e)) => eprintln!(
                    "走査キュー: {} の走査に失敗したためスキップします: {e}",
                    file_path.display()
                ),
                Err(_) => eprintln!("走査キュー: バックグラウンド処理に失敗しました"),
            }
            drop(guard);

            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = app.emit(
                "pc:data_progress",
                ScanProgressDto {
                    completed: done,
                    total,
                },
            );
        }));
    }
    for handle in handles {
        let _ = handle.await;
    }

    finish(&app_handle, generation, Some(enumerated_paths)).await;
}

/// キューの終了処理。世代が現行のままなら、列挙に無かったパスの後始末を
/// 行い、`pc_data_loaded` を `true` へ戻す。`pc:data_loaded` はロックを
/// 離してから発火する(native.md §2)。
async fn finish(
    app_handle: &tauri::AppHandle,
    generation: u64,
    enumerated_paths: Option<HashSet<PathBuf>>,
) {
    let state = app_handle.state::<Mutex<AppState>>();
    {
        let mut guard = state.lock().await;
        if guard.session_scan_generation != generation {
            return; // 新しい世代が走っている: 完了通知もそちらに任せる
        }
        if let Some(paths) = enumerated_paths {
            app::retain_enumerated_parsed_sessions(&mut guard.user_sessions, &paths);
            // 常駐化: 列挙に無かった(消えた)ファイルは行キャッシュも後始末する
            guard
                .loaded_log_lines
                .retain(|path, _| paths.contains(path));
            guard.loaded_messages.retain(|path, _| paths.contains(path));
        }
        // 常駐化: 後始末の結果を保持ツリーへ反映する
        let state_mut = &mut *guard;
        app::refresh_user_sessions(&mut state_mut.pc, &state_mut.user_sessions);
        guard.pc_data_loaded = true;
    }
    let _ = app_handle.emit("pc:data_loaded", ());
}

/// 差分再走査の最短間隔。書き込み中の jsonl は頻繁に更新され、ファイル監視側の
/// デバウンス(400ms)だけでは 0.4 秒ごとに走査が走りうる。1回の処理が終わるたびに
/// この時間だけ待ってから、その間に溜まった変更を(同じファイルは1件に畳んで)
/// まとめて処理する。よって 1ファイルの走査は最短間隔+走査時間に1回まで。
const RESCAN_MIN_INTERVAL: Duration = Duration::from_secs(1);

/// `pc:sessions_updated` のペイロードは無し。軽量な通知に留め、データ本体は
/// 購読側が `get_pc` で取り直す(native.md §3.2)。
const SESSIONS_UPDATED_EVENT: &str = "pc:sessions_updated";

/// ファイル監視が検知した会話ファイル(`paths`)の変更を、差分再走査の待ち行列へ
/// 入れる(issue #311)。ワーカーは高々1つで、動いていなければここで起動する
/// (`app::RescanQueue`)。ワーカーは溜まった変更を取り出して次のとおり処理する。
///
/// - 存在するファイル: 1件だけ走査(`parse_session_file`。走査キャッシュは mtime 単位)
///   して `user_sessions` へ upsert する
/// - 削除されたファイル: `user_sessions` から取り除く(同 `session_id` の別ファイルが
///   残れば、集約(#217)の結果 `Session` は残る)
///
/// 反映があれば `pc:sessions_updated` を1回発火する(ハブが `get_pc` を取り直す)。
///
/// 起動時・手動再読み込みの全件キュー(`start`)との整合: 差分の走査結果は、走査の
/// 開始時点と適用時点で世代番号(`session_scan_generation`)が変わっていれば適用しない
/// (全件キューが開始されると世代が上がり、その全件走査が同じファイルを読み直すため)。
/// 差分再走査は `pc_data_loaded` を変えない(#218 の保証は全件キュー側の責務のまま)。
/// Git 台帳の再観測は行わない。
pub fn enqueue_changed(app_handle: tauri::AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let should_start_worker = {
            let state = app_handle.state::<Mutex<AppState>>();
            let mut guard = state.lock().await;
            guard.session_rescan.push(paths)
        };
        if should_start_worker {
            run_rescan_worker(app_handle).await;
        }
    });
}

/// 差分再走査のワーカー。待ち行列が空になるまで「取り出す → 処理 → 最短間隔待つ」を
/// 繰り返し、空を確認した時点(取り出しと同じロックの中)で止まる。
async fn run_rescan_worker(app_handle: tauri::AppHandle) {
    loop {
        let (batch, generation, settings) = {
            let state = app_handle.state::<Mutex<AppState>>();
            let mut guard = state.lock().await;
            match guard.session_rescan.take_or_stop() {
                Some(batch) => (batch, guard.session_scan_generation, guard.settings.clone()),
                None => return,
            }
        };

        if rescan_batch(&app_handle, generation, &settings, batch).await {
            let _ = app_handle.emit(SESSIONS_UPDATED_EVENT, ());
        }
        tokio::time::sleep(RESCAN_MIN_INTERVAL).await;
    }
}

/// 差分再走査の結果1件。`Parsed` の第2要素は再読込した会話の内容
/// (メッセージ・行(`LogLine`)。1回の読みで両方得る。issue #350)。
/// 読み直すのは「読み込み済み(ビューアで開いたことがある)ファイル」の
/// 変更時のみで、それ以外は `None`(遅延読み込みの原則は変えない。常駐化 PoC)。
enum RescanOutcome {
    Parsed(Box<ParsedSession>, Option<app::ReloadedSession>),
    Removed(PathBuf),
    Failed(PathBuf, String),
}

/// 変更のあった会話ファイルを走査して `user_sessions` と保持ツリー
/// (`AppState.pc`)へ反映する。読み込み済みファイルは行(`LogLine`)も
/// 読み直す(常駐化 PoC)。何か反映したら `true`(通知が必要)。
async fn rescan_batch(
    app_handle: &tauri::AppHandle,
    generation: u64,
    settings: &domain::Settings,
    batch: Vec<PathBuf>,
) -> bool {
    let projects_dir = match state::resolve_effective_projects_dir(settings) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("差分再走査: ルートディレクトリを解決できませんでした: {e}");
            return false;
        }
    };

    // 行の再読込対象(読み込み済みファイル)かどうかを先に確定する
    // (I/O前の短いロック。native.md §2)
    let loaded_paths: HashSet<PathBuf> = {
        let state = app_handle.state::<Mutex<AppState>>();
        let guard = state.lock().await;
        batch
            .iter()
            .filter(|path| guard.loaded_log_lines.contains_key(*path))
            .cloned()
            .collect()
    };

    // 走査(ファイルI/O)はロックの外で行う(native.md §2)
    let mut outcomes = Vec::with_capacity(batch.len());
    for path in batch {
        let dir = projects_dir.clone();
        let target = path.clone();
        let reload_lines = loaded_paths.contains(&path);
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let repo = FileSystemRepository::new(dir);
            match repo.session_file_ref(&target) {
                None => RescanOutcome::Removed(target),
                Some(reference) => match repo.parse_session_file(&reference) {
                    Ok(parsed) => {
                        let lines = if reload_lines {
                            app::reload_session(
                                &repo,
                                &reference.project,
                                &reference.session_id,
                            )
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

    let state = app_handle.state::<Mutex<AppState>>();
    let mut guard = state.lock().await;
    if guard.session_scan_generation != generation {
        return false; // 全件キューが開始された: そちらが同じファイルを読み直す
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
                // 常駐化: 削除されたファイルの行キャッシュも後始末する
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
        // 常駐化: 素材の変更を保持ツリー(AppState.pc)へ反映する
        let state_mut = &mut *guard;
        app::refresh_user_sessions(&mut state_mut.pc, &state_mut.user_sessions);
    }
    changed
}
