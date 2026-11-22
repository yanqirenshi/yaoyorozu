---
paths:
  - "apps/native/server/**"
  - "apps/console/**"
---
# yaoyorozu をブラウザで使う形(server + console)

Rust のサーバ(`apps/native/server`、axum)+ Next.js の画面(`apps/console`)。
Tauri 版(`apps/native/tauri`・`apps/native/react`)からの移行中([#620](https://github.com/yanqirenshi/yaoyorozu/issues/620))。
本ファイルは規約である。逸脱する場合は必ず理由をコメントに残すこと。
`native.md` と食い違うときは、本ファイルを優先する。
細かい仕様(環境変数・メッセージの形・確認スクリプト)は `apps/native/server/README.md` が正。

```
ブラウザ ──> console(Next.js、127.0.0.1:3200)──中継(トークンを付ける)──> server(axum、127.0.0.1:14210)
              画面 + /api/* の中継だけ                                      claude CLI の持ち主・状態・保存
        └──────────── WebSocket(/ws、使い捨ての券で入る)──────────────────┘
```

## 1. 形

- 層は今までどおり(`crates/domain` → `app` → `infra`)。`server/` は、段取りと配信だけを持つ。
- 画面からの呼び出しは `POST /rpc/<command>` の 1 つの形。引数・DTO・エラー(`{code, message}`)は Tauri 版と同じ形で、勝手に変えない。変えるときはイシューで決め、PR の本文に変更点を書く。
- 通知と途中経過は、WebSocket の 1 本(`/ws`)。メッセージの種類を足すときは、イシューで決める。
- command を足したら、`npm run diff-commands` の対応表を合わせる。
- 移行の間、`tauri/`・`react/`・`crates/` を、この作業のついでに書き換えない(`crates/` に触るときは、イシューに明示する)。

## 2. 守り

- サーバも console も、127.0.0.1 だけで待ち受ける。
- すべての口で、トークン・Host・Origin を確かめる(読み取りも含む)。新しい command には、この 3 つの確認の検査を必ず付ける。
- トークンは、console のサーバ側だけが読む。ブラウザへ渡さない。
- WebSocket は、使い捨ての券(`issue_ws_ticket`)で入る。通す Origin は、環境変数 `YAOYOROZU_CONSOLE_PORT` から作る(未設定なら誰も通さない)。
- ブラウザの保存領域(sessionStorage・localStorage)に、券・トークン・会話の中身を置かない。
- CSP の `connect-src` を広げない。
- 本文の大きさの上限を、command ごとに持つ。上限を上げるときは、イシューで決める。

## 3. データ

- データフォルダは `%APPDATA%\com.yaoyorozu.server`。MSI 版(`com.yaoyorozu.native`)と混ぜない。
- 確認では、使い捨てのデータフォルダ・USERPROFILE・リポジトリを使う。本物の `~/.claude` と MSI 版のフォルダは、読まない・書かない。
- 本物の claude は、ユーザーの指示があるときだけ起動する。ふだんの確認は、偽の claude(`YAOYOROZU_SERVER_FAKE_CLAUDE`)で行う。
- 複数のタブから書かれるファイルには、版を持たせる(保存に `expectedRevision` を必須にし、合わなければ 409)。保存は、専用のレーンと `write_atomic` を通す。
- `profileId` は省略させない(`get_settings` を除く)。

## 4. プロセス

- サーバを止めると、サーバが起動した claude はすべて止まる(ジョブで束ねる)。ブラウザを閉じても止まらない。
- 配信が詰まった接続は、待たずに外す(件数と大きさの上限)。
- 確認スクリプトの後片付けは、`server/scripts/proc-safety.mjs` を通す(PID と開始時刻の組で、自分が起動したものと確かめてから止める。`/T` を使わない。名前一致の一括終了はしない)。

## 5. 画面(console)

- 全ページを client component にする。重い部品は `next/dynamic({ ssr: false })`。
- サーバの呼び出しは、`src/api/` の層だけを通す(画面から直接 fetch しない)。
- 新しいタブは、クリックの直後に `window.open` で開く(時間のかかる処理を先に待たない)。開かれた側で `window.opener` を切る(`noopener` は、名前付きのタブの使い回しと両立しないので使わない)。
- タブどうしの連絡(BroadcastChannel)には、あて先のプロファイルを入れる。

## 6. 確かめ方

- 軽い検査(fmt・clippy・対象のテスト・tsc)は毎回、重い検査(`cargo test --workspace`・e2e・`next build`)は PR の直前に 1 回。
- 実際のサーバ exe と中継を通した確認(`server/scripts/e2e-*.mjs`)の結果を、PR に貼る。
- 未確認のものは、未確認と書く。
- 写す元(Tauri 版)の事実が、イシューの決定と合わないときは、直す前に知らせる。
