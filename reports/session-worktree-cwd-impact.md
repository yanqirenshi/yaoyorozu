# セッションを自分の作業ツリーで起動する案の影響範囲(#564)

Issue: [#564](https://github.com/yanqirenshi/yaoyorozu/issues/564)。
実施: Lab (PM)、2026-10-07。調査のみ(実セッションの作業フォルダは変えていない。使い捨ての会話で実測し、すべて削除済み)。

## 結論

**最大の論点だった「会話が別フォルダに分かれる」は、いまの CLI(2.1.268)では起きない。**
`--resume <ID>` を別の作業フォルダから実行しても、会話ファイルは元のフォルダ(`~/.claude/projects/C--Users-yanqi-prj-yaoyorozu/`)の同じファイルに追記され、新しいプロジェクトフォルダは作られなかった(app と同じ stream-json の起動方法でも同じ)。
記憶(`memory/`)も、worktree で起動したセッションは本体の `projects/C--Users-yanqi-prj-yaoyorozu/memory/` を読む(CLI が worktree を本体のリポジトリに寄せる)。

したがって「各セッションを自分の作業ツリーで起動し直す」案は、**会話・記憶・設定を失わずに実施できる**。
変わるのは会話ファイルの各行に記録される `cwd` と `gitBranch` で、ハブはそれを見て線を引くので、**起動し直した時点から固定ブランチの作業ツリーに結ばれて見える**。

対象は 12 セッション中 9(固定ブランチの作業ツリーが既にあるもの)。
3 つ(デザイン (UI)・Lab (PoC:実装)・Lab (PoC:検証))は作業ツリーが無く、app の「ブランチ指定」で作らせるか、先に作る必要がある。
1 件あたりの手順は「停止 → worktree を選んで起動(再開)→ 確認」で、戻すときは「停止 → リポジトリ本体で起動(再開)」。会話ファイルは触らないので、途中でやめても壊れない。

## 1. 起動の仕組みと、作業フォルダを変えたときに起きること

### 1.1 実測(使い捨ての会話)

| 手順 | 結果 |
|---|---|
| フォルダ A で会話を作る(`claude -p`) | `projects/C--Users-yanqi-tmp-poc564-A/<ID>.jsonl` ができる |
| フォルダ B から `claude -p --resume <ID>` | **A のファイルに追記**(23 → 30 行)。B のプロジェクトフォルダは作られない。文脈あり(前の答えを言い当てた)。追記された行の `cwd` は B |
| A から `--resume` | A のファイルに追記(37 行) |
| B から `--resume`(2 回目) | 同じ(44 行) |
| B から、app と同じ起動方法(`--input-format stream-json --output-format stream-json --verbose --resume <ID>`、`--print` なし) | 同じ(50 行)。`system/init` の `cwd` は B、会話ファイルは A のまま |

同じファイルの中に `cwd` が A と B の両方の行が並ぶ形になる。
`gitBranch` は各行で、その時の cwd のブランチが記録される(git 管理外なら `HEAD`。worktree `yaoyorozu-lab` で起動した会話では `session/lab`)。

#217(2026-08、同じ session_id の jsonl が複数フォルダにできた)は当時の CLI の挙動で、いまの版では再現しない。
app は #217 で「同じ session_id のファイルが複数あっても 1 つの会話として扱う」ようになっているので、万一分かれても壊れない。

### 1.2 記憶・設定

| 項目 | worktree で起動したとき |
|---|---|
| 自動記憶(`memory/`、`MEMORY.md`) | **本体と同じ** `projects/C--Users-yanqi-prj-yaoyorozu/memory/` を読む(`system/init` の `memory_paths.auto` で確認。`.claude/worktrees/` 配下でも、`yaoyorozu-lab` のような隣のフォルダでも同じ) |
| `CLAUDE.md`・`.claude/rules`・`.claude/skills`・`.claude/settings.json`・`.claude/launch.json` | worktree 自身のもの(リポジトリに入っているので全 worktree にある。内容はそのブランチの版) |
| サブエージェントの記録(`<ID>/subagents/`)・`session-env/` | 会話ファイルと同じ場所(変わらない) |
| `~/.claude/sessions/<PID>.json`(実行中台帳) | `cwd` が worktree になる |

### 1.3 app 側の動き

- 起動(再開)の `WorktreeSpec` は `Main` / `Existing { worktree_id }` / `Branch { branch_name }` の 3 つ(#437/#438)。`Existing` は git 台帳(`git-ledger.json`)の `worktree_id` で指定し、`Branch` は無ければ app が worktree を作る(ブランチも無ければ `origin/main` から)
- 再開の控え(`running-sessions.json`)は `project`(会話ファイルのフォルダ名)と `worktree_id` を持つ。worktree で起動し直すと `worktree_id` がその ID になり、`project` は変わらない(会話ファイルが動かないため)。app の起動時の自動再開は `Existing` を**作らない**ので、worktree を消していると再開は飛ばされる(控えは残る)
- ハブ: セッションの `cwd`(会話ファイルの行から。複数あれば新しい方)がどのリポジトリ・worktree の下にあるかで線を引く(`HubPage.tsx` の `resolveSessionWorktree`)。`gitBranch` も同様に新しい行の値。**起動し直して 1 回でも発言すれば、固定ブランチの worktree に結ばれる**。それまでは main のまま
- ビューアの左ペインはプロジェクトフォルダ(`C--Users-yanqi-prj-yaoyorozu`)の会話を一覧するので、変わらない

### 1.4 調べたが使えなかったもの

CLI には `CLAUDE_CODE_PROJECT_DIR_NAME`(会話フォルダ名の上書き)があるが、`CLAUDE_CONFIG_DIR` を指定したときしか効かず、指定すると `.claude.json` の場所も変わって設定が読めなくなる。
今回の案には不要(フォルダが分かれないため)。

## 2. 作業ツリー側の前提

### 2.1 既存の作業ツリー(2026-10-07 時点)

| セッション | 固定ブランチ | 作業ツリー | `node_modules` | git 台帳の ID |
|---|---|---|---|---|
| デザイン (UI) | `session/design-ui` | **無し**(過去に 3 回作って消している) | — | — |
| デザイン (ドメイン:Data) | `session/design-domain-data` | `.claude/worktrees/domain-data` | あり | あり |
| デザイン (ドメイン:オブジェクト) | `session/design-domain-object` | `.claude/worktrees/domain-object` | あり | あり |
| デザイン (画面構成) | `session/design-sitemap` | `.claude/worktrees/design-sitemap` | あり | あり |
| 実装:APP (共通) | `session/impl-app` | `.claude/worktrees/impl-app` | あり | あり |
| 実装:APP (画面:/) | `session/impl-app-hub` | `.claude/worktrees/impl-app-hub` | あり | あり |
| 実装:APP (画面:/settings) | `session/impl-app-settings` | `.claude/worktrees/settings` | あり | あり |
| 実装:APP (画面:/claude) | `session/impl-app-claude` | `.claude/worktrees/impl-app-claude` | あり | あり |
| 実装:Web | `session/impl-web` | `yaoyorozu-web-117`(隣のフォルダ) | あり | あり |
| Lab (PM) | `session/lab` | `yaoyorozu-lab`(隣のフォルダ) | あり | あり |
| Lab (PoC:実装) | `session/lab-poc-impl` | **無し**(ブランチはある) | — | 削除済みの記録のみ |
| Lab (PoC:検証) | `session/lab-poc-verify` | **無し**(ブランチも無い) | — | 削除済みの記録のみ |

- 既存の 9 本はすべて `node_modules` が入っていて(379 パッケージ、約 570 MB)、`node_modules/native` などのリンクも自分のツリーを指している。`npm ci` は不要
- 無い 3 本は、app の「ブランチ指定で起動」(`WorktreeSpec::Branch`)で作らせるか、`git worktree add` + `npm install` で先に作る。`npm install` は Volta のリンクの都合で失敗することがある(memory `worktree-remove-leaves-npm-links`: 消した跡が残っていると同じパスに作れない)
- 未使用の worktree が 2 本残っている: `jovial-maxwell-cc4800`(detached、9 月 13 日以来未使用、`target` 1.7 GB)、`yaoyorozu-web-session`(detached)。片付けの候補
- git 台帳には削除済みを含め 27 件の worktree が記録されている(同じパスを作り直すたびに ID が増える)

### 2.2 ディスクの見積もり

| 項目 | 1 本あたり | 備考 |
|---|---|---|
| `node_modules` | 約 570 MB | 既存 9 本は済み |
| `apps/web/.next` | 9 MB〜2 GB | main は 2 GB(長く使った分)。web の dev サーバを動かすセッションで増える |
| `apps/native/target`(dev) | 約 2.3 GB(`line-tables-only` 採用後。#559) | native をビルドするセッションだけ。放置すると増分の履歴で増え続ける(main は 2 か月で 32 GB になった) |

native をビルドするのは 実装:APP 系 4 + Lab 系 3 の最大 7 本。全部がまっさらから作ると **約 16 GB**(10/7 の掃除で 76 GB 回収した直後の空きは 166 GB)。
ただし現状でも各セッションは自分の worktree でビルドしているので(impl-app に 6 GB、lab に 7 GB の `target` が既にある)、**起動フォルダを変えても増え方は変わらない**。増えるのは「新しく作る 3 本」の分だけ。

### 2.3 その他

- `.claude/launch.json` のポート(web 3000 / vite 1420)は全 worktree で同じ。複数セッションが同時に dev サーバを起動すると衝突するが、これは今も同じ(main で起動している)
- 実行中ガード(#361)と `taskkill` の運用(CLAUDE.md)は cwd に依存しない

## 3. 対象にすべきセッション

| 区分 | セッション | 扱い |
|---|---|---|
| main のまま | デザイン (全体)・管理・運用:リリース | CLAUDE.md の例外(ドキュメントのみ main 直接、リリースは main)。変えない |
| worktree で起動し直す(作業ツリーあり) | 実装:APP (共通)・画面:/・画面:/settings・画面:/claude・実装:Web・デザイン (ドメイン:Data)・(ドメイン:オブジェクト)・(画面構成)・Lab (PM) | 9 件。手順は §4 |
| worktree を作ってから | デザイン (UI)・Lab (PoC:実装)・Lab (PoC:検証) | 3 件。`Branch` 指定で app に作らせる(`lab-poc-verify` はブランチも無いので `origin/main` から作られる) |

## 4. 手順と戻し方

### 4.1 1 セッションあたり(やる場合)

1. そのセッションが待機中であることを確かめる(実行中なら待つ)
2. ハブのインスペクタで「停止」
3. 「起動(再開)」で worktree に固定ブランチの作業ツリーを選ぶ(無いものは「ブランチ」で固定ブランチ名を指定)。権限モード・表示名は移行時と同じ(auto、元のタイトル)
4. 待機になったら動作確認の質問を 1 つ送る(「いまの作業フォルダとブランチを教えて」など)。会話の文脈が残っていること、`cwd` が worktree であることを確認
5. ハブで、そのセッションが固定ブランチに結ばれたことを確認(1 回発言すると線が移る)
6. 再開の控え(`running-sessions.json`)の `worktree_id` がその worktree になっていることを確認(任意)

所要は 1 件 2〜3 分。15 件を一度にやる必要はなく、**1 件ずつで問題ない**(セッションどうしは独立。途中でやめても、済んだものは worktree、残りは main で動き続けるだけ)。

### 4.2 戻し方

「停止」→「起動(再開)」で worktree に**リポジトリ本体**を選ぶ。
会話ファイルは最初から動いていないので、戻しても会話・記憶はそのまま。
会話ファイルには `cwd` が worktree の行が残るが、ハブは新しい行を見るので、戻して発言すれば main に戻る。

### 4.3 気を付けること

- 起動し直す前に、そのセッションの worktree が最新の main を取り込んでいるか(`git merge origin/main`)は関係ない(セッション自身がこれまでどおり作業前にやる)
- 起動フォルダが worktree になると、**セッションが `cd` せずに編集したファイルは worktree 側に入る**。これが狙いだが、逆に「main を直接いじる作業」(ドキュメントの小変更)は、そのセッションからは `cd` が要るようになる
- `.claude/worktrees/` 配下のツリーを消すと、そのセッションの自動再開は飛ばされる(控えは残る)。消す前にそのセッションを main で起動し直す

## 5. やる場合 / やらない場合

| | やる場合 | やらない場合 |
|---|---|---|
| ハブの見え方 | 固定ブランチの worktree に結ばれ、どこで作業中か分かる | 全部 main に集まったまま |
| main を誤って編集するリスク | 起動フォルダ = 自分の worktree なので、`cd` し忘れても main は汚れない | 残る(#480〜#482 のレイアウト JSON の件が再発しうる) |
| 会話・記憶・設定 | 変わらない(§1) | 変わらない |
| 手間 | 1 件 2〜3 分 × 12、worktree 作成 3 本 | 無し |
| ディスク | 新規 3 本分(各 0.6 GB + ビルドすれば 2.3 GB) | 無し |
| 戻し方 | 停止 → 本体で再開。会話は無傷 | — |
| 残る不便 | main 直接の作業は `cd` が要る。`.claude/launch.json` のポート衝突は今と同じ | ハブが実態を表さない |

採否とイシュー化はデザイン (全体) が行う。

## 付録 A. 確認に使った方法

- 会話の置き場所: `C:\Users\yanqi\tmp\poc564\A` / `B` で `claude -p --tools ""`・`--resume`・stream-json 起動を行い、`~/.claude/projects/` のフォルダと jsonl の行数・`cwd`・`gitBranch` を見た。終了後、フォルダと会話ファイルを削除
- 記憶の場所: `yaoyorozu-lab` と `.claude/worktrees/jovial-maxwell-cc4800` で stream-json 起動し、`system/init` の `memory_paths` を見た。作られた会話ファイル 2 つは削除
- app の挙動: `crates/app/src/restore_running_sessions.rs`・`running_session.rs`・`worktree.rs`、`react/src/pages/HubPage.tsx` のコードと、`%APPDATA%\com.yaoyorozu.native\running-sessions.json` / `git-ledger.json` の中身
- 作業ツリー: `git worktree list`、各ツリーの `node_modules` と `apps/native/target` の有無・大きさ
- `CLAUDE_CODE_PROJECT_DIR_NAME` の確認で `CLAUDE_CONFIG_DIR` を `~/.claude` に指定したところ、CLI が `~/.claude/.claude.json` を新しく作った(設定の読み先が変わるため)。本物の `~/.claude.json` は無傷で、作られたファイルは削除した
