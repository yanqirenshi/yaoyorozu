//! 読まれなかった要求の本文を、応答のあとに読み捨てる。
//!
//! 入口が本文を読まずに応答する(認証の拒否・上限超過の 413・本文を使わない入口・405 など)と、HTTP/1 の接続は、読み残した
//! 本文が受信側に残ったまま閉じられる。このとき OS は接続を「リセット」で閉じ、送っている側(Next.js の中継など)は、
//! 応答を読む前に書き込みの失敗(ECONNRESET)を受け取って、応答が取れなくなる(本文が約 1MB 以上のとき、数回に 1 回)。
//!
//! 本文の持ち主(入口)が本文を捨てたとき、まだ最後まで届いていなければ、残りを読み捨ててから接続を閉じる
//! (読み捨てる量と時間には上限がある。上限を超えたら、あきらめて閉じる)。応答は、読み捨てを待たずに返る。

use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use axum::body::Body;
use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use http_body::{Body as HttpBody, Frame, SizeHint};

/// 読み捨てる量の上限(これを超えたら、あきらめて閉じる)。サーバが受け付ける最大の本文(26MB)より大きい値。
const DRAIN_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// 読み捨てる時間の上限。
const DRAIN_MAX_TIME: Duration = Duration::from_secs(10);

/// 本文を包み、最後まで読まれないまま捨てられたら、残りを読み捨てる。
struct DrainOnDrop {
    inner: Option<Body>,
    ended: bool,
}

impl HttpBody for DrainOnDrop {
    type Data = <Body as HttpBody>::Data;
    type Error = <Body as HttpBody>::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        let Some(inner) = self.inner.as_mut() else {
            return Poll::Ready(None);
        };
        let polled = Pin::new(inner).poll_frame(cx);
        match &polled {
            Poll::Ready(None) | Poll::Ready(Some(Err(_))) => self.ended = true,
            _ => {}
        }
        polled
    }

    fn is_end_stream(&self) -> bool {
        self.inner.as_ref().is_none_or(|b| b.is_end_stream())
    }

    fn size_hint(&self) -> SizeHint {
        self.inner
            .as_ref()
            .map_or_else(|| SizeHint::with_exact(0), |b| b.size_hint())
    }
}

impl Drop for DrainOnDrop {
    fn drop(&mut self) {
        if self.ended {
            return;
        }
        let Some(mut body) = self.inner.take() else {
            return;
        };
        // 実行環境(tokio)の外で捨てられたときは、読み捨てない(テストなど)。
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            return;
        };
        handle.spawn(async move {
            let drain = async {
                let mut total = 0u64;
                while let Some(frame) =
                    std::future::poll_fn(|cx| Pin::new(&mut body).poll_frame(cx)).await
                {
                    match frame {
                        Ok(frame) => {
                            if let Some(data) = frame.data_ref() {
                                total += data.len() as u64;
                                if total > DRAIN_MAX_BYTES {
                                    return;
                                }
                            }
                        }
                        Err(_) => return,
                    }
                }
            };
            let _ = tokio::time::timeout(DRAIN_MAX_TIME, drain).await;
        });
    }
}

/// すべての入口に掛ける。要求の本文を、読み残しがあれば応答のあとに読み捨てる形で包む。
pub async fn drain_unread_body(request: Request, next: Next) -> Response {
    let (parts, body) = request.into_parts();
    let body = Body::new(DrainOnDrop {
        inner: Some(body),
        ended: false,
    });
    next.run(Request::from_parts(parts, body)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Bytes;
    use futures_util::stream;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn counted(chunks: usize, read: Arc<AtomicUsize>) -> Body {
        Body::from_stream(stream::iter((0..chunks).map(move |_| {
            read.fetch_add(1, Ordering::SeqCst);
            Ok::<_, std::io::Error>(Bytes::from(vec![0u8; 1024]))
        })))
    }

    #[tokio::test]
    async fn an_unread_body_is_drained_after_it_is_dropped() {
        let read = Arc::new(AtomicUsize::new(0));
        let wrapped = DrainOnDrop {
            inner: Some(counted(50, read.clone())),
            ended: false,
        };
        // 1 つも読まずに捨てる(本文を読まずに応答した入口と同じ)。
        drop(wrapped);
        for _ in 0..100 {
            if read.load(Ordering::SeqCst) == 50 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(
            read.load(Ordering::SeqCst),
            50,
            "残りが最後まで読み捨てられる"
        );
    }

    #[tokio::test]
    async fn a_fully_read_body_is_not_drained_again() {
        let read = Arc::new(AtomicUsize::new(0));
        let mut wrapped = DrainOnDrop {
            inner: Some(counted(3, read.clone())),
            ended: false,
        };
        while std::future::poll_fn(|cx| Pin::new(&mut wrapped).poll_frame(cx))
            .await
            .is_some()
        {}
        assert!(wrapped.ended);
        drop(wrapped);
        assert_eq!(read.load(Ordering::SeqCst), 3);
    }
}
