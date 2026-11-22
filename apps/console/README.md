# console(YAOYOROZU の画面。名前は仮)

`apps/native` の画面を、Tauri(Vite)から Next.js(ブラウザ)へ移すアプリ(#620)。
画面と `/api/*` の中継だけを持つ。業務ロジックと状態は Rust のサーバ(`apps/native/server`)にある。
段階 1(#622)では `/settings` にプロファイルの一覧を出すところまで。

## 起動

Rust サーバを先に起動する(`apps/native/server/README.md`)。

```bash
npm run server:dev     # ターミナル 1: Rust サーバ(14210 番)
npm run console:dev    # ターミナル 2: 画面(http://127.0.0.1:3200/settings)
```

- 開発サーバは **127.0.0.1 の 3200 番**だけで待ち受ける(3000 = web、3100/4000 = hub、1420/1425 = Vite は使用中)。
- サーバのデータフォルダを変えたときは、`console:dev` にも同じ環境変数 `YAOYOROZU_DATA_DIR` を渡す
  (中継が `server-token`・`server-port` をそこから読む)。MSI 版のフォルダは読まない。
- `console:dev` は先にデザイントークン(`tokens.css`)を生成する(`npm run tokens`)。

## 構成

- `src/app/api/[...path]/route.ts` — 中継。`/api/rpc/<command>` → サーバの `/rpc/<command>`、`/api/events` → `/events`。
  サーバ側でトークンを付ける(**ブラウザへは渡さない**)。`Host`・`Origin` を確かめ、入口は許可リストだけ。
  SSE は本文をそのまま流す(圧縮しない・貯めない)。
- `src/api/` — フロントの唯一の入口。`apps/native/react/src/api/` と同じ関数名・引数・戻り値で、
  中身だけ fetch / EventSource にしてある(`Promise<unlisten>` の形も同じ)。
- `src/app/settings/page.tsx` — `/settings`。client component。
- `src/app/{App,tokens}.css` — Vite 版から写した(`tokens.css` は生成物。MUI への書き直しはしない)。

## 確認

```bash
npx tsc --noEmit        # apps/console で
```
