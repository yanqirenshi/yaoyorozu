# server(YAOYOROZU のローカルサーバ)

`apps/native` を Tauri から「Next.js(ブラウザ)+ Rust サーバ」へ移す計画(#620)の、Rust 側。
`tauri` クレートには依存しない。`crates/domain`・`app`・`infra` をそのまま使う。
段階 1(#622)では `list_projects`・`get_settings`・SSE の骨組みだけを持つ。

## 起動

```bash
npm run server:dev            # リポジトリのルートから(cargo run -p server)
# または
cargo run -p server --manifest-path apps/native/Cargo.toml --target-dir <別の target>
```

- 127.0.0.1 だけで待ち受ける。Ctrl+C で止まる(SSE も閉じる)。
- ビルドは `--target-dir` を分ける(main の `target/` やほかのセッションのビルドを巻き込まない)。

## データフォルダ・ポート

| 設定 | 既定 | 上書き |
|---|---|---|
| データフォルダ | `%APPDATA%\com.yaoyorozu.server` | 環境変数 `YAOYOROZU_DATA_DIR` |
| ポート | `14210` | 環境変数 `YAOYOROZU_SERVER_PORT` |

- **MSI 版のフォルダ(`com.yaoyorozu.native`)は読まない・書かない**。指定されると起動を断る
  (同じフォルダを使うと、トークンを上書きし、後の段階では自動再開が本番のセッションに再開を試みる。native.md §8)。
  守りは名前の文字列の比較ではなく、**解決した実体のパスで行う**: 何かを作る・書く前に、指定を実体のパスへ解決する
  (相対・`.`・`..`・末尾のドット・8.3 の短い名前・ジャンクション・シンボリックリンクを解く。まだ無いフォルダは、
  実在する一番深い親を解決してから残りを足す)。名前が `com.yaoyorozu.native` のフォルダ、または本物の
  `%APPDATA%\com.yaoyorozu.native` を同じ方法で解決したもの自身かその下なら断る。`:` を含む名前(代替データストリーム)など
  フォルダにできない指定も、何も書く前に断る(断った場合に `.tmp` を含む残骸は残らない)。
- **書き込みの形**(`infra::write_atomic`。サーバが書くファイルは、これを使う): 保存ごとに**別の名前の一時ファイルを新規作成**(`create_new`)→ fsync → rename。リンクが残っていてもリンク先を書き換えず、失敗しても一時ファイルを残さない。
- **設定の保存は直列化**する(`AppContext.save_lane`): 設定を変える command は、状態を更新したあと保存のレーンを 1 つずつ通り、**レーンに入った時点の最新の状態**を書く(同時に送っても、最後に書かれるのは最新の状態)。ロックの順は「レーン → 状態」の一方向で、状態のロックを持ったままレーンを待たず、ファイル I/O もしない。段階 3 以降の `running-sessions.json`・`hub-layout.json` なども同じ形(`write_atomic` + 専用のレーン)にする。
- データフォルダの中身: `settings.json`(起動時に読む。無ければ既定値。**壊れているときは `settings.json.corrupt.<時刻>` へ退避して既定値で起動し、古い版のときは新しい版へ書き直す**。どちらも既存の infra(`FileSettingsStore`)の動きで、サーバ自身は書き込まない)、`server-token`(起動のたびに作り直す)、
  `server-port`(実際のポート)。Next の中継が `server-token`・`server-port` を読む。

## エンドポイント

| | 認証 | 内容 |
|---|---|---|
| `GET /health` | 不要 | `{ok, version}` |
| `POST /rpc/list_projects` | 必要 | 本文 `{}` → `ProjectDto[]` |
| `POST /rpc/<command>` | 必要 | 実装している command の一覧は `npm run diff-commands`(Tauri 版との突き合わせの表)で出す。本文 = 今の command の引数(camelCase)、応答 = 今の DTO |
| `POST /rpc/list_pending_warnings` | 必要 | **この構成だけの Query**。起動直後に出て、画面が取りこぼした警告(設定ファイルの破損)の控え。`settings:corrupted` はイベントでなくこちらで取る(画面は開いたときと `onReconnected` で取る) |
| `POST /rpc/dismiss_pending_warning` | 必要 | 警告を閉じる(控えから消す)。本文 `{id}` |
| `POST /rpc/check_folder` | 必要 | **この構成だけの Query**。Tauri 版のフォルダ選択ダイアログの代わり。本文 `{path}`(絶対パスだけ。`..`・`:` を含む形は 400)→ `{path, exists, is_dir, is_git_repository}`。読み書きはしない |
| `POST /rpc/get_settings` | 必要 | 本文 `{profileId?: string \| null}`(キーは今のフロントと同じ camelCase)→ `SettingsDto` |
| `GET /events` | 必要 | SSE。イベント名 = `event:`、ペイロード = `data:` の JSON。段階 1 は 2 秒おきの `ping`(`{n}`) |

- 本文が空なら `{}` と見なす。応答の DTO は今の Tauri 版と同じ形(`src/dto.rs` に写してある)。
- 全エンドポイントで `Host` が `127.0.0.1:<port>` / `localhost:<port>` であることを確かめる(違えば 403 `forbidden_host`)。
  `/health` 以外は `Authorization: Bearer <server-token>` が必須(無い・違えば 401 `unauthorized`)。読み取りも含む。

## エラーと HTTP ステータス

本文は今の `AppErrorDto`(`{code, message}`)のまま。フロントは必ず `code` で分岐する(ステータスは補助)。
対応表は `src/error.rs` の冒頭にある。要点:

- `invalid_input` 400 / `not_found` 404 / 競合系(`session_busy`・`file_conflict`・`claude_md_conflict`)409 /
  `cwd_missing` 422 / `github_api_failed` 502 / `timeout` 504 / `io`・`cli_*` ほか 500。
- **401 はサーバの認証失敗(`unauthorized`)専用**。GitHub の認証系(`github_unauthenticated` など)は 403 にしてある。
- 未知の `/rpc/<名前>` は 404 `not_found`、壊れた本文は 400 `invalid_input`。

## テスト

```bash
cargo test -p server
```

ネットワークを使わず、ルーターへ直接要求を渡す(認証・Host・エラーの形・`get_settings`)。

## Tauri 版との関係

`tauri/src/{lib,dto,state}.rs` の該当部分を**写している**(共通クレートへの切り出しはしない。Tauri 版は凍結)。
`AppHandle.emit` に当たるものは `EventBus`(`src/events.rs`)にまとめてある。

## パスの検証(読み書きの入口)

クライアントから受け取るパスは、そのまま読み書きに使わない(native.md §4・§7)。

- `~/.claude` 系(`/claude`): パスやファイル名は受け取らない(CLAUDE.md・settings.json は固定)。Explorer(`list_claude_dir`)は
  `~/.claude` からの相対パスだけ(`..`・`\`・`:`・絶対パスは 400)で、リンク経由の逸脱は infra が検出する。`.credentials.json` の中身を読む経路は無い。
- 会話ファイル: `<セッションのルート>/<project>/<sessionId>.jsonl` に固定。`project`・`sessionId` は**ファイルに触る前に**サーバの入口で検証する
  (`domain` の検証に加えて `:` を拒否。Windows では `dir.join("C:x")` が `dir` の外を指すため。`domain` の検証は `:` を見ない)。
- リポジトリ系(CLAUDE.md・Rules・Skills・設定ファイル・yyz): パスは受け取らず、`profileId` から settings の `repository_path` を引く
  (未登録の `profileId` は 404、`repository_path` 未設定は 400)。ルール名・スキル名は単一セグメントだけ(`:` も拒否)、設定ファイルは
  `which`(`settings` / `settings_local`)の列挙値だけ。
- 手入力のフォルダ確認(`check_folder`): 絶対パスだけ。`..`・`:` は 400。存在・フォルダか・`.git` の有無だけを返す。

### 保存するパス・名前の検証(`domain::LocalFolderPath`・`domain::ProfileName`)

- 設定に保存するパス(`update_settings` の `repository_path`・`claude_projects_dir`)と、画面のパスの確認(`check_folder`)は、**同じ規則**(`app::validate_folder_path` →
  `domain::LocalFolderPath`)で判定する。受け付けるのは `X:\…` / `X:/…`(`X` は英字 1 文字)の絶対パスだけ。**断るもの**: 相対パス・ドライブ相対(`C:x`)・
  `\` 始まり、UNC(`\ホスト\…`)・デバイスの形(`\?\`・`\.\`・`\??\`・`GLOBALROOT`)、ドライブ文字以外の `:`(代替データストリーム)、制御文字(改行・NUL・タブなど)、
  `..` の要素、予約デバイス名(`CON`・`NUL`・`COM1` など)。**形だけで即座に断る**(UNC を受けると、サーバが宛先へ SMB で読みに行ってしまうため。存在の確認より前)。
  空(未設定)は `update_settings` では今の仕様どおり許す(`check_folder` は断る)。
- **すでに保存されている不正な値**(古い版や手書きで入ったもの)は、起動を止めない。`get_settings` は成功し(画面で直せる)、その値を起点にした読み書き
  (CLAUDE.md・Rules・Skills・設定ファイル・yyz、セッションの一覧・会話)だけを 400 で断る。
- プロファイル名(`create_profile`・`rename_profile`): 前後の空白を落とし、空・100 文字超・制御文字は 400(`create_profile` の名前の省略・空白だけは既定名)。

### ファイルの保存のレーン(`AppContext.file_lane`)

CLAUDE.md・設定ファイル(`~/.claude` と、プロファイルのリポジトリの両方。保存の 4 つの口)の保存は、**全体で 1 本のレーン**を 1 つずつ通る。
楽観ロックの「今の更新時刻を確かめる → 書く」をひとまとまりで行い、同じファイルへの保存どうしが間に割り込めない。同じ `expectedModifiedAtMs` で同時に来た保存は、
通るのが 1 本だけで、残りは 409(`claude_md_conflict`・`file_conflict`)になる(500 にならない)。レーンをファイルごとにせず全体で 1 本にしたのは、低頻度の操作で、単純な方を選んだため。
書き込みの実体は、infra の全ストアが `infra::write_atomic`(保存ごとに別の名前の一時ファイルを新規作成)を使う。固定名の `<名前>.tmp` を `File::create` で作る書き方は残していない。
