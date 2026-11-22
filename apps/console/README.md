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
- **ふだん使うときは `next build` → `next start` で起動する(`next dev` は開発のときだけ)**。開発サーバにだけある口(`/__nextjs_launch-editor`)があり、本番の起動では 404 になるため。
- `console:dev` は先にデザイントークン(`tokens.css`)を生成する(`npm run tokens`)。

## 構成

- `src/app/api/[...path]/route.ts` — 中継。`/api/rpc/<command>` → サーバの `/rpc/<command>`、`/api/events` → `/events`。
  サーバ側でトークンを付ける(**ブラウザへは渡さない**)。`Host`・`Origin` を確かめ、入口は許可リストだけ。
  SSE は本文をそのまま流す(圧縮しない・貯めない)。
- `src/api/` — フロントの唯一の入口。`apps/native/react/src/api/` と同じ関数名・引数・戻り値で、
  中身だけ fetch / EventSource にしてある(`Promise<unlisten>` の形も同じ)。
- `src/app/settings/page.tsx` — `/settings`。client component。
- `src/app/{App,tokens}.css` — Vite 版から写した(`tokens.css` は生成物。MUI への書き直しはしない)。

## イベント(SSE)のつなぎ直しと、つなぎ直したあとの取り直し(段階 2 以降の全画面の土台)

`src/api/events.ts` が接続を持つ。ブラウザ任せの再接続には頼らない。
中継はサーバに届かないとき `/api/events` を 503(JSON)で返し、EventSource は仕様どおりそれで再接続をやめる(CLOSED)ため。

- 購読者(`onPing` などのイベント購読・`onConnectionChange`・`onReconnected`)が 1 人でもいる間だけ接続を持つ。
  0 人になれば閉じ、つなぎ直しの予約も取り消す(**unlisten するとつなぎ直しも止まる**)。
  どの購読も `Promise<unlisten>` を返す形のまま。
- 切れたら(CLOSED、または自動再接続の待ち)接続状態が `"disconnected"` になり、1 秒から 2 倍ずつ(最大 10 秒)の間隔で作り直す。
- **接続状態**: `onConnectionChange(cb)`(`"connecting" | "connected" | "disconnected"`)。登録直後に今の状態を 1 回返す。
  画面の「サーバに接続できません」の表示・消去に使う。
- **つなぎ直せた合図**: `onReconnected(cb)`。切れている間のイベントは失われているので、**画面はこの合図で表示(Query)を取り直す**。
  サーバが止まっている間に画面を開き、あとでサーバを起動した場合(最初の接続が失敗していた)も同じ合図が出る。

画面の書き方(`src/app/settings/page.tsx` が手本):

```ts
useEffect(() => { void load(); }, [load]);                 // 最初の取得
useEffect(() => {
  const p = onReconnected(() => { void load(); });          // つなぎ直したら取り直す
  return () => { void p.then((unlisten) => unlisten()); };
}, [load]);
useEffect(() => {
  const p = onConnectionChange(setConnection);              // 「サーバに接続できません」の表示用
  return () => { void p.then((unlisten) => unlisten()); };
}, []);
```

## 確認

```bash
npx tsc --noEmit        # apps/console で
```

## 画面(ルート)

| ルート | 内容 | 段階 |
|---|---|---|
| `/` | `/settings` へ redirect(ハブは段階 4) | 1 |
| `/settings` | プロファイルの操作・対象リポジトリ・対象フォルダ(手入力 + 確認) | 2 A |
| `/claude` | `~/.claude` の閲覧と保存(CLAUDE.md・settings.json・Explorer) | 2 B |
| `/profiles/[[...profileId]]` | ビューア(セッション一覧・会話・画像・生の行、CLAUDE.md・Rules・Skills・設定ファイルの閲覧と保存) | 2 C |

- 出していないもの(後の段階): 実行中セッションとの対話、利用状況、かんばん・GitHub 連携、複数ウィンドウの連携(段階 4 でブラウザ側に作る)。
  「仕様」ボタンは作らない。
- 会話の Markdown 内のリンクは別タブで開く(`target="_blank"`・`rel="noopener noreferrer"`。`src/externalLinks.ts`)。
- どの画面も、購読(`session:changed` など)は画面を離れたとき・unmount のときに `unlisten` する。サーバへの SSE 接続は、
  画面を移動しても 1 本のまま(`src/api/events.ts` が持つ)。
- command・イベントの実装状況は `npm run diff-commands` で出す。
