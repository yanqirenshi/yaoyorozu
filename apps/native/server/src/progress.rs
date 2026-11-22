//! 途中経過(実行中セッションの出力)を、WebSocket(`/ws`)の接続ごとに届ける仕組み。
//!
//! - **接続の表**(接続の ID → 有限の送り口)は、**状態とは別のロック**で持つ。状態のロックの中で
//!   送り先を触らない(購読が持つのは「接続の ID と購読の ID」だけ。`state::Subscription`)。
//! - 配る側(会話ごとのイベントループ)は、状態のロックの**外**で、**待たない送信**(`try_send`)をする。
//!   送り口がいっぱい(遅い・止まったクライアント)なら、その接続の購読を全部外して WebSocket を閉じる。
//!   画面は(自前で)つなぎ直し、購読し直して `get_running_session` で状態を取り直す
//!   (途中経過は捨ててよい。状態は Query で取れる)。
//! - 通知(`running-session:changed` など。取りこぼしてよい)は、これまでどおりの放送(`EventBus`)。
//!   途中経過(順序が大事)は、接続ごとの待ち行列(`mpsc`)。`/ws` はこの 2 つを 1 本の WebSocket に束ねる。
//!
//! 接続の共有(複数タブで 1 本の接続を使う)は、ここでは作らない(#629)。1 タブ 1 本のまま、
//! 「購読の登録・配送」と「接続」を分けてあるので、後から接続の持ち方だけを差し替えられる。

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tokio::sync::{watch, Notify};

/// 接続ごとの待ち行列の長さ(件数の上限)。途中経過は細かい(文字の断片)ので、ある程度の余裕を持たせる。
pub const PROGRESS_QUEUE_LEN: usize = 512;

/// 接続ごとの待ち行列にためておける大きさ(バイト数の上限)。件数か大きさの、どちらかを超えたらその接続を外す。
/// 読まない接続(裏に回って凍結されたタブなど)があっても、サーバのメモリがこの値の近くで止まる。
pub const PROGRESS_QUEUE_BYTES: usize = 16 * 1024 * 1024;

/// 1 つの接続が持てる購読の数の上限(1 タブが開く会話は多くない。悪用・バグでの肥大を防ぐ)。
pub const MAX_SUBSCRIPTIONS_PER_CONNECTION: usize = 64;

/// 送る途中経過 1 件(購読の ID と、直列化済みの JSON)。
#[derive(Debug, Clone)]
pub struct ProgressMessage {
    pub subscription_id: u64,
    pub progress_json: String,
}

impl ProgressMessage {
    /// 待ち行列での大きさ(本文のバイト数に、入れ物の分を足した目安)。
    fn size(&self) -> usize {
        self.progress_json.len() + 64
    }
}

/// 接続 1 本ぶんの待ち行列。**中身を持つのはここだけ**: 外すとき(`clear`)に、読み手の都合を待たずに、
/// たまっている分をその場で捨てて、メモリを返す(`mpsc` だと、読み手が読むか閉じるまで返らない)。
#[derive(Default)]
struct Queue {
    state: Mutex<QueueState>,
    ready: Notify,
}

#[derive(Default)]
struct QueueState {
    items: VecDeque<ProgressMessage>,
    bytes: usize,
    /// 外された(これ以上ためない・受け取り口は終わる)。
    closed: bool,
}

