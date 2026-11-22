# server(YAOYOROZU のローカルサーバ)

`apps/native` を Tauri から「Next.js(ブラウザ)+ Rust サーバ」へ移す計画(#620)の、Rust 側。
`tauri` クレートには依存しない。`crates/domain`・`app`・`infra` をそのまま使う。
段階 1(#622)では `list_projects`・`get_settings`・通知の骨組みだけを持つ(通知と途中経過は、段階 3 の途中から WebSocket。#636)。

## 起動

```bash
npm run server:dev            # リポジトリのルートから(cargo run -p server)
# または
cargo run -p server --manifest-path apps/native/Cargo.toml --target-dir <別の target>
```

- 127.0.0.1 だけで待ち受ける。Ctrl+C で止まる(WebSocket も閉じる)。
- `/ws` を使うには、画面(Next)のポートを環境変数 `YAOYOROZU_CONSOLE_PORT` で渡して起動する(下の表)。渡さないと `/ws` は誰も通さず、券の rpc も断る。
- ビルドは `--target-dir` を分ける(main の `target/` やほかのセッションのビルドを巻き込まない)。

## データフォルダ・ポート

| 設定 | 既定 | 上書き |
|---|---|---|
| データフォルダ | `%APPDATA%\com.yaoyorozu.server` | 環境変数 `YAOYOROZU_DATA_DIR` |
| ポート | `14210` | 環境変数 `YAOYOROZU_SERVER_PORT` |
| 画面(Next)のポート | 無し(未設定なら `/ws` は誰も通さない) | 環境変数 `YAOYOROZU_CONSOLE_PORT`(`/ws` が通す Origin = `http://127.0.0.1:<この値>` と `http://localhost:<この値>` を作る) |

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
| `POST /rpc/issue_ws_ticket` | 必要 | **この構成だけの Query**。`/ws` へつなぐための**使い捨ての券**と、つなぐ先のポートを返す。本文 `{}` → `{ticket, port}`。ほかの rpc と同じ守り(トークン・Host。中継では Origin も) |
| `GET /ws` | **トークンは使わない**(券・Origin・Host) | WebSocket。通知と途中経過。下の「通知と途中経過」 |

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

`infra::write_atomic` は、書いたファイルの更新時刻(ミリ秒)が置き換え前より**必ず新しくなる**ようにそろえる。楽観ロックは更新時刻(ミリ秒)を「版」に使うため、
同じミリ秒のうちに 2 回書くと版が変わらず、古い版を持った保存が通ってしまう(同時の保存が 1 本に絞れない)ことを、テストで見つけて直した。

## 設定の版(プロファイルごとの `revision` と、全体の `revision`)

設定の版は 2 本ある。**スキーマの `version`(7)は上げない**: 追加するだけの項目で、無い既存のファイル(プロファイルの版が無いもの)は版 0 として読める
(上げると、古い版のアプリが未知のバージョンの破損ファイルとして退避してしまうため)。
- **プロファイルの版**(`profiles[].revision`): そのプロファイルの欄(リポジトリ・GitHub・フォルダ)が**実際に変わるときだけ** 1 つ増える。
- **全体の版**(`revision`): 全体の欄(`claude_projects_dir`・`restore_running_sessions`)が実際に変わるときだけ 1 つ増える。

`get_settings` は、表示しているプロファイルの版(`revision`)と全体の版(`global_revision`)を返す。`update_settings` は、
**`expectedRevision`(保存先のプロファイルの版)と `expectedGlobalRevision`(全体の版)の両方(必須)**を受け取り、どちらかが今と違えば 409 `settings_conflict`
(「設定がほかで変更されています。取り直してからやり直してください」)で断る。全体の欄はどのプロファイルの保存でも書かれるので、別のタブが変えた全体の欄を、
古い値で黙って戻さないために、全体の版も比べる。別のプロファイルの保存・切替・作成・削除・改名では、どちらの版も進まない(関係のない操作で 409 にならない)。
応答は保存後の 2 つの版 `{revision, global_revision}`。版は `u64` の上限で止まる(あふれても落ちない)。

**Tauri 版との違い: `update_settings` の `profileId` は必須**(省略・null は 400 `invalid_input`)。「アクティブのプロファイルへ保存する」動きをサーバから無くしたので、別タブで切替・作成があっても、保存はいつも画面が読み込んだプロファイルへ書かれる(切替で版を進める必要が無い)。そのプロファイルが削除されていたら 404 `not_found`(別のプロファイルへは書かない)。版は `u64` の上限で止まる(あふれても落ちない)。

## エラーの文面(サーバのパスを出さない)

I/O のエラーは `"<フルパス> が見つかりません: …"` のようにサーバのフォルダ構成(ユーザー名・ホーム・データフォルダ)を含む。クライアントへ返す `message` からは、
エラーを DTO にする**1 か所**(`dto.rs` の `From<app::AppError> for AppErrorDto`。`redact.rs`)で、パスを `…\<最後のフォルダ>\<名前>`(プロジェクト名・ファイル名まで)に絞る。
パスの先頭がサーバのユーザーのホームなら `~\…` に短くする(大文字小文字・`/` と `\` の違いを区別しない)。
詳しい内容(フルパスを含む)はサーバのログ(標準エラー。`[エラーの詳細] …`)へ出す。どの `/rpc` のハンドラも `app::AppError` を `ApiError` に変換して返す(`?`・`blocking`)ので、
すべての口がここを通る(個別に直していない)。

## 壊れた会話ファイル(`list_sessions`)

壊れた・読めない会話ファイルが 1 つあっても、それを飛ばして残りを返す(`app::list_sessions_lenient`)。飛ばしたファイル名(パスではない)は、画面の警告(`app:warning` と、
`list_pending_warnings` の控え。同じ内容は 1 回だけ)で知らせる。
警告を閉じると(`dismiss_pending_warning`)、**そのファイルが変わる(更新時刻かサイズが変わる)まで**同じ警告を出さない。変わればまた出る。
空のファイルと、1 行目がまだ書き終わっていない(1 MB 以下で改行が無い)ファイルは、claude が作っている最中とみなし、警告に数えず静かに飛ばす。

## パス・名前の見えない文字

パスとプロファイル名は、Unicode の性質(制御・行/段落区切り・書式・既定で無視される符号位置)で見えない文字を断る(`domain::contains_forbidden_invisible_or_control`。`icu_properties` を使う)。
ZWJ・ZWNJ・異体字セレクタは、前後に見える文字があるときだけ許す(絵文字の連結・ペルシャ語など)。予約名は `COM0`〜`COM9`・`LPT0`〜`LPT9`(上付き数字を含む)・`CONIN$`・`CONOUT$`。

## 通知(`session:changed`)の間引き

書き込みが続く会話では、ファイル監視が 0.1 秒ごとに通知を出す。同じプロジェクトの通知は**最短 0.5 秒の間隔**で配り、間隔の内に来たものは明けたあとに 1 回にまとめる(最後の変更は必ず届く。
`watcher.rs`)。画面側も、取り直しの開始を最短 1 秒あける(`apps/console/src/coalescedRunner.ts`)。

## 一時ファイルの名前と、起動時の掃除

`infra::write_atomic` の一時ファイルの名前は **`<元の名前>.<pid>.<時刻(ナノ秒)>.<連番>.tmp`**(名前の形の判定は `infra::is_write_atomic_tmp_name`)。保存の途中でプロセスが止められると残る。
**サーバのデータフォルダの中だけ**、起動時に、この形の**通常のファイル**(リンクはたどらない・消さない)で、最後の更新から **1 時間**以上たったものを消す(`data_files::cleanup_stale_tmp`)。
サブフォルダは見ない。リポジトリや `~/.claude` の中に残ったものは、勝手に消さない。
(提案: 同じファイルを次に保存するとき、その保存が作ったものでない古い一時ファイルを消す形も安全にできるが、今回は入れていない。)

## パスの検証(追加)

- 規則(`domain::LocalFolderPath`)に、次を足した: 上付き数字つきの予約名(`COM¹`〜`COM³`・`LPT¹`〜`LPT³`)、`CONIN$`・`CONOUT$`、Windows のパスに使えない文字(`< > " | ? *`。`C:\?\x` のような途中のデバイスの形)、
  点と空白だけの要素(`.`・`...`・`.. `。末尾の点・空白は Windows が落とすため `..` になる)、ゼロ幅・双方向の制御文字(U+200B〜U+200F・U+202A〜U+202E・U+2060〜U+2069・U+FEFF)。
- **ネットワークのドライブ**(`net use` で割り当てた `X:\`。形はローカルでも中身は SMB)は、存在の確認・保存・読み書きの前に、ドライブの種類(`GetDriveTypeW` の `DRIVE_REMOTE`。ネットワークへ問い合わせない)で断る
  (`folders.rs`・`infra::drive_kind`)。`subst` のドライブは、解決した先がローカルなら固定ドライブとして返るので通る。
- プロファイル名(`domain::ProfileName`)も、ゼロ幅・双方向の制御文字を断る。
- 設定ファイル(`save_claude_settings_file`・`save_project_settings_file`)は、JSON の最上位がオブジェクトでなければ 400(`domain::is_valid_json_object`)。

## 実行中セッション(段階 3: claude を起動したまま持つ)

`tauri/src/running_session.rs` の 14 command(`start_running_session`・`list_running_sessions`・`get_running_session`・`subscribe_running_session_progress`・`unsubscribe_running_session_progress`・`send_to_running_session`・`respond_permission`・`interrupt_running_session`・`switch_running_session`・`stop_running_session`・`get_claude_usage`・`archive_session`・`unarchive_session`・`rename_session`)と、
イベント(`running-session:changed`・`claude-usage:updated`・`app:warning`・`session:changed`)を写した。中身は `src/running.rs`(イベントループ・利用状況の定期取得・起動・自動再開・終了時の停止)、受け口は `src/rpc/running.rs`。

- **自動再開**: 起動時に、**このデータフォルダの `running-sessions.json` だけ**を読み、前回動かしていたものを 1 件ずつ再開する(使い捨てのデータフォルダでは空)。再開できなかったものは飛ばして `app:warning` に出す(控えからは消さない)。
  **新規に始めたばかりで会話ファイルがまだ無いセッションは、再開できない**(Tauri 版と同じ。会話ファイルのあるフォルダ名が控えに入らないため)。会話ファイルができたあと、一覧から再開(`resume`)したものは、次の起動で自動再開される。
- **終了**: 利用者が `stop_running_session` で止めたものは控えから外れる。サーバが終わるとき(Ctrl+C・コンソールを閉じる・ログオフ・シャットダウン)に止まったものは、控えに残り、次の起動で再開される。
- **保存**: `running-sessions.json`・`archived-sessions.json`・`git-ledger.json` は `infra::write_atomic` で書き、**保存のレーン**(`RunningServices.store_lane`。ロックの順は「レーン → 状態」)を通す。
- **Git 台帳(最小)**: `git-ledger.json` を読み、起動時の再開の前と、起動先の worktree を新しく作ったときに、登録済みプロファイルのリポジトリの Git の状態と突き合わせて保存する(`ServerState.git_ledger`)。
  ハブへの表示と `reconcile_git_state` command は段階 4。
- **利用状況**: 動いているセッションがあるあいだ、最初の 1 回は待たずに、以後 5 分おきとターン終了ごとに取得する。`get_claude_usage` は持っている値を返すだけ。

### 通知と途中経過(`/ws` の WebSocket。タブごとに 1 本。#636)

通知(取りこぼしてよい)と途中経過(文字の断片・ツールの開始など。順序が大事)は、ブラウザから Rust サーバへ**直接**つなぐ WebSocket で運ぶ(`src/ws.rs`)。
操作(`/rpc`)は、今までどおり Next が中継する(トークンはブラウザへ渡さない)。Next の中継は HTTP/1.1 で、同じ接続先への接続が 6 本までのため、タブごとの SSE が 6 本になると全部のタブの操作が止まった(#629)。WebSocket はその枠を使わない。

**つなぎ方**

1. タブは、中継を通して `issue_ws_ticket` で**使い捨ての券**とポートをもらう。
2. `ws://127.0.0.1:<ポート>/ws` へつなぎ、**最初のメッセージ**で `{"type":"ticket","ticket":"…"}` を送る(券は URL に入れない。クエリのある要求は 400 で断る)。
3. サーバが `{"type":"ready"}` を返したら、つながった。以後:
   - サーバ → タブ: `{"type":"event","name":<今のイベント名のまま>,"data":…}`(通知)/ `{"type":"progress","data":{subscription_id,seq,progress}}`(途中経過)/ `{"type":"subscribed"|"subscribe_failed","request_id",…}` / `{"type":"ping"}`
   - タブ → サーバ: `{"type":"subscribe","request_id","target"}` / `{"type":"unsubscribe","subscription_id"}` / `{"type":"pong"}` だけ。ほかは閉じる。

**守りの考え方**(ブラウザがサーバのポートへ直接つなぐ口が 1 つできる。守りは、券・Origin と Host の確かめ・127.0.0.1 だけでの待ち受け)

- **券**: UUID v4 を 3 つつなげた乱数(360 ビット)。有効 30 秒・**1 回だけ**・サーバのメモリにだけ持つ。未使用の券は 64 枚まで(超えると `issue_ws_ticket` が `invalid_input`)。券の確かめの前は、何も送らず、ほかのメッセージも受け付けない。5 秒以内に正しい券が来なければ閉じる。券をログに出さない。
- **アップグレードの要求で Host と Origin を確かめる**。Host は `127.0.0.1:<ポート>` / `localhost:<ポート>`。Origin は、画面のもの(`YAOYOROZU_CONSOLE_PORT` から作った `http://127.0.0.1:<画面のポート>` と `http://localhost:<同>`)だけ。**Origin が無い要求も断る**(403)。
  許す Origin の出どころは環境変数にした: 今の中継の Origin の確かめは「要求の Host と同じ」で、サーバは Next のポートを知らないため。サーバを起動する側(`dev-fake`・確認スクリプト・起動の手順)が、Next と同じ値を渡す。
- **購読・購読解除は、その接続の上のメッセージ**で行う。接続の ID はサーバの中だけで使う(外へ出ない)ので、「ほかの接続の ID を指して購読・購読解除する」ことはできない。1 接続の購読は 64 まで。
- **大きさと時間**: タブから受け取るメッセージは 16KB まで(超えたら閉じる)。サーバは 10 秒ごとに `ping` を送り、30 秒、何も返ってこない接続(凍結されたタブなど)は閉じる。1 通を 10 秒以内に送れない接続も閉じる。
- CSP の `connect-src` には、つなぐ先だけ(`ws://127.0.0.1:<サーバのポート>`)を足す(`apps/console/src/proxy.ts` が、サーバの書いたポートのファイルから実行時に読む。ワイルドカードにしない)。

**途中経過の運び方**(Tauri 版からの変えていない部分)

- 途中経過の本文は `{subscription_id, seq, progress}`(`progress` は今の `AddressedProgressDto`)。`seq` は**会話(実行中セッション)ごとの 1 からの連番**で、`get_running_session` の `progress_seq`(ここまでの番号)と突き合わせて、画面が重なり・順番の崩れを見分ける。
- **接続の表(接続の ID → 待ち行列。`src/progress.rs`)は状態とは別のロック**。購読が持つのは「接続の ID と購読の ID」だけで、イベントループは**状態のロックの外で、待たない送信**をする。
  待ち行列(512 件・16MB)があふれた(遅い・止まったクライアントの)接続は、**その接続の購読を全部外して WebSocket を閉じる**。画面は(自前で)つなぎ直し、購読し直して `get_running_session` で状態を取り直す(途中経過は捨ててよい。状態・答え待ちは Query で取れる)。
  接続が終わったとき(タブを閉じたとき)も、表と購読を片づける。
- 切れている間の通知・途中経過は失われる。画面は、つなぎ直したときの合図(`onReconnected`)で状態を取り直す。凍結されたタブ・スリープから戻ったタブは、接続が切れているので、同じ道で戻る。
- ブラウザ(全タブ)を閉じても claude は動き続ける。開き直すと、`list_running_sessions`・`get_running_session` で状態が見える。

### 守り(起動・送信の入口)

- 起動先(リポジトリ・worktree・プロファイル)は、**登録済みプロファイルのリポジトリと、実際の `git worktree list`(台帳)から引けるものだけ**。クライアントのパスは受け取らない(余分な項目は無視される)。
- claude の引数に、クライアントの文字列をそのまま使わない: 権限モード・起動時のモデルは**列挙**(`RunningPermissionModeDto`・`StartModelDto`。範囲外は 400)、表示名は 100 文字以内・制御文字なし、起動中のモデル切り替えは英数字と `-_.:[]` だけ(`app::begin_switch_running_session`)、ブランチ名は先頭の `-` などを断る。
- **同じ会話の二重起動は 409(`session_busy`)**。判断と「起動している最中」の印づけを同じ状態のロックの中で行うので、**同時に来た再開のうち通るのは 1 本だけ**。外部(ターミナルなど)で動いている同じ会話も `find_running` で断る。
- **本文の大きさ**: ふつうの command は 2MB まで(超えると 413)。`check_image_attachment`(添付の前の事前の検証。画像 1 枚の base64)だけ、画像 1 枚の上限(5,000,000 文字)が通る **6MB** まで。`send_to_running_session` だけ、画像の上限(5 枚 × 5,000,000 文字の base64)に合わせて **26MB** まで(超えると 413)。Next の中継(`apps/console`)は本文を貯めて転送するだけで、この大きさでも切らない(`--next` で確認)。
- 長い起動(worktree の最新化)は、サーバは応答を保留するだけで途中で切らない。中継の fetch の待ち時間は既定(5 分)。
- 起動した子プロセスには、親(Claude Desktop など)由来の起動元の印を引き継がない(`DESKTOP_LINEAGE_ENV_VARS` を除く。Tauri 版と同じ処理)。

### プロセスの寿命(ジョブオブジェクト・`server.lock`・終了)

- **ジョブオブジェクト**: 起動のいちばん最初に、**サーバ自身を `KILL_ON_JOB_CLOSE` のジョブへ入れる**(`infra::job_object`。ブレークアウトは許さない)。
  サーバが(強制終了・クラッシュを含めて)死ぬと、ジョブのハンドルが閉じられ、OS がジョブの中のプロセスを止める。**対象は、サーバの子孫のうち、このジョブに残るもの**: ふつうの方法で起動された claude とその子プロセス、git、npm など。サーバが死ぬと止まる。
  入れなかったときは、ログに出して起動を続ける。入れたあと、`IsProcessInJob` で確かめてログに出す(`ジョブへの所属: 確認済み`)。
  **会話ごとのジョブ**: claude を起動したあとで、その PID を会話用のジョブへ入れる。入れる前に claude が起動した子は、会話のジョブの外(サーバのジョブの中)に残り、会話を止めても止まらない(サーバが終わると止まる)。
  **守れないもの**:
  - 親子の関係なく起動されたプロセス(タスクスケジューラ・COM・`ShellExecute`・WMI 経由で起動されたもの)。
  - **Store 版(MSIX パッケージ)のアプリ**。確かめたのは Store 版の `pwsh` で、サーバのジョブの外にある「抜けることを許すジョブ」に入り、Ctrl+C・強制終了のあとも残った。
    そのアプリから `CREATE_BREAKAWAY_FROM_JOB` で起動された子も同じ。Store 版の Python など、ほかのパッケージのアプリは確かめていない。
  - claude が切り離して(`detached`)起動した子とその子は、1 つの会話を止めたあとも、**サーバが動いている間は残る**。サーバが終わるとジョブが止める。
  守り方(サーバ自身をジョブへ入れる)は、この点では変えていない。
- **穏やかな終了**: Ctrl+C のほか、コンソールを閉じる・ログオフ・シャットダウン(`tokio::signal::windows` の `ctrl_close`・`ctrl_logoff`・`ctrl_shutdown`)でも、WebSocket を閉じ、claude を並行して止める(標準入力を閉じる → 待つ → 強制終了)。
  OS が合図から打ち切るまでは約 5 秒なので、止める時間の上限は 4 秒。**間に合わなかった分はジョブオブジェクトが止める**。
  (Ctrl+C を「無視する」属性は子へ引き継がれる。サーバを起動する側がその属性を付けていると Ctrl+C が効かない。確認では起動の前に解除している。)
- **起動のとき、前のサーバの残りの claude**: 既存の `find_running` の断り(同じ会話は動いていると 409)に任せる。
- **`server.lock`**: データフォルダの `server.lock` を、データフォルダを実体のパスに解決した**直後・一時ファイルの掃除・トークン・ポートの書き込みより前**に、共有なし(`share_mode(0)`)で開き、プロセスが終わるまで持つ。
  2 つ目のサーバは `このデータフォルダはほかのサーバが使っています` で起動を断られ、トークン・ポートを書き換えない。強制終了でも OS がハンドルを閉じるので、ロックが残り続けることはない。

### 確認用の偽の claude

環境変数 `YAOYOROZU_SERVER_FAKE_CLAUDE=<fake_claude.cjs のパス>`(`crates/infra/tests/fake_claude.cjs`)を付けて起動すると、claude の代わりに `node <そのファイル>` を起動する(認証・課金・実際の会話に触れない)。確認専用。起動のログに出る。

```bash
cargo build -p server
node server/scripts/e2e-running.mjs          # サーバへ直接
node server/scripts/e2e-running.mjs --next   # Next の中継(apps/console を next build したあと)を通して
node server/scripts/e2e-real-claude.mjs --real   # 本物の claude を 1 セッションだけ(使い捨てのリポジトリ。下)
```

`e2e-running.mjs` は、**使い捨て**のデータフォルダ・ホーム(`USERPROFILE`/`HOME`)・リポジトリ・会話フォルダで、偽の claude を実際に起動し、起動 → 送信 → 途中経過 → 権限 → 中断 → 切り替え → 停止 → 再開 → Ctrl+C → 再起動 → 自動再開 → 二重起動の拒否 → 強制終了(子孫 0 件)までを確かめる。
共通部分は `e2e-lib.mjs`。止めるのは、スクリプトが起動した PID とその子孫だけ。`cargo test -p server --test running` は、claude を起動しない部分(接続・あふれ・購読の守り・本文の大きさ)の確認。`cargo test -p server --test ws` は `/ws` の守り(券・Origin と Host・メッセージの種類と大きさ・接続の後片付け)を、実際のソケットでつないで確かめる。
`node server/scripts/e2e-ws.mjs [--next]` は、実際のサーバ(exe)へ直接つないで、守りの表(券なし・でたらめな券・期限切れ・使用済み・最初のメッセージが券でない・券の前の購読・大きすぎるメッセージ・Origin 違い・Origin 無し・Host 違い・クエリの券)と、サーバのログに券が出ないことを確かめる(期限切れの確認で 31 秒待つ)。

`e2e-real-claude.mjs --real` は、**本物の claude を 1 セッションだけ**、使い捨てのデータフォルダ・リポジトリで起動する(起動 → 1 往復 → 停止 → 再開 → Ctrl+C → 子孫 0 件 → サーバの再起動 → 自動再開)。
本物の claude は `~/.claude` の認証が要るのでホームは差し替えない。作る会話は 1 つだけで、終わりにそのフォルダ(`~/.claude/projects/` の、使い捨てのリポジトリ用のもの)を消す。
claude の認証が切れていると、モデルの応答が認証エラーで失敗する(サーバの不具合ではない。`claude auth login` で入り直すと通る)。
