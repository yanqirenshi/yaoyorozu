# PoC: アプリの画面を Web で開発する

- 実施日: 2026-09-15
- 担当セッション: Lab
- 結論: **成立する**。Web(apps/web)で開発した画面が、アプリ(apps/native)の実データを表示し、その画面をアプリ内(WebView2 の iframe)でも表示できることを実機で確認した
- PoC ブランチ: `poc/web-developed-app-ui`(コミット `31e1431`、6ファイル。**マージは想定しない**。本実装はイシューを起票して行う)

## 1. 目的

アプリ(Tauri)の画面開発を、Next.js のホットリロードとブラウザの開発ツールが使える
Web 側(apps/web)で行えるようにしたい。
「Webで開発した画面(fetch を含む)を、アプリ内で表示する」構成が成立するかを検証する。

## 2. 構成

既存のローカルAPIサーバ基盤(native.md §7。issue #122/#123 で導入済み)を土台に、
読み取りエンドポイントを1本足して縦の経路を通した。

```
[開発時] ブラウザ ──→ Next.js dev (localhost:3100)
[表示時] アプリ内 iframe ──→ 同上
                     │ /app-poc      … 画面(React client component)
                     │ /api/app-poc/projects … プロキシ(Route Handler)
                     │    ├ トークンを %APPDATA%/com.yaoyorozu.native/local-api-token から読む
                     │    │ (Next サーバ内のみ。ブラウザへは渡さない)
                     ▼    ▼
        App(Tauri)ローカルAPI 127.0.0.1:14200
                     │ GET /projects(Bearer トークン必須)
                     ▼
        app::list_projects → ~/.claude/projects/ 走査(既存ユースケースをそのまま利用)
```

- ブラウザ(または iframe)は**自オリジンの Next にしか話さない**ため、CORS 設定が不要
- トークンとポート(14200)の扱いは layout 保存(issue #123)と同じパターンの踏襲

## 3. 実装内容(PoC ブランチ)

| ファイル | 内容 |
|---|---|
| `apps/native/tauri/src/local_api.rs` | `GET /projects` を追加。`#[tauri::command] list_projects` と同じユースケース呼び出し。読み取りだがプロジェクト名は個人情報を含むためトークン認証必須 |
| `apps/web/src/app/api/app-poc/projects/route.ts` | Next.js のプロキシ。トークンを読んで 14200 へ中継。App 未起動時は 503 |
| `apps/web/src/app/app-poc/page.tsx` | 「アプリの画面」の PoC(プロジェクト一覧表示 + 再読み込み + エラー表示) |
| `apps/native/react/src/pages/WebPocPage.tsx` | `http://localhost:3100/app-poc` を iframe 表示 |
| `apps/native/react/src/App.tsx` / `Layout.tsx` | ルート `/web-poc` と一時的な dock トリガー「PoC」 |

## 4. 検証結果

| # | 検証 | 結果 |
|---|---|---|
| 1 | Rust(cargo check --workspace) | ✅ 通過 |
| 2 | ブラウザで `localhost:3100/app-poc` → アプリの実データ(プロジェクト25件)が表示される | ✅ |
| 3 | アプリ未起動時のエラー表示(「App(YAOYOROZU)に接続できません」) | ✅ |
| 4 | アプリ内 iframe(`/web-poc`)で同じ画面・同じデータが表示される | ✅(目視確認) |

トークン不一致時の 401 経路は未検証(実装は layout 保存と同一パターン)。

## 5. 知見・注意点

1. **既存基盤がそのまま土台になった**。issue #122/#123 のローカルAPI(axum・トークン・Nextプロキシ)は、
   まさに「Rustコアをローカルバックエンドとみなす」構成であり、読み取りエンドポイントの追加だけで
   この開発スタイルが成立した
2. **iframe が動くのは CSP が `null` のため**。本実装で CSP を設定する際は
   `frame-src http://localhost:3100`(と本番の配信元)の明示が必要
3. **ポート 14200 とトークンは「単一アプリ」前提**。PoC 版と本物のアプリを併走させると、
   後から起動した方がトークンファイルを上書きし、先に 14200 を取った方が API を握る。
   worktree でのアプリ開発が日常化すると衝突するため、dev 用ポートの分離(設定化)を検討すべき
4. **画面の置き場所**: PoC では `/app-poc` に置いたが、プロダクト情報の画面(web.md)とは役割が
   異なるため、本実装ではルート分離(例: `/app/*`)と規約(web.md / native.md)への追記が必要
5. **本番の配信方式は未決**。開発時は Next dev サーバだが、配布時は
   (a) Next の静的 export をアプリのローカルAPIサーバから配信、(b) ホスティング、のいずれかを決める必要がある
6. **イベント(`session:changed` 等)は未検証**。HTTP 化するなら SSE の追加が必要(残課題)

## 6. 本実装に向けた設計判断(デザインセッション向け)

- どの画面からWeb開発方式に移すか(全画面か、新規画面のみか)
- ルート命名と規約整備(`/app/*`、web.md への「アプリ画面」節の追加)
- 読み取り系エンドポイントの拡充方針(`/projects` に続き `/sessions` 等。DTO は tauri/src/dto.rs と共通化)
- イベントの扱い(SSE か、iframe では割り切ってポーリングか)
- 配布時の画面配信方式(§5-5)
- dev 用ポート分離(§5-3)

## 7. 再現手順

```bash
git worktree add ../yaoyorozu-poc-appui poc/web-developed-app-ui
cd ../yaoyorozu-poc-appui && npm install
npm run native:dev                          # アプリ起動(14200 で API が立つ)
npm run dev --workspace=web -- --port 3100  # 別ターミナルで Web
# ブラウザ: http://localhost:3100/app-poc
# アプリ: dock の「PoC」→ iframe 表示
```
