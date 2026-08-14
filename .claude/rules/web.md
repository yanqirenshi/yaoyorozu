---
paths:
  - "apps/web/**"
---
# apps/web の設計方針

Next.js(App Router) + React + MUI 製のWebアプリ。WBS/構成図/UIデザイン/サイトマップ/Classes/TM図を表示するドキュメンテーションツール。

- ページ(`src/app/**/page.tsx`)は薄いラッパーで、実装本体は `src/app/tabs/` に分離する
- データは `src/data/*.ts` の静的TypeScriptオブジェクトで管理する(API/DB接続なし)
- 図表描画は自作npmパッケージ `@yanqirenshi/*`(`d3.classes`, `d3.deployment`, `d3.sitemap`, `d3.ter`, `table.wbs`, `colonoscope` など)に依存する。型定義が無いものは `src/types/yanqirenshi.d.ts` で補完する
- 配色は日本の伝統色(京紫・金茶・草色・真珠・墨)を `src/theme.ts` の `COLOR_PALETTE` で一元管理する。新しい色を追加する場合もこのソースオブトゥルースを経由する
- タブ選択などのUI状態はURLクエリパラメータ(`?tab=`, `?item=`)で管理し、リロード/リンク共有でも状態が保持されるようにする
