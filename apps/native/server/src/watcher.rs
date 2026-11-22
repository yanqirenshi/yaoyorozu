//! 会話ファイルの監視(`session:changed` イベント)。写し元: `tauri/src/lib.rs` の
//! `start_session_watcher`。ハブの差分再走査(`session_scan_queue`)は段階 4 で足す。

use crate::dto::{AgentKindDto, SessionChangedEventDto};
use crate::AppContext;
use std::path::PathBuf;

/// `root` の変更監視を(再)開始し、変更を `session:changed` イベントとして配る。
/// 既存の監視は、スロットの中身を新しいものに差し替えることで止まる(drop されると止まる)。
/// 失敗してもサーバは止めず、ログだけ出す(直前の監視があればそのまま残る)。
pub fn start_session_watcher(ctx: &AppContext, root: PathBuf) {
    let repo = infra::FileSystemRepository::new(root);
    let events = ctx.events.clone();
    match repo.watch_projects(move |change| {
        events.emit(
            "session:changed",
            &SessionChangedEventDto {
                project: change.project,
                agent: AgentKindDto::ClaudeCode,
            },
        );
    }) {
        Ok(new_watcher) => match ctx.watcher.lock() {
            Ok(mut guard) => *guard = Some(new_watcher),
            Err(poisoned) => *poisoned.into_inner() = Some(new_watcher),
        },
        Err(e) => eprintln!("セッションの監視を開始できませんでした: {e}"),
    }
}
