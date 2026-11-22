//! 途中経過(実行中セッションの出力)を、SSE(`/events`)の接続ごとに届ける仕組み。
//!
//! - **接続の表**(接続の ID → 有限の送り口)は、**状態とは別のロック**で持つ。状態のロックの中で
//!   送り先を触らない(購読が持つのは「接続の ID と購読の ID」だけ。`state::Subscription`)。
//! - 配る側(会話ごとのイベントループ)は、状態のロックの**外**で、**待たない送信**(`try_send`)をする。
//!   送り口がいっぱい(遅い・止まったクライアント)なら、その接続の購読を全部外して SSE を閉じる。
//!   ブラウザは自動でつなぎ直し、画面は購読し直して `get_running_session` で状態を取り直す
//!   (途中経過は捨ててよい。状態は Query で取れる)。
//! - 通知(`running-session:changed` など。取りこぼしてよい)は、これまでどおりの放送(`EventBus`)。
//!   途中経過(順序が大事)は、接続ごとの待ち行列(`mpsc`)。`/events` はこの 2 つを 1 本の SSE に束ねる。
//!
//! 接続の共有(複数タブで 1 本の SSE を使う)は、ここでは作らない(#629)。1 タブ 1 本のまま、
//! 「購読の登録・配送」と「接続」を分けてあるので、後から接続の持ち方だけを差し替えられる。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, watch};

/// 接続ごとの待ち行列の長さ。途中経過は細かい(文字の断片)ので、ある程度の余裕を持たせる。
pub const PROGRESS_QUEUE_LEN: usize = 512;

/// 1 つの接続が持てる購読の数の上限(1 タブが開く会話は多くない。悪用・バグでの肥大を防ぐ)。
pub const MAX_SUBSCRIPTIONS_PER_CONNECTION: usize = 64;

/// 送る途中経過 1 件(購読の ID と、直列化済みの JSON)。
#[derive(Debug, Clone)]
pub struct ProgressMessage {
    pub subscription_id: u64,
    pub progress_json: String,
}

struct Entry {
    tx: mpsc::Sender<ProgressMessage>,
    /// 接続を閉じる合図(SSE が `take_until` で待つ)。
    kick: watch::Sender<bool>,
}

#[derive(Default)]
struct Inner {
    table: Mutex<HashMap<u64, Entry>>,
    next: AtomicU64,
}

/// 開いている SSE の接続の表。
#[derive(Clone, Default)]
pub struct Connections {
    inner: Arc<Inner>,
}

/// 接続を 1 つ開いたときの受け取り口。
pub struct OpenedConnection {
    pub id: u64,
    pub receiver: mpsc::Receiver<ProgressMessage>,
    /// 閉じる合図が来たら `true` になる。
    pub kicked: watch::Receiver<bool>,
}

/// 1 件を送った結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Sent,
    /// 送り先が無い・いっぱい・閉じている。接続は表から外し、SSE を閉じる合図を出した。
    Dropped,
}

impl Connections {
    fn table(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Entry>> {
        self.inner.table.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 接続を開く(`/events` が 1 本つながるたびに 1 回)。
    pub fn open(&self) -> OpenedConnection {
        self.open_with_len(PROGRESS_QUEUE_LEN)
    }

    pub fn open_with_len(&self, queue_len: usize) -> OpenedConnection {
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, receiver) = mpsc::channel(queue_len);
        let (kick, kicked) = watch::channel(false);
        self.table().insert(id, Entry { tx, kick });
        OpenedConnection {
            id,
            receiver,
            kicked,
        }
    }

    /// 接続を閉じる(表から外す)。無い ID は何もしない。
    pub fn close(&self, id: u64) {
        self.table().remove(&id);
    }

    pub fn is_open(&self, id: u64) -> bool {
        self.table().contains_key(&id)
    }

    pub fn len(&self) -> usize {
        self.table().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// 待たずに送る。送れなければ、その接続を表から外して閉じる合図を出す([`Delivery::Dropped`])。
    pub fn deliver(&self, conn_id: u64, message: ProgressMessage) -> Delivery {
        let mut table = self.table();
        let Some(entry) = table.get(&conn_id) else {
            return Delivery::Dropped;
        };
        match entry.tx.try_send(message) {
            Ok(()) => Delivery::Sent,
            Err(_) => {
                if let Some(entry) = table.remove(&conn_id) {
                    let _ = entry.kick.send(true);
                }
                Delivery::Dropped
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(n: u64) -> ProgressMessage {
        ProgressMessage {
            subscription_id: n,
            progress_json: format!("{{\"n\":{n}}}"),
        }
    }

    #[tokio::test]
    async fn delivers_in_order_without_waiting() {
        let table = Connections::default();
        let mut conn = table.open();
        for n in 1..=3 {
            assert_eq!(table.deliver(conn.id, message(n)), Delivery::Sent);
        }
        for n in 1..=3 {
            assert_eq!(conn.receiver.recv().await.unwrap().subscription_id, n);
        }
    }

    #[tokio::test]
    async fn a_full_queue_drops_only_that_connection_and_signals_it() {
        let table = Connections::default();
        let slow = table.open_with_len(2);
        let mut fine = table.open();
        assert_eq!(table.deliver(slow.id, message(1)), Delivery::Sent);
        assert_eq!(table.deliver(slow.id, message(2)), Delivery::Sent);
        // いっぱいの 3 件目。待たずに外れる。
        assert_eq!(table.deliver(slow.id, message(3)), Delivery::Dropped);
        assert!(!table.is_open(slow.id));
        assert!(*slow.kicked.borrow());
        // 外れたあとは、送り先が無い扱い。
        assert_eq!(table.deliver(slow.id, message(4)), Delivery::Dropped);
        // ほかの接続は影響を受けない。
        assert_eq!(table.deliver(fine.id, message(5)), Delivery::Sent);
        assert_eq!(fine.receiver.recv().await.unwrap().subscription_id, 5);
        assert!(table.is_open(fine.id));
    }

    #[tokio::test]
    async fn closing_removes_the_connection() {
        let table = Connections::default();
        let conn = table.open();
        assert!(table.is_open(conn.id));
        table.close(conn.id);
        assert!(!table.is_open(conn.id));
        assert_eq!(table.deliver(conn.id, message(1)), Delivery::Dropped);
        assert!(table.is_empty());
    }
}
