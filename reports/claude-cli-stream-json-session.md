# claude CLI を起動したまま stream-json で対話する(PoC #382)

Issue: [#382](https://github.com/yanqirenshi/yaoyorozu/issues/382)(親: [#381](https://github.com/yanqirenshi/yaoyorozu/issues/381))。
実施: Lab (PM)、2026-09-24。

## 結論

**Rust から直接(Node サイドカー無し)で可能**。
`claude` を `--input-format stream-json --output-format stream-json` で子プロセスとして起動し、標準入出力の JSON 行だけで、複数回の往復・権限の問い合わせと応答・中断・`--resume` での再開・モデル切替・画像添付のすべてが動いた。
使ったのは Rust 標準ライブラリ(`std::process` + スレッド + `serde_json`)だけで、tokio も追加クレートも要らなかった。
検証した 2 版(2.1.150 / 2.1.280)で、制御メッセージの形は同じだった。

Agent SDK(TypeScript)は、この同じプロトコルを `claude` に対して喋っているラッパーに過ぎない(§0.2)。
サイドカーにする理由は無い。

## 検証環境

| 項目 | 内容 |
|---|---|
| OS | Windows 11 Pro |
| CLI (a) | 2.1.150 — PATH の WinGet 版 `…\WinGet\Packages\Anthropic.ClaudeCode_…\claude.exe` |
| CLI (b) | 2.1.280 — Desktop 同梱 `%APPDATA%\Claude\claude-code\2.1.280\claude.exe`(Desktop が実際に起動しているもの) |
| 探査ツール | Rust 1.95 の使い捨て CLI(`cli-probe`。§付録 A) |
| 作業フォルダ | スクラッチパッド配下の使い捨てフォルダ(実運用の会話には触れていない) |
| 認証 | ユーザーの OAuth(Claude Max)。API キー不使用 |

結果は特記が無い限り両版で同じ。
差があるところは「150」「280」と明記する。

## 0. 起動方法

### 0.1 Desktop 自身の起動引数(実測)

Desktop は各セッションの CLI を次の引数で起動している(`Get-CimInstance Win32_Process` で確認。`--settings` の JSON と `--allowedTools` の一覧は省略)。

```
claude.exe --output-format stream-json --verbose --input-format stream-json
  --effort high --model <model> --permission-prompt-tool stdio
  --resume=<sessionId> --allowedTools mcp__… --disallowedTools SubscribePR
  --setting-sources=user,project,local --permission-mode auto
  --include-partial-messages --await-initialize --thinking-display omitted
  --replay-user-messages --settings "{…}"
```

つまり Desktop 自身が「起動したままの CLI と stream-json で対話する」方式であり、app が目指す形そのもの。
`--print` は付いていない。

### 0.2 Agent SDK の引数生成(`@anthropic-ai/claude-agent-sdk` 0.3.281 の `sdk.mjs`)

SDK も同じ形で起動している(要点のみ)。

- 固定: `--output-format stream-json --verbose --input-format stream-json`
- `canUseTool` コールバックを渡すと `--permission-prompt-tool stdio`(MCP ツール名を渡す方式と排他)
- `resume` → `--resume=<ID>`、`permissionMode` → `--permission-mode <mode>`、`includePartialMessages` → `--include-partial-messages`
- `--print` は付けない
- 起動後、最初に `initialize` の control_request を送る(§0.4)

型定義(`sdk.d.ts`)に制御メッセージの全形がある。
本レポートの形は、この型定義と実出力の両方で確認した。

### 0.3 本 PoC の引数と環境変数

```
claude.exe --output-format stream-json --verbose --input-format stream-json
  --permission-prompt-tool stdio --replay-user-messages --include-partial-messages
  [--resume=<ID>] [--permission-mode <mode>] [--name <name>] [--model <model>]
```

- `--print` は不要(付けても動作は同じだった。§1)
- `--verbose` は必須(無いと exit 1。#345 で確認済み)
- `--permission-prompt-tool` は 2.1.150 の `--help` に**載っていない**が受け付ける(hidden)。2.1.280 では載っている
- `--await-initialize` は両版とも `--help` に無い(hidden)。Desktop は付けているが、本 PoC では付けなくても動いた
- 環境変数: 親(Desktop / Claude Code)由来の `CLAUDE*` をすべて外して起動した(`CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_SESSION_ID`、`CLAUDE_PID` など 24 個)。app は通常の Windows プロセスなので本来これらは無い

`--permission-mode` の選択肢が版で違う。
150: `acceptEdits, auto, bypassPermissions, default, dontAsk, plan`。
280: `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`(`default` が `manual` に改名。280 に `default` を渡しても system/init は `permissionMode: "default"` を返した)。

### 0.4 `initialize` は必須ではない

SDK と Desktop は最初に `{"type":"control_request","request_id":"…","request":{"subtype":"initialize"}}` を送る。
これを送らずにいきなり user メッセージを送っても、全シナリオが動いた(§1 の `--no-init` 実行)。
送ると、応答にアカウント・モデル一覧・コマンド一覧・`pid` が返る(§6.6)。

## 1. 複数回の往復

**できる。1回目の応答後もプロセスは終了しない。**

| 版 | 送信 1 → result | 生存確認 | 送信 2(前の答えを問う)→ result |
|---|---|---|---|
| 150 | `PING`(3.1 s) | 2 秒後も生存 | `PING`(文脈あり) |
| 150 `--print` あり・`initialize` 無し | `PING` | 生存 | `PING` |
| 280 | 同様(§2 の perm-allow など、全シナリオで 2 往復以上) | 生存 | 文脈あり |

プロセスは **stdin を閉じると約 1 秒で終了**する(exit code 0)。
それまでは何往復でも受け付ける。

送る形(1 行 1 JSON):

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]},"parent_tool_use_id":null}
```

`--replay-user-messages` を付けると、送った user メッセージが `uuid` 付きで stdout に返る(§5)。
これで「送信した行が会話ファイルのどの行になったか」が分かる。

## 2. 権限の問い合わせと応答

**できる。** `--permission-prompt-tool stdio` で、ツール使用の可否が stdout に `control_request`(`subtype: "can_use_tool"`)として届き、stdin から `control_response` で答えると続行する。

### 2.1 形(実出力。パスは `<WS>` に置換)

問い合わせ(Write、150):

```json
{"type":"control_request","request_id":"cedecce2-756e-4285-83ba-8ead60caca45",
 "request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write",
   "description":"poc382.txt","tool_use_id":"toolu_01QXhxXyoqdjxKT55KGzMftg",
   "input":{"content":"hello","file_path":"<WS>\\poc382.txt"},
   "permission_suggestions":[{"destination":"session","mode":"acceptEdits","type":"setMode"}]}}
