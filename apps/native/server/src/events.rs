//! イベントの配信(Tauri の `AppHandle.emit` に当たるもの)。
//!
//! 差し替えやすいよう小さな型にまとめる。配信先は `GET /events`(SSE)。
//! イベント名は SSE の `event:`、ペイロードは `data:` の JSON。

use serde::Serialize;
use tokio::sync::broadcast;

/// 1 件のイベント。
#[derive(Clone, Debug)]
pub struct ServerEvent {
    pub name: String,
    /// JSON 文字列(送る直前に直列化済み)。
    pub data: String,
}

/// 全購読者へ配るバス。購読者が 0 人でも送れる(捨てられる)。
#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<ServerEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx }
    }

    /// `AppHandle.emit(name, payload)` 相当。
    pub fn emit<T: Serialize>(&self, name: &str, payload: &T) {
        let data = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_string());
        let _ = self.tx.send(ServerEvent {
            name: name.to_string(),
            data,
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ServerEvent> {
        self.tx.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_subscriber_receives_emitted_events_in_order() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        bus.emit("ping", &serde_json::json!({"n": 1}));
        bus.emit("ping", &serde_json::json!({"n": 2}));
        assert_eq!(rx.recv().await.unwrap().data, r#"{"n":1}"#);
        assert_eq!(rx.recv().await.unwrap().data, r#"{"n":2}"#);
    }

    #[test]
    fn emitting_without_subscribers_does_not_fail() {
        EventBus::new().emit("ping", &1);
    }
}
