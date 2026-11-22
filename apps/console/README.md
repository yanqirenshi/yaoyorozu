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

### 入力中(未保存)の欄は、取り直しで上書きしない

つなぎ直し(`onReconnected`)・他のタブの変更(`settings:updated`)・`session:changed` などの**自動の取り直しは、入力中の欄を上書きしない**。
代わりに「ほかで変更されました」の知らせと「取り直す」ボタン(押すと今の入力を捨てて取り直す)を出す。未保存の変更が無ければ、今までどおり取り直す。

- 部品: `src/useRefreshGuard.ts`(hook)と `src/StaleNotice.tsx`(知らせ + ボタン)。
- 未保存かどうかは、画面が持つ dirty 状態、または「最後に読み込んだ(保存した)値と、今の入力値の比較」で持つ。
- 保存に失敗したとき(サーバ停止など)は、入力も未保存の状態もそのまま残し、エラーだけを出す(つなぎ直しで消さない)。
- 対象そのものが変わったとき(プロファイルの切替など)は、入力中の内容は別の対象のものなので、取り直しの結果で置き換える。
  ファイルの編集画面(`ClaudeMdEditor`・`JsonFileEditor`)は、保存先が変わったら取り直すまで保存を止める。

```ts
const { stale, shouldApply, clear } = useRefreshGuard(dirty);   // dirty = 未保存の変更があるか

const load = useCallback((force = false) =>
  getSettings().then((settings) => {
    setLabel(settings.label);                                   // 表示専用の部分は常に取り直す
    if (force || shouldApply()) {                               // 未保存が無ければ(または force)欄へ入れる
      setInput(settings.value);
      setBaseline(settings.value);                              // 「読み込んだ値」(dirty の比較元)
      clear();
    }                                                           // 未保存があれば shouldApply() が stale を立てる
  }), [shouldApply, clear]);

// 保存できたら、その入力を「読み込んだ値」にする(失敗したら何もしない = 入力を残す)
save(input).then(() => { setBaseline(input); clear(); });

{stale && <StaleNotice onReload={() => void load(true)} />}     // 「取り直す」= 入力を捨てて取り直す
```

編集用の部品は `ref` で `refresh()`(自動の取り直し。未保存なら知らせを出す)と `reload()`(入力を捨てて取り直す。dock の「再読み込み」)を出す。
自動の取り直しからは `refresh()` を呼ぶ(`/claude`・ビューアの `onReconnected` が手本)。

### 書き込みボタンは、応答が返るまで押せなくする

「追加」「保存」「削除する」「切替」「名前変更の確定」「作成」など、書き込み(や重い問い合わせ)を起こすボタンは、応答が返るまで `disabled` にし、
ハンドラの先頭でも送信中なら何もしない(Enter の連打・ダブルクリックで 2 つできるのを防ぐ)。応答が返ったら(成功・失敗どちらでも)戻す。
手本: `src/app/settings/page.tsx` の `runWrite`、`src/ProfileSettingsPane.tsx` の `saving`・`renaming`・`yyzCreating`。

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

## Markdown の表示と Content-Security-Policy(XSS の守り)

CLAUDE.md・Rules・Skills・会話は、clone したリポジトリやエージェントが書くので、`<img src=x onerror=…>` のような細工が入りうる。
この画面と同じオリジンで動くと、中継(`/api/rpc/*`)を通して `~/.claude/settings.json` の読み書きまで届く。3 重に守る。

1. **Markdown を表示する所は、共通の部品を通す**: 閲覧専用は `SafeMarkdownViewer`(会話の `MessageText`・`RulesPane`・`SkillsPane`)、編集つきは `ClaudeMdEditor`。
   `<markdown-viewer>` / `<markdown-workspace>` を直接置かない・`viewer.markdown = …` / `workspace.value = …` と直接代入しない(`tests/sanitizeMarkdown.test.ts` がソースを検査して落ちる)。
   内容は `setViewerMarkdown` / `setWorkspaceValue`(`src/safeMarkdown.ts`)でしか渡さない。どちらも**先に無害化を仕込み**(`sanitize` を設定し、`parser` も包んで出力を必ず無害化する)、仕込めなければ内容を渡さない。
   markdown.sitter の `sanitize` の既定は素通しで、effect の宣言順に頼ると最初の描画が素通しになる(実際に起きた)。新しい Markdown の表示を足すときも、この部品を使う。
2. **無害化の設定を締めてある**(`src/sanitizeMarkdown.ts`): `<script>`・`on` 属性・`javascript:` に加えて、`<style>`・`<link>`・`<iframe>`・`<object>`・`<embed>`・`<form>`・`<base>`・`<meta>`・`<svg>`・`style` 属性を落とす。リンク・画像の URL は `http`・`https`・`mailto` とスキームの無い相対・`#` だけ。
3. **Content-Security-Policy**(`src/proxy.ts`。Next の Proxy): 万一無害化を抜けても、インラインのスクリプト・on 属性は実行されず、外への送信・読み込みも出ていかない。
   `script-src` はリクエストごとの nonce + `'strict-dynamic'`(`'unsafe-inline'` なし。そのためルートの layout が `connection()` で動的に描画する)、`connect-src 'self'`、`img-src 'self' data: blob:`、`object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`、`form-action 'self'`。
   **緩めた所**: `style-src` は `'unsafe-inline'` を許す(command-dock・markdown.sitter が Shadow DOM の中に `<style>` を入れ、nonce を付けられないため)。`next dev` だけ React の都合で `'unsafe-eval'` と `ws:` を足す。
   **会話の中の外部の画像は表示されない**(読み込むだけで、開いたことが外へ伝わるため。了承済み)。

```bash
npm run test --workspace=console    # 無害化のテスト(jsdom)
```

## 設定の版と、通知の間引き

- **設定の版**: `getSettings` が返す `revision` を、`updateSettings(input, profileId, expectedRevision)` に渡す(必須)。古ければ 409(`settings_conflict`)で、画面は
  「ほかで変更されました。取り直してからやり直してください」を出し、**入力は残し**、「取り直す」を促す(`ProfileSettingsPane`。未保存の入力を守って取り直しを見送ったときは、版を更新しない)。
- **通知の間引き**(`src/coalescedRunner.ts`): `session:changed` のような通知を受けるたびに取り直さない。取り直し中に来た通知は**まとめて 1 回**、取り直しの開始は**最短 1 秒**あける。
  画面を離れたとき・unmount のときに `cancel()` する。`npm run test --workspace=console` に、時計を差し替えたテストがある。