```

問い合わせ(Bash `mkdir`、150)には `blocked_path` と、設定に追加するルールの提案が付く:

```json
"request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash",
  "description":"Create poc382-dir directory","blocked_path":"<WS>\\poc382-dir",
  "input":{"command":"mkdir poc382-dir","description":"Create poc382-dir directory"},
  "permission_suggestions":[
    {"type":"addRules","behavior":"allow","destination":"localSettings","rules":[{"toolName":"Bash","ruleContent":"mkdir poc382-dir *"}]},
    {"type":"addDirectories","destination":"session","directories":["<WS>"]},
    {"type":"setMode","destination":"session","mode":"acceptEdits"}],
  "tool_use_id":"toolu_01LUUAuR42gMvU9ccfkbTLzW"}
```

許可(`updatedInput` に入力をそのまま、または書き換えて返す):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"<request_id>",
 "response":{"behavior":"allow","updatedInput":{…input と同じ…}}}}
```

拒否(`message` がそのままモデルへの tool_result になる):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"<request_id>",
 "response":{"behavior":"deny","message":"PoC #382: ユーザーが拒否しました(検証用)"}}}
```

応答を書くと、CLI は同じ `control_response` を stdout に**エコー**してから、`user`(tool_result)→ 続きの `assistant` → `result` と進む。
拒否したときは tool_result の中身が `message` の文字列になり、モデルは「FAILED」と答えて止まった(150/280 とも)。

`permission_suggestions` の形は SDK の `PermissionUpdate` 型そのもので、許可応答の `updatedPermissions` に入れ返すと「今後も許可」になる(型定義上。本 PoC では未実施)。

### 2.2 `--permission-mode` 別の挙動

| モード | Write | Bash `echo …` | Bash `mkdir …` | 備考 |
|---|---|---|---|---|
| `default`(150) / `manual`(280) | **問い合わせ**(150/280) | 問い合わせ無しで実行(150/280) | **問い合わせ**(150) | `echo` は CLI 組み込みの安全コマンド扱いとみられる(ユーザー設定 `permissions` は空、`~/.claude.json` にも許可無し) |
| `acceptEdits` | 問い合わせ無し | — | — | |
| `plan`(`set_permission_mode` で切替) | — | 実行されない。モデルが `AskUserQuestion` → `ExitPlanMode` を呼び、それぞれ `can_use_tool` で届く | — | §2.4 |
| `dontAsk` | `system/permission_denied` メッセージ + tool_result に拒否文。モデルは説明して終了 | — | — | 問い合わせは来ない |
| `bypassPermissions` | 問い合わせ無し | — | — | `--allow-dangerously-skip-permissions` 無しでも通った |

`dontAsk` のときの通知:

```json
{"type":"system","subtype":"permission_denied","decision_reason_type":"mode",
 "message":"Permission to use Write has been denied because Claude Code is running in don't ask mode. …"}