impl Queue {
    fn lock(&self) -> std::sync::MutexGuard<'_, QueueState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

struct Entry {
    queue: Arc<Queue>,
    /// 接続を閉じる合図(WebSocket の処理が待つ)。
    kick: watch::Sender<bool>,
    /// 件数の上限(テストで小さくできる)。
    max_len: usize,
    /// バイト数の上限(テストで小さくできる)。
    max_bytes: usize,
}

#[derive(Default)]
struct Inner {
    table: Mutex<HashMap<String, Entry>>,
}

/// 開いている WebSocket の接続の表。
#[derive(Clone, Default)]
pub struct Connections {
    inner: Arc<Inner>,
}

/// 接続を 1 つ開いたときの受け取り口。
pub struct OpenedConnection {
    /// 接続の ID。乱数から作る(UUID v4)。サーバを起動し直しても、ほかの接続の ID と一致しない
    /// (古い ID での購読・購読解除が、新しいサーバの別の接続に当たらない)。
    pub id: String,
    pub receiver: ProgressReceiver,
    /// 閉じる合図が来たら `true` になる。
    pub kicked: watch::Receiver<bool>,
}

/// 途中経過の受け取り口(WebSocket の処理が 1 件ずつ取り出す)。
pub struct ProgressReceiver {
    queue: Arc<Queue>,
}

impl ProgressReceiver {
    /// 次の 1 件を待つ。外された接続は、たまっていた分を捨てたあと `None`。
    pub async fn recv(&mut self) -> Option<ProgressMessage> {
        loop {
            let notified = self.queue.ready.notified();
            {
                let mut state = self.queue.lock();
                if let Some(message) = state.items.pop_front() {
                    state.bytes = state.bytes.saturating_sub(message.size());
                    return Some(message);
                }
                if state.closed {
                    return None;
                }
            }
            notified.await;
        }
    }
}

impl Drop for ProgressReceiver {
    fn drop(&mut self) {
        // 読み手がいなくなったら、たまっている分も捨てる。
        let mut state = self.queue.lock();
        state.closed = true;
        state.items.clear();
        state.bytes = 0;
    }
}

/// 1 件を送った結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Sent,
    /// 送り先が無い・いっぱい(件数か大きさ)・閉じている。接続は表から外し、たまっていた分をその場で捨て、
    /// WebSocket を閉じる合図を出した。
    Dropped,
}

