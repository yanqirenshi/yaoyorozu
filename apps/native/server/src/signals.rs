//! 終了の合図(Ctrl+C・コンソールを閉じる・ログオフ・シャットダウン)を待つ。
//!
//! コンソールを閉じる・ログオフ・シャットダウンでは、OS が合図を送ってから**数秒(約 5 秒)**で
//! プロセスを打ち切る。その間に claude を穏やかに止める。間に合わなかった分はジョブオブジェクトが止める。

use tokio::signal::windows::{ctrl_break, ctrl_c, ctrl_close, ctrl_logoff, ctrl_shutdown};

/// どの終了の合図でもいいので、最初の 1 つを待つ。戻り値は合図の名前(ログ用)。
pub async fn wait_for_shutdown_signal() -> &'static str {
    // 登録に失敗したら、その合図は待たない(永遠に来ない扱い)。
    let mut c = ctrl_c().ok();
    let mut b = ctrl_break().ok();
    let mut close = ctrl_close().ok();
    let mut logoff = ctrl_logoff().ok();
    let mut shutdown = ctrl_shutdown().ok();
    async fn recv(s: &mut Option<tokio::signal::windows::CtrlC>) {
        match s {
            Some(s) => {
                let _ = s.recv().await;
            }
            None => std::future::pending::<()>().await,
        }
    }
    // 型が違うので、それぞれ別に待つ。
    tokio::select! {
        _ = recv(&mut c) => "Ctrl+C",
        _ = async { match &mut b { Some(s) => { let _ = s.recv().await; } None => std::future::pending::<()>().await } } => "Ctrl+Break",
        _ = async { match &mut close { Some(s) => { let _ = s.recv().await; } None => std::future::pending::<()>().await } } => "コンソールを閉じる",
        _ = async { match &mut logoff { Some(s) => { let _ = s.recv().await; } None => std::future::pending::<()>().await } } => "ログオフ",
        _ = async { match &mut shutdown { Some(s) => { let _ = s.recv().await; } None => std::future::pending::<()>().await } } => "シャットダウン",
    }
}
