//! 会話中などに出てくる URL(例: apps/web のリンク)を押したとき、app 自身の画面の中で
//! 開かず、既定のブラウザへ渡す(issue #541)。
//!
//! ウィンドウはハブ・各プロファイルのビューアで複数あり(native.md §6「1ウィンドウ=
//! 1プロファイル」)、個々のウィンドウ生成箇所(`open_profile_window` 等)やフロントの
//! リンクごとに手を入れるのではなく、tauri plugin の `on_navigation` フック1箇所で
//! 全ウィンドウに効かせる(公式ドキュメントの例と同じ使い方。`tauri::plugin::Builder`)。
//!
//! 判定は「今のウィンドウの起点(origin)と同じか」だけで行う: 本番は `tauri://localhost`、
//! 開発は `--config` で変わる devUrl(例 `http://localhost:1420`)だが、どちらも
//! **決め打ちの文字列と比較しない**。ナビゲーション先を、そのウィンドウが今いる場所の
//! 起点と比較するだけなので、開発版のポートが変わっても常に正しく動く。パス・ハッシュの
//! 違いは起点に影響しないため、HashRouter の画面遷移(同一起点への移動)は常に許可される。
//! 既定のブラウザへ渡す実体は `tauri-plugin-opener` の `open_url`(フロントの `openUrl`
//! (#521の「仕様」等)と同じ実体。ここで止めるのは WebView 内で開こうとしたナビゲーション
//! だけで、`openUrl` 自体はこのフックを経由しないため二重に開かない)。

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("external-link-guard")
        .on_navigation(|webview, url| {
            // 許可する側に倒す条件(実機で確認。issue #541):
            // - 今の場所が分からない(エラー)→ 機能を壊さないよう許可。
            // - 今の場所がまだ `about:blank`(ウィンドウ生成直後、アプリ自身の最初の
            //   読み込みの前)→ これを「外部」としてブロックすると、アプリ自身が
            //   一度も起動できなくなる(起点が無(opaque)で、どの起点とも一致しない
            //   ため)。ここだけは起点を比較せず常に許可する。
            // - それ以外は、今のウィンドウの起点(本番 `tauri://localhost`、開発は
            //   `--config` で変わる devUrl)と同じ起点への移動だけを許可する。
            let same_origin = match webview.url() {
                Err(_) => true,
                Ok(current) if current.as_str() == "about:blank" => true,
                Ok(current) => current.origin() == url.origin(),
            };
            if same_origin {
                return true;
            }
            // `open_url`(Windows では `ShellExecuteExW` + `CoInitialize`)を、このコール
            // バックと同じスレッド(WebView2 のUI/メッセージスレッド)で同期的に呼ぶと、
            // ハングする(実機で確認。issue #541)。専用のスレッドへ逃がす。
            let url = url.clone();
            std::thread::spawn(move || {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            });
            false
        })
        .build()
}
