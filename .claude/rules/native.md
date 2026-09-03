---
paths:
  - "apps/native/**"
---
# yaoyorozu app

Tauri v2 + React/TypeScript のデスクトップアプリ。
本ファイルは規約である。逸脱する場合は必ず理由をコメントに残すこと。

## 1. アーキテクチャ方針（B型：Rust厚 / フロント薄）

- ドメインロジック・状態・永続化は すべて Rust 側に置く。
- React は表示と入力のみを担う。業務ルール（バリデーション、計算、遷移条件）を TS に書かない。
- Rust コアを「ローカル API サーバ」とみなし、`invoke()` を `fetch()` と同じ感覚で扱う。

### クレート構成

```
crates/domain/   モデルとビジネスルール。純粋関数中心
crates/app/      ユースケース。domain を組み合わせる。ports をトレイトで定義
crates/infra/    ports の実装（ファイル I/O、外部 API）
tauri/           #[tauri::command]、State 管理、menu/tray、plugin 配線のみ
react/           React（フロントエンド）。内部は Vite 標準構成（react/src/ 配下にコード）
```

- MUST: ディレクトリ名は `tauri/` と `react/` を使う（`src-tauri/` / `src/` は使わない）。
  リネームに伴い以下を必ず揃えること。ここがズレるとビルドだけが静かに壊れる。
  - ルート `Cargo.toml` の `members` に `"tauri"` を指定
  - `tauri/tauri.conf.json` の `build.frontendDist` / `build.devUrl` / `beforeDevCommand` を `react/` 基準に修正
  - `npm run tauri` 実行位置と Vite の `root` を `react/` に合わせる
- MUST: `domain` は `tauri` / `tokio` / ファイル I/O に依存しない。`Cargo.toml` に書かないことで強制する。
- MUST: 依存の向きは `tauri → app → domain`、`infra → domain`。逆流禁止。
- MUST: `domain` と `app` は `cargo test -p domain` / `-p app` だけで検証できる状態を保つ。
- NEVER: `tauri/src/*.rs` にビジネスロジックを書く。command 関数は「引数の変換 → ユースケース呼び出し → DTO 化」の3行〜10行程度に収める。

## 2. 状態管理（SSoT = `tauri::State<Mutex<AppState>>`）

アプリの唯一の真実は Rust の `AppState` である。

```rust
// tauri/src/state.rs
pub struct AppState {
    pub data: AppData,        // 永続化対象（domain の型）
    pub dirty: bool,
    pub save_path: PathBuf,
}
// main: .manage(tokio::sync::Mutex::new(AppState::load()?))
```

### 規約

- MUST: `Mutex` は `tokio::sync::Mutex` を使う。
  理由：command は `async fn` であり、`std::sync::Mutex` のガードを `.await` 跨ぎで保持すると壊れるため。
- MUST: グローバル状態は `AppState` 1つにまとめ、`Mutex` も1つだけ持つ。
  複数の `Mutex` を同時にロックしないことでデッドロックを構造的に排除する。
- MUST: ロックは最小スコープで取る。ロック保持中にファイル I/O・`emit`・ネットワークをしない。
  必要な値を `clone()` してからガードを `drop` し、その後に副作用を実行する。
- NEVER: React 側（useState / Context / Zustand 等）に業務状態を保持し続ける。
  フロントが持ってよいのは「サーバから取得した表示用スナップショット」と「UI 状態（モーダル開閉、フォーム入力途中、選択中 ID）」のみ。
- NEVER: フロントで楽観的更新をして Rust と二重管理にする。更新は必ず Rust を経由し、結果を取り直す。

### 永続化（JSON / TOML スナップショット）

- MUST: 書き込みはアトミックに行う。`*.tmp` へ書く → `fsync` → `rename` で置換。
- MUST: 保存は状態変更 command の中で完結させる（変更したのに保存されていない状態を作らない）。
  高頻度更新はデバウンス（例: 500ms）してよいが、その場合は `on_window_event` の終了時に必ずフラッシュする。
- MUST: 保存先は `app.path().app_data_dir()` を使う。パスをハードコードしない。
- MUST: ロード失敗時はプロセスを落とさず、破損ファイルを `*.corrupt.<timestamp>` に退避してデフォルト値で起動し、フロントへ警告イベントを送る。
- MUST: 永続化する型にはスキーマ `version` フィールドを持たせ、マイグレーション関数を `infra` に置く。

## 3. IPC 設計パターン

### 3.1 Command（フロント → Rust）

- MUST: Query と Command を名前で分離する。
  - Query（副作用なし）: `get_*` / `list_*` / `find_*`
  - Command（状態変更あり）: 動詞_目的語 → `create_task` / `rename_task` / `delete_task`
- MUST: 戻り値は DTO（`tauri/src/dto.rs`）。`domain` の型に `Serialize` を付けて直接返さない。
- MUST: 状態変更 command の処理順は固定：
  ① ロック取得 → ② 状態更新 → ③ 永続化に必要な値を clone してロック解放 → ④ 永続化（スナップショット書き込み） → ⑤ イベント emit → ⑥ 最小限の戻り値
  - 旧版の「ロック保持中に永続化」は §2 の「ロック保持中にファイル I/O をしない」と矛盾していたため、issue #17 の実装時の裁定でこの順に改めた（永続化はロック解放後）。
  - 注意: この順序では、並行する状態変更 command 同士でスナップショットの書き込み順が前後し、古い内容が後勝ちする競合が理論上ある。ユーザー操作起点の低頻度な更新（設定保存等）では許容してよいが、高頻度・並行更新がありうる command では書き込みを直列化する仕組み（単一の保存タスクへのキュー等）を導入すること。
  - 永続化が失敗した場合はエラーを返す。メモリ上の状態は更新済みのままでよい（次回保存で解消する）が、エラーを握りつぶしてはならない。
