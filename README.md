# YAOYOROZU

npm workspaces によるモノレポ構成です。

## 構成

- [apps/web](apps/web) — Next.js製のWebアプリ(WBS/構成図/UIデザイン/サイトマップ/Classes/TM)
- [apps/native](apps/native) — Tauri製のネイティブアプリ。デスクトップアプリ(YAOYOROZU)として winget での配布を予定している。リリース手順は [docs/release.md](docs/release.md) を参照

## セットアップ

```bash
npm install
```

依存関係はワークスペース間で共通化され、リポジトリ直下の `node_modules` にまとめてインストールされます。

## 開発

```bash
# Webアプリ(Next.js, http://localhost:3000)
npm run web:dev

# ネイティブアプリ(Tauri desktop window)
npm run native:dev
```

## ビルド

```bash
npm run web:build
npm run native:build
```

## バージョン管理(apps/native)

`apps/native` のバージョンのソースオブトゥルースは
[`apps/native/tauri/tauri.conf.json`](apps/native/tauri/tauri.conf.json) の
`version` とする。リリースはこの値と一致する `vX.Y.Z` 形式の git タグを
打つ運用とする(タグとバージョンの一致は [リリースワークフロー](.github/workflows/release.yml)
が自動チェックする)。手順は [docs/release.md](docs/release.md) を参照。

## ライセンス

[LICENSE](LICENSE) を参照。
