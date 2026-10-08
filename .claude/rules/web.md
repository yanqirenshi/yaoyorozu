---
paths:
  - "apps/web/**"
---
# apps/web の設計方針(アーキテクチャ規約)

Next.js 16(App Router)+ React 19 + MUI 製のWebアプリ。プロダクトの情報(仕様・WBS・各種図)を管理し、AIと人のコミュニケーションに利用して情報を断片化させないための場。
本ファイルは規約である。逸脱する場合は必ず理由をコメントに残すこと。

## 0. 前提

- Next.js 16 は学習データと規約が異なる可能性がある。API・ファイル規約に迷ったら `node_modules/next/dist/docs/` を必ず参照する(Turbopack がデフォルト、`middleware` は `proxy` に改称、等)。

## 1. レイヤ構成

```
src/app/<route>/page.tsx   ルーティングのみ(薄いラッパー。Server Component のまま保つ)
src/app/tabs/              画面本体("use client"。1画面 = 1ファイル)
src/app/AppShell.tsx       全画面共通の枠(左メニュー)
src/app/DiagramPage.tsx    図/WBS タブ切り替えの共通コンポーネント
src/components/            画面をまたいで使う共通コンポーネント(/ui で定義したもの)
  frames/ products/ assemblies/ parts/   フレーム / 製品 / 中間品 / 部品
src/data/                  プロダクト情報(SSoT。yaoyorozu 自身の分。#543 で yyz/ へ移行中)
src/lib/                   実行時データ取得など、画面をまたいで使う非コンポーネントのロジック
src/app/tokens.css         デザイントークンの CSS カスタムプロパティ(自動生成。直接編集しない)
src/theme.ts               MUI テーマ(COLOR_PALETTE から生成)
src/types/                 型定義を同梱しない外部パッケージの補完宣言
```

- MUST: `page.tsx` は `tabs/` のコンポーネントを組み立てるだけの薄いラッパーに保つ。ロジック・マークアップ本体を書かない。
- MUST: `page.tsx` に `"use client"` を書かない。クライアント処理は `tabs/` 以下に置く。
- MUST: 図表描画(`@yanqirenshi/*`)はクライアント専用。SSR で動かそうとしない。
- SHOULD: `tabs/` のコンポーネントが肥大化したら、その画面専用の子コンポーネントは `tabs/<画面名>/` ディレクトリに分割する。
- MUST: `src/components/` には `/ui` で定義したコンポーネントだけを置く。仕様(寸法・色・状態)は `src/data/ui*.ts` に持ち、コンポーネントは値を持たない。画面専用のものは従来どおり `tabs/<画面名>/` に置く。
- MUST: `parts/`(部品)と `assemblies/`(中間品)はデータを取得せず、props だけで描画する。

## 2. データ管理(SSoT = リポジトリ内のファイル)

プロダクト情報の唯一の真実はリポジトリ内のファイルであり、git が履歴管理を担う。編集は人・AI セッションによるファイル編集で行い、Webアプリは閲覧に徹する。

- MUST: プロダクト情報(WBS、構成図、サイトマップ、クラス図、TM、デザイントークン等)は `src/data/*.ts` に静的 TypeScript オブジェクトとして置く。API・DB は導入しない(下記の2つが唯一の例外)。
  - 【移行中・#543】Web アプリを複数リポジトリの仕様管理に対応させる段階的な移行(親 #543)が進むと、画面ごとに `{リポジトリ}/yyz/spec/*.json` ＋ 読み取り API(本節の2つ目の例外)へ置き換わっていく。移行済みの画面は本節末尾の一覧を見ること。未移行の画面は従来どおり `src/data/*.ts` に置く。
