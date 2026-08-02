# YAOYOROZU

npm workspaces によるモノレポ構成です。

## 構成

- [apps/web](apps/web) — Next.js製のWebアプリ(WBS/構成図/UIデザイン/サイトマップ/Classes/TM)
- [apps/native](apps/native) — Tauri製のネイティブアプリ(現状は空のスキャフォールドのみ)

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