```

### 2.3 `--permission-prompt-tool <MCPツール名>` との比較

| | stdio(本 PoC) | MCP ツール |
|---|---|---|
| 必要なもの | 標準入出力の JSON 行だけ | app が MCP サーバ(stdio か HTTP)を立て、`--mcp-config` で登録し、ツールを実装する |
| 応答の形 | `control_response`(§2.1) | MCP ツールの戻り値(`{"behavior":"allow"|"deny",…}` を JSON 文字列で返す。公式ドキュメントの方式) |
| 同時に使えるか | SDK は排他(どちらか一方) | |
| app への向き | **向いている**。CLI プロセスを持つ Rust 側がそのまま受けられる | 遠回り。プロセス管理と別経路になる |

280 には `--permission-prompts host|none` がある(`none` = 問い合わせが必要なものは全部自動拒否)。
150 には無い。

### 2.4 注意: `AskUserQuestion` / `ExitPlanMode` も `can_use_tool` で来る

plan モードで Bash を頼むと、モデルは `AskUserQuestion` を呼び、それが `can_use_tool`(`tool_name: "AskUserQuestion"`、`input.questions`)で届いた。
本 PoC の探査ツールは入力をそのまま `allow` で返したため、tool_result は「Your questions have been answered: .」(答えが空)となり、モデルは「回答が確認できなかった」として計画ファイルを書き `ExitPlanMode` に進んだ(これも `can_use_tool` で届き、`allow` で「User has approved your plan」になった)。
つまり app では、`AskUserQuestion` の `can_use_tool` は「許可/拒否」ではなく**ユーザーの選択を `updatedInput` に入れて返す**必要がある(Desktop の選択肢 UI に相当)。
Phase 1 の設計で扱う型の一つ。

## 3. 中断

**できる。プロセスは生きたまま、次の質問を送れる。**

### 3.1 生成中の中断(150/280)

「1 から 400 まで数える」を送り、`text_delta` を 5 回受けた時点で送信:

```json
{"type":"control_request","request_id":"int-1","request":{"subtype":"interrupt"}}
```

直後の出力(150。280 も同じ順序):

```
<< {"type":"control_response","response":{"subtype":"success","request_id":"int-1"}}
<< assistant  … text="1\n2\n…\n10"(そこまでの本文が確定した assistant メッセージ)
<< user       … text="[Request interrupted by user]"
<< result     subtype="error_during_execution" is_error=true terminal_reason="aborted_streaming"
              errors=["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null"]
