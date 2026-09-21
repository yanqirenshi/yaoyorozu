//! セッション走査キュー(PoC)。
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
//!   近似する。正確な timestamp が必要になったら走査のついでに取る)
//! - 段階2(`Session`への組み立て)は従来どおり `get_pc` 時の純粋変換、
//!   段階3(`LogLine`)は従来どおり遅延読み込みのままで、このキューは
//!   触らない(全行を常駐させない)
//! - 並列度は既定6。PoC のため環境変数 `YAOYOROZU_SCAN_CONCURRENCY` での
//!   上書きのみ対応する(本実装では設定化する)
//! - 再読み込み・プロファイル切替との競合は世代番号
//!   (`AppState.session_scan_generation`)で防ぐ(旧世代の結果は適用しない)

use crate::state::{self, AppState};
use infra::{FileSystemRepository, SessionFileRef};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
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
                Ok(Ok(parsed)) => app::upsert_parsed_session(&mut guard.user_sessions, parsed),
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
        }
        guard.pc_data_loaded = true;
    }
    let _ = app_handle.emit("pc:data_loaded", ());
}