- MUST: データファイルは型(`export type`)とデータ(`export const`)を明示し、表示コンポーネントから分離する。
- NEVER: コンポーネント内にプロダクト情報を直書きする。
- NEVER: プロダクト情報・レイアウト調整を localStorage・cookie 等のブラウザ内ストレージに保存する(オリジン・ブラウザに紐づき、情報の断片化になる。旧方式の `yaoyorozu:<画面>:layout` は廃止済み)。
- MUST: 図のレイアウト調整(ノード座標・サイズ等の表示補助情報)は、**レイアウト保存 API** 経由でリポジトリ内のファイル(`src/data/layout/<図名>.json`)に保存し、ページは同 JSON を import して初期レイアウトに使う(git が履歴管理を担う)。この API は「API・DB は導入しない」の例外の1つである。
  - Route Handler `POST /api/layout/<図名>` は**自前で fs へ書かず、App(Tauri)のローカル API(native.md §7)へのプロキシ**とする。認証トークンは Next.js サーバ側でファイルから読み、**ブラウザへ渡さない**。
  - App が起動していない場合は「App が起動していません」という明確なエラーを返す(開発時のみ、従来の fs 直接書き込みへフォールバックしてよい — その場合はフォールバックであることをレスポンスとログに残す)。
  - 図名はサーバ側の許可リストで検証する。フロントから保存先パス・ファイル名を受け取らない。
  - 【#543・判断記録】プロダクト情報(`src/data/*.ts`)を `{リポジトリ}/yyz/spec/` へ移す段階が進んでも、レイアウト(`src/data/layout/*.json`)は**当面 `apps/web` 配下のまま**にする(#587、ユーザー判断)。保存 API が `apps/web` 配下に書く作りで、ここを動かすには「どのリポジトリのレイアウトをどこに保存するか」という別の設計が要るため。いま図を持つのは yaoyorozu だけで実害が無い。実害が出てから改めて考える。
