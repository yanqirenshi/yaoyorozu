# Claude Desktop起源セッションの継続(`--resume` / `--continue`)に関する調査

- 作成日: 2026-08-11
- 対象: `apps/native`(ブランチ `refactor/native-b-type-architecture`)
- 関連コミット: `01be28e`, `200b95f`, `d483c43`

> **訂正(2026-08-11)**: 当初「Claude Desktop起源の会話は外部から継続できない」と
> 結論づけたが、これは `--resume` 固有の制約だった。`--continue` を使うと
> claude-desktop起源のセッションにも実際に継続・追記できることを追加検証で確認した。
> 詳細は「[訂正: `--continue` はclaude-desktop起源でも機能する](#訂正---continue-はclaude-desktop起源でも機能する)」を参照。

## 概要

`apps/native` に「表示中のセッションに対してAIへメッセージを送る」機能を実装する過程で、
セッションの継続方法によって挙動が異なることが判明した。

- **`claude --resume <session-id>`**: セッションIDを指定して継続する方式。
  Claude Codeが記録する各セッションの `entrypoint`(起点)によって、
  **`entrypoint: "claude-desktop"` のセッションは見つけられず失敗する**
  (`No conversation found with session ID: ...`)。
- **`claude --continue`**: カレントディレクトリの最新の会話をそのまま継続する方式。
  こちらは **`entrypoint` に関係なく、claude-desktop起源のセッションにも
  正しく継続・追記できる**ことを確認した(詳細は後述の訂正セクション)。

`entrypoint` は起動元プロセスが引き継ぐ環境変数(`CLAUDE_CODE_ENTRYPOINT`)によって
決まり、この環境変数を明示的に取り除いた上で `claude` を起動すれば、新規に作る
セッションの `entrypoint` は `"claude-desktop"` 以外(`"sdk-cli"` 等)になる。

**結論として、`--continue` を使う設計にすれば、表示中のClaude Desktop会話に
対してもメッセージ送信・継続が可能である。** 当初考えていたような
「ビューワーに徹するしかない」という制約は無かった。

## 背景: 何を実現しようとしたか

`apps/native` は `~/.claude/projects/<エンコードされたパス>/*.jsonl` を読み取り、
プロジェクトごとの最新セッションの会話を表示するビューワーとして実装していた
(`crates/infra` の `FileSystemRepository`)。

これに対し、「表示中の会話に対してテキストボックスからAIへメッセージを送り、
会話を継続できるようにしたい」という要望があり、実装した。

## 調査の経緯

### 1. 最初の実装(`--resume` によるセッション継続)

表示中セッションのIDをそのまま `claude --resume <session-id> --tools "" --print <text>`
に渡して継続させる実装を行った。

結果、実際のセッション(自分のPC上に存在する `.jsonl` ファイル)に対してすら、
以下のエラーで失敗した。

```
No conversation found with session ID: cc11f79b-3844-4582-9674-def04fb3fda3
```

`claude auth login` でCLI(WinGetでインストールした `claude.exe`)を認証済みにした後も
同じエラーが再現し、認証の問題ではないことを確認した。

### 2. 原因調査: `entrypoint` フィールド

各セッションの `.jsonl` は1行ごとに `entrypoint` フィールドを持つ。手元の
全プロジェクト・全セッションを調査したところ、**例外なく全セッションが
`"entrypoint":"claude-desktop"`** だった(Claude Desktopアプリから使っているため)。

`entrypoint` の値は、プロセスが引き継ぐ環境変数 `CLAUDE_CODE_ENTRYPOINT` に由来する。
Claude Desktop(このセッションを含む)から起動されたプロセスツリーは、子プロセスに
この環境変数を伝播させる。`apps/native` のアプリ自体も、開発中は
Claude Codeセッション内の `npm run tauri:dev` から起動していたため、
アプリが新規作成したセッションも同じく `entrypoint: "claude-desktop"` になっていた。

### 3. 検証: 環境変数を除去して起動

以下の環境変数を明示的に外して `claude` を起動すると、新規セッションの
`entrypoint` が `"sdk-cli"` に変わることを確認した。

```bash
env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID \
  claude --tools "" --print "検証用のテストです。3+3は?"
```

この `entrypoint: "sdk-cli"` のセッションに対しては、`--resume` が正常に機能し、
実際に前の質問内容を踏まえた応答が返ってきた(会話の継続を確認)。

```bash
env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID \
  claude --resume <session-id> --tools "" --print "さっき聞いた数式は何でしたか?"
# => 3+3です。
```

### 4. 結論(`--resume` に関して。※後に訂正あり)

- `entrypoint: "claude-desktop"` のセッションは、CLIの `--resume` から
  **見つけられない**(`No conversation found with session ID: ...`)。
- `entrypoint` がそれ以外(例: `"sdk-cli"`)のセッションは `--resume` 可能。
- `.jsonl` の実体は同じ `~/.claude/projects/` 配下に保存されるが、
  **`--resume` の可否はファイルの存在ではなく、起点(entrypoint)によって決まる。**

※ この時点では「resumeできない = 外部から継続する手段がない」と考えていたが、
これは `--resume` 固有の制約であり、`--continue` は異なる挙動を示すことが
後の検証で判明した(「訂正: `--continue` はclaude-desktop起源でも機能する」参照)。

### 5. 補足検証: ターミナルで実行した場合

「Claude Desktopではなくターミナルで実行した `claude code` ならどうなるか」を検証した。

`CLAUDE_CODE_ENTRYPOINT` 以外にも `AI_AGENT` / `CLAUDE_AGENT_SDK_VERSION` /
`CLAUDE_CODE_HOST_SESSION_ID` など、環境に存在するClaude/Agent関連の環境変数を
20個すべて外して `claude` を起動しても、`entrypoint` は変わらず `"sdk-cli"` のままだった。

```bash
env -u CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES -u CLAUDE_CODE_CHILD_SESSION \
    -u CLAUDE_PREVIEW_CLASSIFIER_FLOOR -u CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL \
    -u AI_AGENT -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID -u CLAUDE_EFFORT \
    -u CLAUDE_CODE_REPORT_FINDINGS -u CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH \
    -u CLAUDE_CODE_EAGER_FLUSH -u CLAUDECODE -u CLAUDE_AGENT_SDK_VERSION \
    -u CLAUDE_CODE_HOST_SESSION_ID -u CLAUDE_CODE_DISABLE_CRON \
    -u CLAUDE_CODE_OAUTH_SCOPES -u CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS \
    -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH -u BAGGAGE \
    -u CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH \
  claude --tools "" --print "完全に環境変数を外したテストです。5+5は?"
# => entrypoint: "sdk-cli"(認証・応答とも問題なし)
```

このセッションに対して `--resume` したところ、直前の内容を正しく覚えていた。

```bash
claude --resume 7e45842f-04c5-4c34-bdee-0aa6dd3b637b --tools "" --print "さっきの計算結果は何でしたか?"
# => 10でした。
```

**結論**: `entrypoint` を `"claude-desktop"` に固定しているのは `CLAUDE_CODE_ENTRYPOINT`
という変数単体であり、他の環境変数は無関係。通常のターミナル(この変数を持たない)から
実行した `claude code` の会話は、`--resume` でも継続可能である。

※ この時点まで「Claude Desktopアプリ経由の会話には`--resume`で割り込めない」ことが
「その会話を外部から継続する手段が無い」ことだと考えていたが、これも誤りだった
(次セクション参照)。

## 訂正: `--continue` はclaude-desktop起源でも機能する

`--resume <id>` がIDベースの内部レジストリを検索する方式であるのに対し、
`--continue`(`-c`)は「カレントディレクトリの最新の会話をそのまま継続する」
という別の方式である。この2つで挙動が異なるかを検証した。

### 検証手順

1. 過去に `--resume` で明示的に失敗していたclaude-desktop起源のセッション
   (`cc11f79b-3844-4582-9674-def04fb3fda3.jsonl`、実プロジェクトの
   実際の会話ログ)を、そのディレクトリで最新のファイルになるようにする
2. 環境変数(`CLAUDE_CODE_ENTRYPOINT` 等)を除去した状態で `--continue` を実行

```bash
env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID \
  claude --continue --tools "" --print "さっきの計算結果は何でしたか?"
```

結果、成功(終了コード0)し、そのセッションの実際の作業内容(プロジェクトの
統計値など)に基づいた具体的な応答が返ってきた。`.jsonl` を直接確認したところ、
**同じファイル(`cc11f79b-...jsonl`、同じ `sessionId`)に新しい行が追記されていた**
(追記された行の `entrypoint` は `"sdk-cli"` — 1つのファイルの中で行ごとに
`entrypoint` が異なりうることも分かった)。

念のため、より厳密な検証として次のプロンプトを送った。

```bash
claude --continue --tools "" --print "このセッションの一番最初に私が依頼した内容を、一言一句そのまま引用してください。"
# => > フォルダとファイルの中身を確認し内容を理解してください。
```

`.jsonl` の実際の1行目(`{"type":"queue-operation",...,"content":"フォルダとファイルの中身を確認し内容を理解してください。"}`)
と**完全に一致**した。これは推測や一般的な回答ではなく、そのセッションの
実際の全文脈を読み込んでいたことの確実な証拠である。

### 結論

- `--resume <id>`: IDベースの内部レジストリを検索する。**このレジストリが
  entrypointでフィルタされており、claude-desktop起源は「見つからない」**
- `--continue`: カレントディレクトリの最新の `.jsonl` を直接読んで文脈として使う
  方式と見られ、**entrypointに関係なく機能する**
- つまり **claude-desktop起源のセッションであっても、`--continue` を使えば
  外部から正しく継続・追記できる**。当初の「Claude Desktopの会話には
  外部から割り込めない」という結論は誤りで、正しくは「`--resume <id>` では
  割り込めないが、`--continue` では割り込める」だった。

## 現在の実装(`apps/native`)への反映

以下は、上記の訂正が判明する**前**、`--resume` ベースの制約を前提に行った設計である
(このあと `--continue` ベースに見直す予定)。

上記の結論を踏まえ、以下の設計とした。

1. **`claude` 起動前に、起点を示す環境変数を必ず除去する**
   これにより、アプリが新規作成するセッションは常に `--resume` 可能になる。
   - `crates/infra/src/lib.rs` の `DESKTOP_LINEAGE_ENV_VARS`
     (`CLAUDE_CODE_ENTRYPOINT` / `CLAUDECODE` / `CLAUDE_CODE_SESSION_ID` / `CLAUDE_PID`)
   - 除去は `build_send_message_command` 内で行う

2. **メッセージ送信時は、resume可能な直近のセッションがあればそれを継続し、
   なければ新規セッションを作る**
   - `domain::extract_entrypoint` / `domain::is_resumable_entrypoint`
     (entrypointが `"claude-desktop"` かどうかを判定する純粋関数)
   - `infra::latest_resumable_session_id`
     プロジェクト内のセッションを新しい順に遡り、resume可能な最初のものを探す
     (「最新の1件だけ」を見ると、途中でDesktop側の新しいセッションが割り込んだ際に
     継続対象を見失うため。実際にこの現象が発生し、修正した — コミット `d483c43`)
   - resumeが失敗した場合は新規セッションにフォールバックする

3. **表示(`get_latest_session` / `list_projects`)は変更していない**
   文字通り「そのプロジェクトで最終更新が最も新しいセッション」を表示し続ける。
   そのため、**表示されている会話と、メッセージ送信で継続される会話が
   別ファイルになるケースがある**(Desktop側で表示後に新しい会話をした場合など)。
   表示側もresume可能なセッションを優先するかどうかは、今後の検討事項として残っている。

## このアプリの位置づけへの影響(訂正後)

- `--continue` ベースの実装に見直せば、**表示中のClaude Desktop会話に対しても
  メッセージ送信・継続が可能**であることが分かった。当初懸念していた
  「ビューワーに徹するしかない」という制約は無かった。
- ただし `--continue` は「カレントディレクトリの最新の会話」を対象にするため、
  **表示中のセッションが実際にそのディレクトリの最新でなければ、意図しない
  セッション(表示していないもの)に追記されてしまう**リスクがある。
  実装時はこの点を踏まえた設計が必要(詳細は実装後に追記予定)。
- 元々の要件(表示中の会話をそのまま継続する)は `--continue` ベースの実装で
  満たせる見込みとなった。具体的な実装内容は本レポートを更新して追記する。

## 補足: アプリとターミナルの違い

resumeの可否という点では、アプリとターミナルはすでに同じ仕組み
(`CLAUDE_CODE_ENTRYPOINT` を持たない起動)で動いている。違いは以下の3点。

1. **プロセスの継続の仕方(構造的な違い)**
   - ターミナル(インタラクティブ): `claude` を実行すると1つのプロセスが
     起動したまま会話が続く。同じプロセス内でのやり取りなので、
     そもそも `--resume` は不要(プロセスを終了して後日また続けたい時だけ使う)
   - このアプリ: 「送信」のたびに `claude` を**都度起動して終了する**
     (`--print` で1往復だけ実行)方式。会話を繋げるために、毎回
     `--resume <前回のID>` を明示的に指定している
   - つまりアプリは「ターミナルで毎回 `claude --resume <id> -p "..."` を
     打っている」のと本質的に同じことを自動でやっている

2. **ツール実行の可否(意図的な制限)**
   - ターミナル: デフォルトで全ツール(Bash/Edit等)が使える
   - このアプリ: `--tools ""` で会話のみに固定(GUIのテキスト欄から
     確認なしにファイル操作やコマンド実行までさせるのは危険なための
     意図的な設計判断。技術的な制約ではない)

3. **セッション管理の自動化**
   - ターミナル: どのセッションIDをresumeするか、どの作業ディレクトリで
     実行するかをユーザーが自分で把握・指定する必要がある
   - このアプリ: プロジェクトを選ぶだけで、resume可能な直近セッションの
     探索(`latest_resumable_session_id`)・作業ディレクトリの特定
     (`latest_session_cwd`)を自動で行う

**Claude Desktopの会話を継続できないという制約は、アプリ・ターミナルどちらにも
等しく当てはまる。** アプリだけが不利というわけではない。

### `--resume` オプションの存在意義

「プロセスが生きている間はそもそも `--resume` は不要」という点を踏まえると、
このオプションは以下のような**プロセスが一度終了する場面**のために存在する。

1. **セッションの再開**: ターミナルを閉じた、PCを再起動した等、プロセスが
   一度終了した後に会話を続けたい場合(最も基本的な用途)
2. **`-p`(print)モードでの利用**: `-p` は「1回のプロンプト→応答→終了」の
   一発実行モードで、プロセスが生き続けるという概念がない。複数回の
   やり取りを成立させるには、呼び出しのたびに `--resume` するしかない。
   **このアプリの `send_message` はまさにこの用途に該当する**
3. **クラッシュからの復旧**: プロセスが異常終了しても会話を失わず再開できる
4. **別プロセス/別ウィンドウからの継続**: 同じ会話を、別のタイミングで
   開いた別プロセスから続けたい場合
5. **`/resume`(インタラクティブモード内の会話切り替え)**: 対話モード中に
   過去の会話一覧から選んで切り替える機能の内部的な仕組みとしても使われる

つまり `--resume` は「対話中の会話を繋ぐため」ではなく、**「一度終了した
プロセスに、過去の会話の続きをさせるため」**の機能である。

## 今後の検討事項

- **`send_message` の実装を `--resume <id>` から `--continue` に変更する**
  (表示中の会話をそのまま継続できるようにする本命の対応。次のタスクとして着手予定)
- `--continue` は「カレントディレクトリの最新の会話」を対象にするため、
  表示中のセッションと実際に継続されるセッションが一致することを
  どう保証するか(例: 送信直前に対象ディレクトリの最新ファイルを再確認する等)
- ツール実行(Bash/Edit等)を許可する場合の権限モード設計
  (現状は `--tools ""` で会話のみに限定)
- `--continue` が内部的にどのようなロジックで「最新の会話」を判定しているか
  (単純なファイルの更新時刻か、他の基準もあるか)の追加調査