impl Connections {
    fn table(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.inner.table.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 接続を開く(`/ws` が券の確かめを通るたびに 1 回)。
    pub fn open(&self) -> OpenedConnection {
        self.open_with_limits(PROGRESS_QUEUE_LEN, PROGRESS_QUEUE_BYTES)
    }

    pub fn open_with_len(&self, queue_len: usize) -> OpenedConnection {
        self.open_with_limits(queue_len, PROGRESS_QUEUE_BYTES)
    }

    pub fn open_with_limits(&self, max_len: usize, max_bytes: usize) -> OpenedConnection {
        let id = uuid::Uuid::new_v4().to_string();
        let queue = Arc::new(Queue::default());
        let (kick, kicked) = watch::channel(false);
        self.table().insert(
            id.clone(),
            Entry {
                queue: queue.clone(),
                kick,
                max_len,
                max_bytes,
            },
        );
        OpenedConnection {
            id,
            receiver: ProgressReceiver { queue },
            kicked,
        }
    }

    /// 接続を閉じる(表から外し、たまっている分を捨てる)。無い ID は何もしない。
    pub fn close(&self, id: &str) {
        if let Some(entry) = self.table().remove(id) {
            close_queue(&entry.queue);
        }
    }

    pub fn is_open(&self, id: &str) -> bool {
        self.table().contains_key(id)
    }

    pub fn len(&self) -> usize {
        self.table().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// たまっている件数とバイト数(確認用)。無い接続は `None`。
    pub fn queued(&self, id: &str) -> Option<(usize, usize)> {
        let table = self.table();
        let entry = table.get(id)?;
        let state = entry.queue.lock();
        Some((state.items.len(), state.bytes))
    }

    /// 待たずに送る。件数か大きさの上限を超えるときは、その接続を表から外し、**たまっている分をその場で捨てて**、
    /// 閉じる合図を出す([`Delivery::Dropped`])。読み手が読むのを待たない。
    pub fn deliver(&self, conn_id: &str, message: ProgressMessage) -> Delivery {
        let mut table = self.table();
        let Some(entry) = table.get(conn_id) else {
            return Delivery::Dropped;
        };
        let size = message.size();
        let accepted = {
            let mut state = entry.queue.lock();
            if state.closed
                || state.items.len() >= entry.max_len
                || state.bytes + size > entry.max_bytes
            {
                false
            } else {
                state.items.push_back(message);
                state.bytes += size;
                true
            }
        };
        if accepted {
            entry.queue.ready.notify_one();
            return Delivery::Sent;
        }
        if let Some(entry) = table.remove(conn_id) {
            close_queue(&entry.queue);
            let _ = entry.kick.send(true);
        }
        Delivery::Dropped
    }
}

/// 待ち行列を閉じて、たまっている分をその場で捨てる(メモリを返す)。受け取り口は、起こされて終わる。
fn close_queue(queue: &Queue) {
    {
        let mut state = queue.lock();
        state.closed = true;
        state.items.clear();
        state.items.shrink_to_fit();
        state.bytes = 0;
    }
    queue.ready.notify_one();
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
            assert_eq!(table.deliver(&conn.id, message(n)), Delivery::Sent);
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
        assert_eq!(table.deliver(&slow.id, message(1)), Delivery::Sent);
        assert_eq!(table.deliver(&slow.id, message(2)), Delivery::Sent);
        // いっぱいの 3 件目。待たずに外れる。
        assert_eq!(table.deliver(&slow.id, message(3)), Delivery::Dropped);
        assert!(!table.is_open(&slow.id));
        assert!(*slow.kicked.borrow());
        // 外れたあとは、送り先が無い扱い。
        assert_eq!(table.deliver(&slow.id, message(4)), Delivery::Dropped);
        // ほかの接続は影響を受けない。
        assert_eq!(table.deliver(&fine.id, message(5)), Delivery::Sent);
        assert_eq!(fine.receiver.recv().await.unwrap().subscription_id, 5);
        assert!(table.is_open(&fine.id));
    }

    #[tokio::test]
    async fn closing_removes_the_connection() {
        let table = Connections::default();
        let conn = table.open();
        assert!(table.is_open(&conn.id));
        table.close(&conn.id);
        assert!(!table.is_open(&conn.id));
        assert_eq!(table.deliver(&conn.id, message(1)), Delivery::Dropped);
        assert!(table.is_empty());
    }

    fn big(n: u64, bytes: usize) -> ProgressMessage {
        ProgressMessage {
            subscription_id: n,
            progress_json: "x".repeat(bytes),
        }
    }

    #[tokio::test]
    async fn exceeding_the_byte_limit_drops_the_connection_and_frees_the_queue_at_once() {
        let table = Connections::default();
        // 件数には余裕があるが、大きさの上限は 1,000 バイト。
        let mut slow = table.open_with_limits(512, 1000);
        assert_eq!(table.deliver(&slow.id, big(1, 400)), Delivery::Sent);
        assert_eq!(table.deliver(&slow.id, big(2, 400)), Delivery::Sent);
        let (len, bytes) = table.queued(&slow.id).unwrap();
        assert_eq!(len, 2);
        assert!(bytes <= 1000, "{bytes}");
        // 3 件目で大きさの上限を超える。外れて、たまっていた分はその場で捨てられる(読み手は何も読んでいない)。
        assert_eq!(table.deliver(&slow.id, big(3, 400)), Delivery::Dropped);
        assert!(!table.is_open(&slow.id));
        assert!(*slow.kicked.borrow());
        assert_eq!(table.queued(&slow.id), None);
        // 読み手が読み始めても、捨てたものは出てこない(終わる)。
        assert!(slow.receiver.recv().await.is_none());
    }

    #[tokio::test]
    async fn one_message_larger_than_the_limit_is_not_kept() {
        let table = Connections::default();
        let conn = table.open_with_limits(512, 100);
        assert_eq!(table.deliver(&conn.id, big(1, 500)), Delivery::Dropped);
        assert!(!table.is_open(&conn.id));
    }

    #[tokio::test]
    async fn the_byte_count_goes_down_as_the_reader_takes_messages() {
        let table = Connections::default();
        let mut conn = table.open_with_limits(512, 1000);
        for n in 1..=2 {
            assert_eq!(table.deliver(&conn.id, big(n, 400)), Delivery::Sent);
        }
        conn.receiver.recv().await.unwrap();
        conn.receiver.recv().await.unwrap();
        assert_eq!(table.queued(&conn.id), Some((0, 0)));
        // 読んだぶん空いたので、また入る。
        assert_eq!(table.deliver(&conn.id, big(3, 400)), Delivery::Sent);
    }
}
