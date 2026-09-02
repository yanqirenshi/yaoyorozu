# YAOYOROZU

npm workspaces によるモノレポ構成。

## 目的・背景

AIを利用したITプロダクト開発をサポートするアプリ。ネイティブアプリとWebアプリの2つを構築するが、両者の役割・機能は別物として明確に分ける。

- **ネイティブアプリ**(`apps/native`): Claude Code / Gemini / Codex などのAIコーディングエージェントをラップし、GitHubを使ったタスク管理を行う。yaoyorozuとしてのプロダクト開発方法(プロセスなど)を確立し、ユーザーがプロダクト開発をしやすくすることを目指す。
- **Webアプリ**(`apps/web`): プロダクトの情報(仕様など)を管理する。AIと人とのコミュニケーションに利用し、情報を断片化させないための場とする。

## タスク管理

GitHub Projects で管理する: https://github.com/users/yanqirenshi/projects/51

## セッション構成

Claude Code で以下のセッションに役割を分けて対応する。

- **デザイン**: 要件の整理・設計、実装イシューの作成
- **実装:APP**: Tauri + TypeScript + React によるネイティブアプリの構築
- **実装:APP (画面:/)**: Tauri + TypeScript + React によるネイティブアプリの構築
- **実装:APP (画面:/settings)**: Tauri + TypeScript + React によるネイティブアプリの構築
- **実装:APP (画面:/claude)**: Tauri + TypeScript + React によるネイティブアプリの構築
- **実装:Web**: Next.js によるプロダクト情報管理Webアプリの構築
- **Lab**: 機能化についての調査、理解など。
- **運用:リリース**: apps/native のリリース作業の実施。`/release <バージョン>` スキル(`.claude/skills/release/`)を実行し、バージョン更新 → タグ push → MSI ビルド確認 → GitHub Releases での公開までを行う
- **管理**: このプロジェクト自体の管理、Claude Codeの利用方法の整理・実装

### 並行作業のルール

- 複数の実装セッションが並行して作業する場合は、**セッションごとに別ブランチ(または git worktree)で作業し、PR でマージする**。同一ブランチ・同一ワーキングツリーを複数セッションで同時に変更しない。
- イシューには「対象画面」と「共有層(`crates/`、`tauri/`、`react/src/api/`、dock・共通コンポーネント等)に触るか」を明示する。共有層に触る変更は画面別セッションではなく **実装:APP(共通)** が担当する。

## 構成

- `apps/web` — Next.js製のWebアプリ。WBS/構成図/UIデザイン/サイトマップ/Classes/TM図を表示するドキュメンテーションツール
- `apps/native` — Tauri v2製のネイティブアプリ。Claude Codeのセッション履歴ビューア(開発中)

## 配布(apps/native)

他PCでの実行は GitHub Releases での MSI ファイル公開を基本とする。winget(microsoft/winget-pkgs)への公開は、アプリが公開配布に見合う完成度になるまで見送る(2026-09-01、申請PR [microsoft/winget-pkgs#426285](https://github.com/microsoft/winget-pkgs/pull/426285) をクローズ済み)。再申請は明示的に指示があった場合のみ検討する。

## 開発コマンド

```bash
npm install          # 依存関係インストール(ワークスペース共通、ルート node_modules にまとめてインストールされる)
npm run web:dev       # Webアプリ (http://localhost:3000)
npm run native:dev    # ネイティブアプリ (Tauri desktop window)
npm run web:build
npm run native:build
```

## 各アプリの設計方針

- `apps/web`(Next.js): [.claude/rules/web.md](.claude/rules/web.md) を参照(`apps/web/**` を編集する際に自動的に読み込まれる)
- `apps/native`(Tauri v2): [.claude/rules/native.md](.claude/rules/native.md) を参照(`apps/native/**` を編集する際に自動的に読み込まれる)

## rules ディレクトリ

`.claude/rules/*.md` にトピック別の詳細ルールを置く。frontmatterの `paths` で対象ファイルにマッチしたときだけ読み込まれる(コンテキスト節約)。条件なしのファイルは本ファイル同様、毎セッション読み込まれる。

## Conversation Guidelines

- 常に日本語で会話する
- 技術的な説明も日本語で行う
- コード内のコメントは日本語で記述
- エラーメッセージの解説は日本語で
- README.mdなどのドキュメントも日本語で作成

## Git Commit Guidelines

- git commit のメッセージに Claude が生成した旨の記述(例: "Co-Authored-By: Claude" や "Generated with Claude Code" など)を含めない
