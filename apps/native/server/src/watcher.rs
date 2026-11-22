//! 会話ファイルの監視(`session:changed` イベント)。写し元: `tauri/src/lib.rs` の
//! `start_session_watcher`。ハブの差分再走査(`session_scan_queue`)は段階 4 で足す。
//!
//! 書き込みが続く会話(実行中のセッション)では、ファイル監視が 0.1 秒ごとに通知を出す。そのまま配ると、
//! 画面が 0.1 秒ごとに一覧と会話を取り直す。**同じプロジェクトの通知は、最短 [`MIN_EMIT_INTERVAL`] の間隔で
//! 配る**(間隔の内に来た通知は、間隔が明けたあとに 1 回にまとめて配る。最後の変更は必ず届く)。
//! 画面側も同じ考えで間引く(`apps/console/src/coalescedRunner.ts`)。

use crate::dto::{AgentKindDto, SessionChangedEventDto};
use crate::events::EventBus;
use crate::AppContext;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 同じプロジェクトの `session:changed` を配る最短の間隔。
pub const MIN_EMIT_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Default)]
struct ProjectState {
    last_emit: Option<Instant>,
    /// 間隔の内に来て、まだ配っていない通知があるか(その配信を予約済みか)。
    trailing_scheduled: bool,
}

/// プロジェクトごとの通知の間引き。
#[derive(Clone)]
pub struct ChangeThrottle {
    events: EventBus,
    interval: Duration,
    states: Arc<Mutex<HashMap<String, ProjectState>>>,
}

impl ChangeThrottle {
    pub fn new(events: EventBus, interval: Duration) -> Self {
        Self {
            events,
            interval,
            states: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// プロジェクトの変更を受ける。間隔があいていればすぐ配り、間隔の内なら、明けたあとに 1 回配る。
    pub fn notify(&self, project: String) {
        let wait = {
            let mut states = self.states.lock().unwrap_or_else(|p| p.into_inner());
            let state = states.entry(project.clone()).or_default();
            let now = Instant::now();
            match state.last_emit {
                Some(last) if now.duration_since(last) < self.interval => {
                    if state.trailing_scheduled {
                        return; // すでに予約済み(まとめて 1 回)
                    }
                    state.trailing_scheduled = true;
                    Some(self.interval - now.duration_since(last))
                }
                _ => {
                    state.last_emit = Some(now);
                    None
                }
            }
        };
        match wait {
            None => self.emit(&project),
            Some(wait) => {
                let this = self.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(wait);
                    {
                        let mut states = this.states.lock().unwrap_or_else(|p| p.into_inner());
                        let state = states.entry(project.clone()).or_default();
                        state.trailing_scheduled = false;
                        state.last_emit = Some(Instant::now());
                    }
                    this.emit(&project);
                });
            }
        }
    }

    fn emit(&self, project: &str) {
        self.events.emit(
            "session:changed",
            &SessionChangedEventDto {
                project: project.to_string(),
                agent: AgentKindDto::ClaudeCode,
            },
        );
    }
}

/// `root` の変更監視を(再)開始し、変更を `session:changed` イベントとして配る。
/// 既存の監視は、スロットの中身を新しいものに差し替えることで止まる(drop されると止まる)。
/// 失敗してもサーバは止めず、ログだけ出す(直前の監視があればそのまま残る)。
pub fn start_session_watcher(ctx: &AppContext, root: PathBuf) {
    let repo = infra::FileSystemRepository::new(root);
    let throttle = ChangeThrottle::new(ctx.events.clone(), MIN_EMIT_INTERVAL);
    match repo.watch_projects(move |change| throttle.notify(change.project)) {
        Ok(new_watcher) => match ctx.watcher.lock() {
            Ok(mut guard) => *guard = Some(new_watcher),
            Err(poisoned) => *poisoned.into_inner() = Some(new_watcher),
        },
        Err(e) => eprintln!("セッションの監視を開始できませんでした: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(rx: &mut tokio::sync::broadcast::Receiver<crate::events::ServerEvent>) -> usize {
        let mut n = 0;
        while rx.try_recv().is_ok() {
            n += 1;
        }
        n
    }

    #[test]
    fn a_burst_of_changes_is_coalesced_and_the_last_one_still_arrives() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        let throttle = ChangeThrottle::new(bus, Duration::from_millis(200));

        // 20 ms ごとに 30 回(0.6 秒)。間引かなければ 30 件。
        for _ in 0..30 {
            throttle.notify("proj".to_string());
            std::thread::sleep(Duration::from_millis(20));
        }
        // 最後の予約の配信を待つ。
        std::thread::sleep(Duration::from_millis(400));
        let n = count(&mut rx);
        assert!(
            (2..=5).contains(&n),
            "0.6 秒の連続した変更は数件にまとまる: {n}"
        );

        // 静かになったあとの変更は、すぐ配る。
        throttle.notify("proj".to_string());
        assert_eq!(count(&mut rx), 1);
    }

    #[test]
    fn different_projects_are_throttled_separately() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        let throttle = ChangeThrottle::new(bus, Duration::from_millis(300));
        throttle.notify("a".to_string());
        throttle.notify("b".to_string());
        assert_eq!(count(&mut rx), 2, "別のプロジェクトは互いに待たない");
    }
}
