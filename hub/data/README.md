## data/

YAOYOROZU の設計のデータです。
iHub (hub/) の画面と API サーバーが読み書きします。
フォーマットは `@yanqirenshi/ihub.srv` の JSON Schema (`node_modules/@yanqirenshi/ihub.srv/src/schemas/`) で決まっています。
`npm run test:data` で、フォーマットに合っているかを確かめられます。

### 移行元

2026-11-14 に、Webアプリ (apps/web) で管理していた `yyz/spec/` のデータから移しました。

| hub/data | 移行元 |
|---|---|
| wbs/ | yyz/spec/wbs.json (親子は edges から parent へ) |
| tm/ | yyz/spec/tm.json + 画面で動かした配置 apps/web/src/data/layout/tm.json |
| sitemap/ | yyz/spec/sitemap.json + 画面で動かした配置 apps/web/src/data/layout/sitemap.json |
| deployment/ | yyz/spec/deployment.json |
| overview/ | yyz/spec/unchi.json (ポンチ絵。線の色はデザイントークンから色の値へ) |
| tm/README.md・sitemap/README.md | yyz/spec/tm.md・sitemap.md (判断の記録) |
| classes/ | yyz/spec/classes.json + 画面で動かした配置 apps/web/src/data/layout/classes.json (iHub 0.6.0 で対応。iHub #171) |
| classes/README.md | yyz/spec/classes.md (判断の記録) + sections の一覧 |

- TM の区分コードの説明は、その区分コードを使う結線の `subset.description` に入れています。
- サイトマップのノードには、図に使わない項目 (path・description・wbsIds・browsable) も残しています。
- er/・systemic_design/ は、移行元に無いので空です。
- Classes の sections (章立て) は、iHub のコレクションに無いので、classes/README.md に一覧で残しています。(各クラスの group・section は classes.json に残っています)
- Classes のクラス・関係の notes は、Webアプリと同じく図には出さず、データに残しているだけです。
- Classes のヘッダーの色 (層ごと) は、データではなく src/index.js の config.diagrams.classes.header に書いています。