- MUST(#543・移行済みの画面): 移行済みの画面のプロダクト情報は、ビルド時の `import` ではなく**実行時**に `GET /api/spec/<repo>/<doc>` から読む。この API は「API・DB は導入しない」のもう1つの例外である。
  - データは `{リポジトリ}/yyz/spec/<doc>.json` に**計算を含まない素の値**だけで置く。日付の整形などの計算は Web アプリ側のコード(`src/lib/`)に書く。表示の定義(列・順序などの画面の設定)は仕様データではないので JSON に入れず Web アプリ側に残す。デザイントークンの参照(色など)も同じ理由で**生の値を JSON に焼き込まず**、役割名(トークンのキー)を JSON に持たせて `src/lib/` で解決する(`lib/unchi.ts` の `colorRole` が例)。
  - Route Handler はリポジトリ名を**App の `settings.json`(native.md §7 と同じ `app_data_dir` の読み方)のプロファイル `repository_path` から解決**する。フロントから実パスを受け取らない。ドキュメント名はサーバ側の許可リストで検証する。
  - App の設定が読めない・指定のリポジトリが無い・JSON が無い場合は、黙って空にせず分かるエラーを返す(`src/lib/useSpecDoc.ts` が読み込み中・エラー・成功の3状態を共通化している)。
  - 移行済み: `/{repo}/wbs`(#544)、`/{repo}/deployment-diagram`・`/{repo}/unchi`(#548)。旧 URL(`/wbs` 等)は当面リダイレクトとして残す。
  - 【#587】同じ場所の `{doc}.md`(**判断の記録**。コメントとして書かれていた、なぜそう決めたかの理由)は `GET /api/spec/<repo>/<doc>?format=md` で読む。無いのは正常(記録の少ない図もある)なので、サーバは 404 ではなく **204** を返し、`src/lib/useSpecMarkdown.ts` がこれを「記録なし」として区別する(エラー表示をしない)。描画は `src/components/parts/Markdown.tsx`(`react-markdown` + `remark-gfm`。依存が2つ増える判断の理由は同ファイルの冒頭コメントを参照)。

## 3. UI 状態

- MUST: リロード・リンク共有で保持したい UI 状態(選択中タブ、選択中項目など)は URL クエリパラメータで管理する(`?tab=`, `?item=`)。`useSearchParams` + `router.push` を使う。
- 一時的な UI 状態(モーダル開閉、フォーム入力途中、ホバー等)はコンポーネントローカルの `useState` でよい。
- NEVER: グローバル状態管理ライブラリ(Redux / Zustand / Jotai 等)を導入する。必要になったらまず本規約を改定する。

## 4. スタイリング(MUI 主 + Tailwind 補助)

- MUST: UI コンポーネント(メニュー、タブ、ボタン等)とテーマ適用は MUI を使う。
- MUST: レイアウト・余白・罫線などのユーティリティは Tailwind クラスで書く。
- MUST: 配色は日本の伝統色パレット `COLOR_PALETTE`(`src/data/uiDesign.ts`)をソースオブトゥルースとする。MUI テーマへは `src/theme.ts` 経由で反映する。新しい色もここへ追加してから使う。
- NEVER: コンポーネントに hex カラーを直書きする。`COLOR_PALETTE` またはテーマ(`palette.*`)経由で参照する。
- MUST: 色以外のデザイントークン(タイポグラフィ、余白、角の形状、高さ、アイコンのサイズ)も `src/data/ui*.ts` をソースオブトゥルースとし、値の意味と使い分けは `/ui`(基本デザイン)に公開する。定義にない値をその場で決めない。
- MUST: CSS ファイルからトークンを使う場合は、生成された `src/app/tokens.css` のカスタムプロパティ(`var(--color-primary)`、`var(--space-4)` 等)を経由する。CSS へ値を書き写さない。
- NEVER: `src/app/tokens.css` を直接編集する。`scripts/generate-tokens.ts` の生成物であり(`npm run tokens`。`web:dev` / `web:build` の先頭で自動実行)、値を変えるときは生成元の `src/data/ui*.ts` を直して再生成する。
- NEVER: Bulma のクラスをアプリコードで直接使う。`globals.css` の Bulma import は `@yanqirenshi/table.wbs` / `colonoscope` が内部で必要とするために維持しているだけである。

## 5. 外部パッケージ(`@yanqirenshi/*` ほか)

- 図表描画は自作 npm パッケージ(`d3.classes`, `d3.deployment`, `d3.sitemap`, `d3.ter`, `table.wbs`, `colonoscope`, `tion` など)に依存する。
- MUST: 型定義を同梱しないパッケージは `src/types/yanqirenshi.d.ts` に宣言を追加して strict モードを維持する。
- MUST: パッケージの exports 解決に問題がある場合は `next.config.ts` の `turbopack.resolveAlias` で対処する(ルート `node_modules` 基準の相対パス)。
- MUST: 命令的 API のパッケージ(`ClassDiagram` 等)は `useEffect` 内で初期化し、クリーンアップで必ず破棄する。`Rectum` 系は `useMemo` で生成する。

## 6. コマンド

```bash
npm run web:dev      # 開発サーバ (http://localhost:3000)
npm run web:build    # 本番ビルド
npm run tokens       # デザイントークンの CSS を再生成(dev/build の先頭で自動実行)
npm run lint --workspace=web
```

- MUST: コミット前に `npm run web:build` が通ることを確認する。

## 7. 将来の移行指針(アーキテクチャを先に大きくしない)

現状は「標準構成(Colocation型)+ 静的データ SSoT + Client-first」であり、これは閲覧中心・d3 図表描画が本体というアプリの性質に合った選択である。先回りして層を増やさず、以下の兆候が出たときに本規約を改定してから移行する。

| 兆候 | 移行先 |
|---|---|
| `tabs/` の1ファイルが肥大化する | `tabs/<画面名>/` に画面専用コンポーネントを分割(§1 で許可済み) |
| 画面横断の共通ロジック・部品が増える | フィーチャーベース構成へ再編(`features/<機能>/{components,hooks,types}` + `shared/`)。※`/ui` で定義する共通コンポーネントは `src/components/`(§1)として限定適用済み |
| Web からの編集機能(Route Handlers / Server Actions)を導入する | データアクセス層を分離し、ビジネスロジックはフレームワーク非依存の純粋 TS(`src/core/`)に置く(native の B型と同じ発想の部分適用)。※レイアウト保存 API(§2)として限定適用済み。プロダクト情報本体の編集に広げる段階で `core/` 分離を行う |

- MUST: 上記の移行はいずれも「規約(本ファイル)の改定 → 実装」の順で行う。実装が先行して規約と乖離した状態を作らない。
- NEVER: 兆候がないうちから FSD・クリーンアーキテクチャ等の重い構造を導入する。