- MUST: 戻り値は更新結果の全体ではなく、新規 ID や成否など最小限にする。画面の更新はイベント経由の再取得で行う（データフローを単方向に保つ）。
- NEVER: 1回の `invoke` で全件を返す設計にする。一覧はページング／範囲指定を引数に持たせる。
- 引数は JS 側 camelCase → Rust 側 snake_case に自動変換される。挙動を変えたい場合のみ `#[tauri::command(rename_all = "...")]` を明示する。

### 3.2 Event（Rust → フロント）

- MUST: イベント名は `<対象>:<起きたこと>` の形式。例: `tasks:changed`、`settings:updated`、`app:warning`。
- MUST: ペイロードは軽量な通知に留める（変更種別と ID 程度）。データ本体はフロントが Query で取り直す。
- MUST: React 側では `useEffect` 内で `listen` し、クリーンアップで必ず `unlisten()` を呼ぶ。
- NEVER: 高頻度（数十 Hz 以上）の更新をイベントで垂れ流す。→ Channel を使う。

### 3.3 Channel（ストリーム・進捗）

- MUST: 長時間処理の進捗、逐次出力、大量データのストリーミングは `tauri::ipc::Channel<T>` を使う。
- MUST: 長時間処理は command 内で `await` しきらず、キャンセル用の command（`cancel_*`）とジョブ ID を対で用意する。

### 3.4 エラー

- MUST: `thiserror` で `AppError` を定義し、command の戻り値は `Result<T, AppErrorDto>`。
- MUST: `AppErrorDto` は `{ code: string, message: string, detail?: string }` の形にし、フロントは `code` で分岐する（メッセージ文字列で分岐しない）。
- NEVER: `anyhow::Error` や `Box<dyn Error>` を command の戻り値にする。
- NEVER: `unwrap()` / `expect()` を command とその配下で使う（起動時の初期化を除く）。

### 3.5 フロント側の呼び出し規約

- MUST: `invoke` の呼び出しは `react/src/api/` 配下のラッパー関数に集約する。
- NEVER: React コンポーネントから `invoke` を直接呼ぶ。
- MUST: DTO の TypeScript 型は `react/src/api/types.ts` に定義し、Rust の DTO と1対1で対応させる。片方だけ変更しない。

## 4. セキュリティ・権限

- MUST: `tauri/capabilities/*.json` で、ウィンドウごとに許可する command とプラグイン権限を明示的に絞る。デフォルト全許可にしない。
- MUST: API キー・トークン等の秘匿情報は Rust 側のみで保持し、フロントへ渡さない。
- NEVER: フロントから任意パスを受け取ってそのまま読み書きする command を作る。パスは Rust 側で解決するか、許可ディレクトリ配下かを検証する。

## 5. テスト

- MUST: ビジネスルールのテストは `domain` / `app` に書く。Tauri ランタイムや WebView を起動するテストを追加しない。
- MUST: `infra` のファイル I/O は `tempfile` を使い、実ユーザーディレクトリを触らない。
- SHOULD: `tauri` クレートのテストは「command が正しくユースケースへ委譲しているか」の薄い確認に留める。

## 6. フロントのルーティング

- MUST: 画面遷移は react-router(v7、declarative モード)+ **HashRouter** で行う。
  理由: Tauri 本番はビルド済み静的アセットの配信であり、パス直リロードのフォールバックに
  依存する BrowserRouter は使わない。デスクトップアプリにはアドレスバーがないため
  hash 方式の見た目の欠点は無関係。
- MUST: ルート定義は `react/src/App.tsx` に集約し、画面本体は `react/src/pages/` に置く(1画面=1ファイル)。
- MUST: 画面をまたいで保持したい UI 状態(選択中プロジェクト等)は URL(パス・クエリ)に置き、
  リロードで復元できるようにする。
- NEVER: ルーターの location state・メモリ上の Context に業務状態を載せる(業務状態は Rust 側。§2)。
- MUST: `tauri.conf.json` の `dragDropEnabled: false` を維持する。Tauri のファイルD&D機構(既定 true)は
  WebView 内のネイティブ HTML5 ドラッグ&ドロップを阻害する(issue #50 で実確認。かんばんの D&D が依存)。
- MUST: **1ウィンドウ = 1プロファイル**とする。ビューアの対象プロファイルはパスパラメータ
  (`/profiles/:id`)で決まり、複数プロファイルの同時利用は複数ウィンドウ(ハブから起動)で行う。
  ウィンドウ内タブバー(旧 issue #77)は廃止済み — 復活させる場合は本規約の改定が先。
  (歴史的経緯: タブごとの画面状態を React state に置く方式と `Settings.open_tabs` による
  復元を #77 で導入したが、ハブ中心の UI への転換で廃止した)

## 7. コマンド

```bash
cargo test -p domain -p app     # ロジックの検証（高速）
cargo clippy --all-targets -- -D warnings
cargo fmt --all
npm run tauri dev
npm run tauri build
```

- MUST: コミット前に `cargo fmt` と `cargo clippy -D warnings` を通す。
