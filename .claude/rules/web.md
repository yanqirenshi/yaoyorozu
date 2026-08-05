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
src/data/                  プロダクト情報(SSoT)
src/theme.ts               MUI テーマ(COLOR_PALETTE から生成)
src/types/                 型定義を同梱しない外部パッケージの補完宣言
```

- MUST: `page.tsx` は `tabs/` のコンポーネントを組み立てるだけの薄いラッパーに保つ。ロジック・マークアップ本体を書かない。
- MUST: `page.tsx` に `"use client"` を書かない。クライアント処理は `tabs/` 以下に置く。
- MUST: 図表描画(`@yanqirenshi/*`)はクライアント専用。SSR で動かそうとしない。
- SHOULD: `tabs/` のコンポーネントが肥大化したら、その画面専用の子コンポーネントは `tabs/<画面名>/` ディレクトリに分割する。

## 2. データ管理(SSoT = リポジトリ内の静的 TypeScript)

プロダクト情報の唯一の真実は `src/data/*.ts` であり、git が履歴管理を担う。編集は人・AI セッションによるファイル編集で行い、Webアプリは閲覧に徹する。

- MUST: プロダクト情報(WBS、構成図、サイトマップ、クラス図、TM、デザイントークン等)は `src/data/*.ts` に静的 TypeScript オブジェクトとして置く。API・DB は導入しない。
- MUST: データファイルは型(`export type`)とデータ(`export const`)を明示し、表示コンポーネントから分離する。
- NEVER: コンポーネント内にプロダクト情報を直書きする。
- NEVER: プロダクト情報の本体を localStorage・cookie 等のブラウザ内ストレージに保存する(情報の断片化になる)。
- localStorage を使ってよいのは「レイアウトの手調整」のような表示補助情報のみ。キーは `yaoyorozu:<画面>:<用途>` 形式とし、読み書きは `src/data/*Storage.ts` に集約する(例: `sitemapLayoutStorage.ts`)。
- SHOULD: localStorage 上の調整結果が安定したら、値を `src/data/*.ts` に反映してリポジトリへ戻す。

## 3. UI 状態

- MUST: リロード・リンク共有で保持したい UI 状態(選択中タブ、選択中項目など)は URL クエリパラメータで管理する(`?tab=`, `?item=`)。`useSearchParams` + `router.push` を使う。
- 一時的な UI 状態(モーダル開閉、フォーム入力途中、ホバー等)はコンポーネントローカルの `useState` でよい。
- NEVER: グローバル状態管理ライブラリ(Redux / Zustand / Jotai 等)を導入する。必要になったらまず本規約を改定する。

## 4. スタイリング(MUI 主 + Tailwind 補助)

- MUST: UI コンポーネント(メニュー、タブ、ボタン等)とテーマ適用は MUI を使う。
- MUST: レイアウト・余白・罫線などのユーティリティは Tailwind クラスで書く。
- MUST: 配色は日本の伝統色パレット `COLOR_PALETTE`(`src/data/uiDesign.ts`)をソースオブトゥルースとする。MUI テーマへは `src/theme.ts` 経由で反映する。新しい色もここへ追加してから使う。
- NEVER: コンポーネントに hex カラーを直書きする。`COLOR_PALETTE` またはテーマ(`palette.*`)経由で参照する。
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
npm run lint --workspace=web
```

- MUST: コミット前に `npm run web:build` が通ることを確認する。

## 7. 将来の移行指針(アーキテクチャを先に大きくしない)

現状は「標準構成(Colocation型)+ 静的データ SSoT + Client-first」であり、これは閲覧中心・d3 図表描画が本体というアプリの性質に合った選択である。先回りして層を増やさず、以下の兆候が出たときに本規約を改定してから移行する。

| 兆候 | 移行先 |
|---|---|
| `tabs/` の1ファイルが肥大化する | `tabs/<画面名>/` に画面専用コンポーネントを分割(§1 で許可済み) |
| 画面横断の共通ロジック・部品が増える | フィーチャーベース構成へ再編(`features/<機能>/{components,hooks,types}` + `shared/`) |
| Web からの編集機能(Route Handlers / Server Actions)を導入する | データアクセス層を分離し、ビジネスロジックはフレームワーク非依存の純粋 TS(`src/core/`)に置く(native の B型と同じ発想の部分適用) |

- MUST: 上記の移行はいずれも「規約(本ファイル)の改定 → 実装」の順で行う。実装が先行して規約と乖離した状態を作らない。
- NEVER: 兆候がないうちから FSD・クリーンアーキテクチャ等の重い構造を導入する。