```

280 では `control_response` に `"response":{"still_queued":[]}` が付く(キューに残った入力の ID 一覧。150 は無し)。
その 1 秒後に「AFTER と答えて」を送ると、通常どおり `AFTER` が返った。
中断は会話ファイルにも `[Request interrupted by user]` の user 行として残る(ターミナルの Esc と同じ)。

### 3.2 権限待ちの最中の中断(150)

`can_use_tool` に答えずに `interrupt` を送ると、CLI 側から **`control_cancel_request`** が来て、問い合わせが取り下げられる:

```
<< control_request  can_use_tool(Write)  request_id=1a7556d1-…
>> control_request  interrupt            request_id=int-1
<< {"type":"control_cancel_request","request_id":"1a7556d1-…"}
<< {"type":"control_response","response":{"subtype":"success","request_id":"int-1"}}
<< user   tool_result="The user doesn't want to proceed with this tool use. The tool use was rejected …"
<< user   text="[Request interrupted by user for tool use]"
<< result subtype="error_during_execution" is_error=true stop_reason="tool_use"
```

その後の送信も通常どおり通った。
app 側は「権限待ち」状態の UI を、`control_cancel_request` を受けたら閉じる必要がある。

シグナル(`kill`)は §4.3 のとおり台帳が残るので、中断には使わない。

## 4. 既存セッションの再開

**できる。** `--resume=<ID>` で開くと文脈を持っていて、会話ファイルは同じ jsonl に追記される。

| 実行 | 内容 | 結果 |
|---|---|---|
| 150 → 150 | §1 で作った会話を 150 で `--resume` し「この会話で前に何を頼んだ?」 | 「PING と答えるよう頼み、次に直前の一語を尋ねた」と正答 |
| 150 → 280 | 同じ会話を 280 で `--resume` | 文脈あり(直前の質問を言い当てた)。同じ jsonl に追記され、行の `version` は `2.1.150` と `2.1.280` が混在 |
| 存在しない ID | `--resume=00000000-…` | stderr に `No conversation found with session ID: …`、`result`(`error_during_execution`、`errors` に同文)を出して exit。stdin に書くと BrokenPipe |

### 4.1 会話ファイル(jsonl)の書かれ方

- 場所は従来どおり `~/.claude/projects/<cwd をエンコードした名前>/<sessionId>.jsonl`
- `user` / `assistant` 行の `entrypoint` は **`"sdk-cli"`**(ターミナル対話は `"cli"`、Desktop は `"claude-desktop"`)。`--print` を付けても `"sdk-cli"` だった
- 行の型は既存レポート(`claude-session-jsonl-format.md`)の範囲内。今回新たに見えたもの: `custom-title` と `agent-name`(`--name` を付けたとき。§6.1)、`model_changed`(`set_model` のとき。§6.2)
- `--resume` しても新しいファイルは作られない(ID は変わらない)。`--fork-session` のときだけ別 ID になる(#369 の調査と一致)
- `--replay-user-messages` で返る `user` の `uuid` が、そのまま jsonl の `uuid` になる

### 4.2 実行中台帳 `~/.claude/sessions/<PID>.json`

| 項目 | 150(sdk-cli) | 280(sdk-cli) | 280(Desktop 起動、参考) |
|---|---|---|---|
| `pid`, `sessionId`, `cwd`, `startedAt`(Unix ms), `version`, `peerProtocol`, `kind: "interactive"` | ○ | ○ | ○ |
| `entrypoint` | `"sdk-cli"` | `"sdk-cli"` | `"claude-desktop"` |
| `procStart` | **原則無し**(§4.4) | ○(FILETIME) | ○(FILETIME) |
| `peerFeatures`, `pidDomain`, `messagingSocketPath`, `status`(`idle`/`busy`), `statusUpdatedAt`, `updatedAt` | × | ○ | ○ |
| `name`, `nameSource`, `nameSince` | `--name` のときだけ `name` | ○(`nameSource: "derived"`、`ws-41` のような自動名。`--name` を付ければその名前) | ○(Desktop のタブ名) |
| `hostSessionId` | × | × | ○(`local_…`) |
| 書かれる時期 | 起動直後(`initialize` 応答時点)には無く、最初の `result` までに出来る | `initialize` 応答時点で既にある | — |
| 消える時期 | stdin を閉じて終了 → 消える | 同左 | — |

隣に `<PID>.<hash>.key`(113 バイト)も作られる(280。メッセージング用とみられる)。

### 4.3 `kill` したときは台帳が残る

`child.kill()`(TerminateProcess)で落とすと、両版とも台帳が残った。
ただし、その後に別の `claude` プロセスが起動したときに古い台帳は掃除されていた(`.key` は残った)。
app が異常終了して子が残る/子を強制終了する場合は、台帳が一時的に残ることを前提にする。

### 4.4 #361 のガードとの整合

app のガード(`running_session_source.rs`)は台帳の `sessionId` / `pid` / `procStart` / `startedAt` を見て、「PID が生きていて `procStart` が一致(判定不能なら生存のみ)」で実行中とする。

- app が起動した CLI は、この台帳を書くので**ガードからも「実行中」に見える**。親イシューの前提(「app 経由の送信はプロセスへ直接渡す。ガードは外部で実行中の検知に使う」)のとおり、app は自分が起動した PID を除外する必要がある
- 150 の台帳には `procStart` が原則無い。18 回の実行のうち 1 回だけ(`kill` シナリオ、応答から 4.7 秒後に読んだとき)`procStart: "639258694525387570"`(.NET ローカル tick)が付いていた。同じ版・同じ引数で有ったり無かったりしたので、「`--resume` で開き直したから無い」(#361 時点の理解)ではなく、**取得が非同期で間に合わないことがある**のが実態とみられる。ガードが `procStart` 無しでも PID 生存で判定する現状の作りは、この挙動に合っている
- 280 の `procStart` は FILETIME で、ガードの判定 1(完全一致)で通る形

## 5. 途中経過の形

`--include-partial-messages` を付けたときに 1 ターンで流れるメッセージ(150、テキストのみの応答):

| 順 | type / subtype | 内容 |
|---|---|---|
| 1 | `system` / `init` | セッション ID、モデル、`permissionMode`、cwd、ツール一覧、`claude_code_version` など。**ターンごとに毎回出る** |
| 2 | `system` / `status` | `status: "requesting"` |
| 3 | `stream_event` / `message_start` | `event.message.model`、usage |
| 4 | `stream_event` / `content_block_start` | `content_block.type`: `thinking` / `text` / `tool_use` |
| 5 | `stream_event` / `content_block_delta` | `delta.type`: `thinking_delta`(本文は空文字)/ `signature_delta` / `text_delta`(`delta.text`)/ `input_json_delta`(`delta.partial_json`) |
| 6 | `user`(replay) | 送った user メッセージが `uuid` 付きで返る(150 では `message_start` の直後、280 では `message_start` の直前) |
| 7 | `assistant` | ブロックが確定するたびに、そこまでの `message.content` を持つ完全なメッセージ。`uuid` = jsonl の行 |
| 8 | `stream_event` / `content_block_stop` | |
| 9 | `stream_event` / `message_delta` | `delta.stop_reason`: `end_turn` / `tool_use` |
| 10 | `stream_event` / `message_stop` | |
| 11 | `rate_limit_event`(150)| `rate_limit_info`(不定期) |
| 12 | `result` | `subtype: "success"`、`result`(最終テキスト)、`num_turns`、`duration_ms`、`total_cost_usd`、`usage`、`modelUsage`、`permission_denials`、`terminal_reason` |

ツールを使うターンでは、4〜10 が `tool_use` ブロックで一巡したあと、`control_request`(§2)→ `user`(tool_result、`parent_tool_use_id: null`)→ `system/status` → 再び 3〜10 → `result` と続く。
Bash 実行では `system/task_started` → `system/task_notification`(`task_type: "local_bash"`)が tool_result の直前に出る。

280 で増えるもの:

- `system/commands_changed`(コマンド一覧。1 通 20 KB。起動直後と最初のターンで 2 回)
- `system/thinking_tokens`(`estimated_tokens`、`estimated_tokens_delta`)
- `system/init` に `capabilities`、`messaging_socket_path`、`powershell_path`、`terminal_slash_commands`

量の目安(stdout の行数): テキスト応答のみの 2 往復で 20 行前後、Write の許可を挟む 1 往復で 69 行(そのうち `stream_event` が大半)。
1 行は `stream_event` で 200〜700 バイト、`system/init` と `commands_changed` が 10〜20 KB。

思考(`thinking`)の本文は、`thinking_delta` も確定 `assistant` も **空文字**で届いた(両版とも。`--thinking-display` 未指定)。
Desktop は `--thinking-display omitted` を付けている。

## 6. 付随

### 6.1 `--name`(表示名)

`--name poc382-name` を付けると:

- jsonl の先頭に `{"type":"custom-title","customTitle":"poc382-name","sessionId":"…"}` と `{"type":"agent-name","agentName":"poc382-name","sessionId":"…"}` が書かれる(ターン後にもう 1 組)
- 150 の台帳に `"name":"poc382-name"` が付く

app のビューアは `custom-title` 行を表示名に使っているので、そのまま反映される。

### 6.2 `--model` / `set_model`

途中でモデルを変えられる:

```
>> {"type":"control_request","request_id":"model-1","request":{"subtype":"set_model","model":"haiku"}}
<< {"type":"user","message":{"role":"user","content":"<local-command-stdout>Set model to haiku (claude-haiku-4-5-20251001)</local-command-stdout>"},…}
<< {"type":"control_response","response":{"subtype":"success","request_id":"model-1"}}
```

次のターンの `system/init` と `assistant.message.model` が `claude-haiku-4-5-20251001` になり、jsonl に `{"type":"model_changed","cache_missed_input_tokens":23610}` が書かれる。
`set_permission_mode` も同様に途中で変えられ、応答に `{"mode":"plan"}` が返る。

### 6.3 画像

#349 と同じ `content: [{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}},{"type":"text","text":"…"}]` を、起動したままのプロセスに送れた(16×16 の赤い PNG → 「Red」)。
その後のテキスト送信も通常どおり通り、jsonl の user 行に image ブロックが記録された。

### 6.4 標準エラー

正常系では **何も出ない**(全実行で 0 行)。
出たのは `--resume` の ID が無いときの 1 行だけ(§4)。
stderr は「起動失敗の理由」を拾う用途に限ってよい。

### 6.5 終了と後始末

- stdin を閉じる → 約 0.7〜1.0 秒で exit 0、台帳は消える
- `kill` → 台帳は残る(§4.3)
- 途中で親(app)が死んだ場合の子の挙動は未検証(stdin のパイプが閉じるので終了する見込みだが、確認していない)

### 6.6 `initialize` の応答

送ると `control_response` に次が返る(150 / 280):

- `account`(`apiProvider`、`email`、`organization`、`subscriptionType`。**メールアドレスを含む**ので画面や記録に出すとき注意)
- `models`(150: 4 件、280: 5 件。`value` / `displayName` / `description` / `supportedEffortLevels` など。モデル選択 UI の材料)
- `commands`(スラッシュコマンド一覧。150: 24、280: 51)
- `agents`、`available_output_styles`、`output_style`、`pid`
- 280 のみ: `session_state`(`"idle"`)、`current_permission_mode`、`fast_mode_state` ほか。封筒に `pending_permission_requests` / `pending_user_dialog_requests`(接続し直したときに、答え待ちの問い合わせを知るためのもの)

### 6.7 実行時間の観察

Bash の tool_result が返るまで、150 で 12〜16 秒、280 で 7 秒かかった(`echo` / `mkdir` とも)。
モデルの応答待ちではなく CLI 側の処理(シェル起動か安全判定)とみられる。
原因は未調査。

## 7. Phase 1 の設計に渡す材料

### 7.1 プロセスの状態

| 状態 | 入口 | 出口 |
|---|---|---|
| 起動中 | spawn | `initialize` の `control_response`(送る場合)、または最初の `system/init` |
| 待機 | `result` 受信 | user メッセージ送信 |
| 実行中 | user メッセージ送信 | `result` |
| 権限待ち | `control_request`(`can_use_tool`) | `control_response` を書く、または `control_cancel_request` を受ける(中断時) |
| 終了 | stdin を閉じる / 異常終了 | プロセス終了、台帳消滅(kill では残る) |

### 7.2 app が読む型(最小)

- 入力: `user`(text / image)、`control_request`(`initialize` / `interrupt` / `set_model` / `set_permission_mode`)、`control_response`(`allow` / `deny`)
- 出力: `system/init`、`system/status`、`stream_event`(`content_block_delta` の `text_delta` / `input_json_delta` があれば逐次表示は足りる)、`assistant`、`user`(replay と tool_result)、`control_request`(`can_use_tool`)、`control_cancel_request`、`control_response`、`result`
- 読み飛ばしてよいもの: `rate_limit_event`、`system/hook_*`、`system/commands_changed`、`system/thinking_tokens`、`system/task_*`(表示するなら別途)

未知の `type` / `subtype` は捨てる作りにしておく(版で増える)。

### 7.3 `--replay-user-messages` を付ける

送った行の `uuid` が返るので、画面上の「送信中」の行と jsonl の行を結び付けられる。
#352 で残った「送信に失敗したメッセージが会話に残る件」は、この方式なら `result` が `is_error` のときに対応する `uuid` を消せる。

### 7.4 権限応答の UI

`can_use_tool` の `tool_name` / `display_name` / `description` / `input` / `permission_suggestions` を表示し、「許可」「拒否」「今後も許可(`updatedPermissions`)」を返す。
`AskUserQuestion` は選択肢の UI(§2.4)。
`ExitPlanMode` は計画の承認 UI。

## 8. 可否判断

| 方式 | 判断 | 根拠 |
|---|---|---|
| **Rust から直接**(`std::process` + JSON 行) | **採用** | §1〜§6 の全項目が両版で動いた。Desktop 自身と Agent SDK が同じプロトコルを使っており、app が独自の経路を作るわけではない。追加の依存無し。native.md の「CLI プロセスの管理・状態・永続化は Rust」にそのまま合う |
| Agent SDK(TypeScript)サイドカー | 不採用 | 得られるのは同じメッセージの型付きラッパーだけ。Node ランタイムの同梱と IPC の二重化が増え、native.md の例外扱いになる |

リスク:

- 制御メッセージは公式ドキュメントに無い(SDK の型定義と実出力が根拠)。版が上がると項目が増える(280 で実際に増えていた)が、封筒(`control_request` / `control_response` / `request_id` / `subtype`)は安定している。app 側は未知の項目を無視する
- `procStart` の欠落など、台帳の書き方は版で揺れる(§4.4)。ガードは現状の作り(PID 生存優先)でよい
- 実行中の CLI を 1 セッション 1 プロセスで持つと、Desktop の 15 セッション相当で 15 プロセス。1 プロセスの常駐メモリは未計測(Phase 2 の課題)

## 付録 A. 探査ツール `cli-probe`

Rust の使い捨て CLI(約 430 行)。
`cli-probe <claude.exe> <cwd> <scenario> [--resume ID] [--permission-mode M] [--print] [--no-init] [--name N] [--model M] [--log FILE]`。

- 子プロセスを `Stdio::piped()` で spawn し、stdout / stderr を読むスレッド 2 本と、シナリオを進めるメインスレッドで構成
- シナリオ: `roundtrip` / `perm-allow` / `perm-deny` / `perm-write` / `perm-write-deny` / `perm-interrupt` / `interrupt` / `resume` / `image` / `set-model` / `set-mode` / `kill` / `prompt`(`POC_PROMPT` 環境変数の本文)
- `can_use_tool` は `allow`(入力をそのまま `updatedInput` に)か `deny` で即答
- 台帳 `~/.claude/sessions/<PID>.json` を要所で読んで表示

ソースは `reports/tools/cli-probe/` に置く(Cargo workspace には入れない単独の crate。使い方は同フォルダの README。Issue #384 / PR #385 で配置)。

## 付録 B. 実行一覧

| ログ | 版 | シナリオ | 結果 |
|---|---|---|---|
| 150-roundtrip | 150 | 2 往復 | ○ |
| 150-roundtrip-noinit-print | 150 | `--print` あり・`initialize` 無し | ○ |
| 150-perm-allow / 150-perm-deny | 150 | Bash `echo`(問い合わせ来ず) | 実行された |
| 150-perm-write / 280-… | 150 / 280 | Write 許可 | ○ |
| 150-perm-write-deny / 280-perm-write-deny | 150 / 280 | Write 拒否 | ○(FAILED) |
| 150-prompt-mkdir | 150 | Bash `mkdir` 許可 | ○(`blocked_path` 付き) |
| 150-perm-write-acceptEdits / -dontAsk / -bypass | 150 | モード別 | §2.2 |
| 150-set-mode-plan | 150 | `set_permission_mode(plan)` → Bash | §2.4 |
| 150-perm-interrupt | 150 | 権限待ち中に interrupt | ○(`control_cancel_request`) |
| 150-interrupt / 280-interrupt | 150 / 280 | 生成中に interrupt → 次の送信 | ○ |
| 150-resume / 280-resume | 150 / 280 | 150 で作った会話を再開 | ○(文脈あり) |
| 150-resume-bogus | 150 | 無い ID | stderr 1 行 + result error |
| 150-image | 150 | 画像 + 文 → 次の送信 | ○ |
| 150-set-model | 150 | `--name` + `set_model(haiku)` | ○ |
| 150-kill / 280-kill | 150 / 280 | 応答後に kill | 台帳が残る |
| 280-perm-allow | 280 | Bash `echo` | 実行された(問い合わせ来ず) |
