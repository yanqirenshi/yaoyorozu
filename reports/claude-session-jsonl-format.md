# Claude Code セッションログ(`.jsonl`)のフォーマット調査

- 作成日: 2026-08-16
- 担当セッション: Labo
- 調査対象: このPCの `~/.claude/projects/` 配下の全 `.jsonl`(146ファイル、60,941行、パース失敗0)
- 記録されていた Claude Code のバージョン: 2.1.150 〜 2.1.222(CLI版・Desktop版が混在)

> **注意**: 本書の内容は**実ファイルからの実測**であり、公式に文書化されたスキーマではない。
> バージョンによって `type` やフィールドは増減しうるため、読み取り側(apps/native 等)は
> **未知の `type` / フィールドを読み飛ばす**前提で実装すること。

## 1. 保存場所とファイル構成

```
~/.claude/projects/
└── <作業ディレクトリのパスをエンコードしたフォルダ名>/
    ├── <セッションID>.jsonl            ← 1会話 = 1ファイル
    ├── <セッションID>/                 ← セッションIDと同名のフォルダ(存在しない場合もある)
    │   ├── subagents/
    │   │   ├── agent-<エージェントID>.jsonl       ← サブエージェントの会話(isSidechain: true)
    │   │   └── agent-<エージェントID>.meta.json   ← 種別・名前などのメタ情報
    │   └── tool-results/
    │       └── <ID>.txt                ← 巨大なツール実行結果の退避先
    └── memory/                         ← 自動メモリ(MEMORY.md など)
```

- **フォルダ名のエンコード規則**: 絶対パスの英数字以外を**1文字ずつ** `-` に置換する。
  例: `C:\Users\yanqi\prj\yaoyorozu` → `C--Users-yanqi-prj-yaoyorozu`
  (apps/native の `encode_project_dir_name` はこの規則を再実装したもの)
- **セッションID** は UUID v4。会話開始時に発行され、そのままファイル名になる。
- サブエージェントの会話は親の `.jsonl` には混ざらず、`<セッションID>/subagents/` に分離される(§7)。

## 2. JSONL の基本構造

### 2.1 追記専用のイベントログ

1行 = 1つの JSON オブジェクト。会話の進行に伴い末尾に追記され、既存行は書き換えられない。
「タイトル変更」のような状態更新も**新しい行の追記**で表現され、同じ `type` の最後の行が有効値となる
(1セッションに `custom-title` 行が12行あった例がある)。

### 2.2 会話チェーン(uuid / parentUuid)

`user` / `assistant` / `system` / `attachment` の各行は `uuid` を持ち、`parentUuid` で直前の行を指す。
つまり会話は配列ではなく**親子チェーン(リンクリスト)**として記録される。
先頭行は `parentUuid: null`。`--fork-session` や `/compact` による分岐・圧縮もこの構造の上で表現される。

```
user(uuid=A, parent=null)
 └ assistant(uuid=B, parent=A)      ← thinking
    └ assistant(uuid=C, parent=B)   ← tool_use
       └ user(uuid=D, parent=C)     ← tool_result
          └ assistant(uuid=E, parent=D)  ← text
```

### 2.3 会話チェーン行に共通するフィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | string | 行の種類(§3) |
| `uuid` | string | この行のID |
| `parentUuid` | string \| null | 直前の行のID。先頭行は `null` |
| `isSidechain` | boolean | サブエージェントの会話なら `true` |
| `sessionId` | string | 所属セッションのID(**全行に毎回**記録される) |
| `timestamp` | string | ISO 8601(UTC) |
| `cwd` | string | その時点の作業ディレクトリ |
| `entrypoint` | string | どの入り口で生成されたか(`claude-desktop` / `sdk-cli` 等)。環境変数 `CLAUDE_CODE_ENTRYPOINT` 由来 |
| `version` | string | 記録時の Claude Code バージョン |
| `gitBranch` | string | その時点の git ブランチ(`HEAD` はデタッチ状態) |
| `userType` | string | 全件 `external` |
| `promptId` | string | (user のみ)入力1回ごとのID |
| `slug` | string | (任意)セッションの人間可読な別名 |
| `agentId` | string | (サブエージェントのみ)エージェントID |

`sessionId` / `cwd` / `entrypoint` は**行単位**のメタデータであり、1ファイル内で行ごとに値が異なりうる
(Desktop で作った会話に CLI の `--continue` で追記すると、追記行だけ `entrypoint` が `sdk-cli` になる)。

### 2.4 `"type"` キーは4階層に登場する

`grep '"type":"…"'` で拾うと全階層が混ざるため注意。

| 階層 | 場所 | 種類数 | 例 |
|---|---|---|---|
| 行 | 最上位の `type` | 11 | `user` / `assistant` / `attachment` / `system` … |
| 付帯情報 | `attachment.type` | 23 | `deferred_tools_delta` / `task_reminder` … |
| APIメッセージ | `message.type` | 1 | `message`(Anthropic API の型表記) |
| コンテンツブロック | `message.content[].type` | 5 | `text` / `thinking` / `tool_use` / `tool_result` / `image` |

## 3. 行 `type` の一覧(実測)

| type | 行数 | 出現ファイル | グループ | 型定義(§5) | 概要 |
|---|---|---|---|---|---|
| `assistant` | 29,291 | 146/146 | 会話本体 | `AssistantLine` | AIの応答(text / thinking / tool_use) |
| `user` | 17,739 | 146/146 | 会話本体 | `UserLine` | ユーザー入力 **およびツール実行結果** |
| `attachment` | 2,884 | 82/146 | 内部イベント | `AttachmentLine` | 実行環境が会話に注入した付帯情報 |
| `custom-title` | 2,627 | 37/146 | セッションメタ | `CustomTitleLine` | 会話タイトル |
| `last-prompt` | 2,591 | 49/146 | セッションメタ | `LastPromptLine` | 直近の入力と末尾ノード |
| `queue-operation` | 2,218 | 49/146 | セッションメタ | `QueueOperationLine` | 入力キューへの投入記録 |
| `mode` | 2,154 | 33/146 | セッションメタ | `ModeLine` | セッションのモード(全件 `normal`) |
| `system` | 985 | 36/146 | 内部イベント | `SystemLine`(4種の合併型) | フック結果・APIエラー・圧縮境界など |
| `pr-link` | 373 | 5/146 | セッションメタ | `PrLinkLine` | 紐づく GitHub PR |
| `ai-title` | 48 | 1/146 | セッションメタ | `AiTitleLine` | AI生成タイトル |
| `atis-latch` | 31 | 5/146 | セッションメタ | `AtisLatchLine` | 用途不明(値は全件空文字列) |

- **会話本体**: `uuid`/`parentUuid` チェーンを構成し、人間に見せる内容を含む
- **セッションメタ**: `parentUuid` を持たず `sessionId` のみで紐づく「セッションへの付箋」
- **内部イベント**: チェーンにはぶら下がるが、人間向けの本文ではない

## 4. 各 `type` の詳細

### 4.1 `user` — ユーザー入力 / ツール実行結果

`message.content` が**文字列**なら人間の入力、**配列**ならツール実行結果(`tool_result`)や画像添付。
実測では `user` 行の約9割が `tool_result` であり、人間の発言は1割弱。

**(a) 人間の入力(content が文字列)**

```json
{
  "type": "user",
  "uuid": "af827fb6-0348-489b-b7d6-d255efd4832c",
  "parentUuid": null,
  "isSidechain": false,
  "promptId": "7da187a3-b077-4507-933a-bf5bd2bef944",
  "message": {
    "role": "user",
    "content": "合言葉は『青りんご』です。『覚えました』とだけ答えてください。"
  },
  "timestamp": "2026-08-16T07:04:52.062Z",
  "permissionMode": "default",
  "userType": "external",
  "entrypoint": "claude-desktop",
  "cwd": "C:\\Users\\yanqi\\AppData\\Local\\Temp\\claude\\…\\scratchpad",
  "sessionId": "81a2a94e-1ab6-4840-aac1-ea306c64e2f5",
  "version": "2.1.150",
  "gitBranch": "HEAD"
}
```

| フィールド | 説明 |
|---|---|
| `message.role` | 常に `user` |
| `message.content` | 入力テキスト(文字列) |
| `permissionMode` | 入力時の権限モード(`default` / `plan` / `acceptEdits` 等) |
| `promptId` | 入力1回に対するID。同じ入力から派生する行で共有される |

**(b) ツール実行結果(content が配列)**

```json
{
  "type": "user",
  "uuid": "e5152778-1620-409d-b3e0-7e4a2a32dee5",
  "parentUuid": "74a271be-8577-4bf5-8269-1a5953749e59",
  "isSidechain": false,
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01MhRUXWDSAK58oHr5GfxiV1",
        "content": "1\thello world\n2\t"
      }
    ]
  },
  "toolUseResult": {
    "type": "text",
    "file": {
      "filePath": "C:\\Users\\yanqi\\AppData\\Local\\Temp\\claude-mode-test\\sample.txt",
      "content": "hello world\n",
      "numLines": 2,
      "startLine": 1,
      "totalLines": 2
    }
  },
  "sourceToolAssistantUUID": "74a271be-8577-4bf5-8269-1a5953749e59",
  "timestamp": "2026-08-15T04:56:55.068Z",
  "sessionId": "56b61954-0e88-44f2-9497-576fdd75d61a",
  "version": "2.1.150"
}
```

| フィールド | 説明 |
|---|---|
| `message.content[].type` | `tool_result`(または `image` / `text`) |
| `message.content[].tool_use_id` | 対応する `assistant` 行の `tool_use.id` |
| `message.content[].content` | モデルに渡された結果テキスト |
| `toolUseResult` | ツール固有の構造化結果(Read ならファイル情報、Bash なら stdout/stderr 等)。UI表示用 |
| `sourceToolAssistantUUID` | `tool_use` を発行した `assistant` 行の `uuid` |

Anthropic API の仕様上、ツール結果は「user ロール」のメッセージとして送られるため、ログ上も `user` 行になる。
**「`type == "user"` = 人間の発言」ではない**点に注意。

### 4.2 `assistant` — AIの応答

`message` は Anthropic Messages API のレスポンス形式そのもの。
1回のAPI応答が複数のブロック(`thinking` → `tool_use` 等)を含む場合、**ブロックごとに別行**として記録され、同じ `message.id` を共有する。

```json
{
  "type": "assistant",
  "uuid": "d3925ab5-d7a6-4c4b-8330-28e39959ebf8",
  "parentUuid": "af827fb6-0348-489b-b7d6-d255efd4832c",
  "isSidechain": false,
  "requestId": "req_011Ce6158sYpdJMjP44XvUab",
  "message": {
    "id": "msg_011Ce6159ns8CGgLSk15Buvz",
    "type": "message",
    "role": "assistant",
    "model": "claude-opus-4-7",
    "content": [
      { "type": "text", "text": "覚えました" }
    ],
    "stop_reason": "end_turn",
    "stop_sequence": null,
    "usage": {
      "input_tokens": 6,
      "cache_creation_input_tokens": 5471,
      "cache_read_input_tokens": 3057,
      "output_tokens": 9,
      "service_tier": "standard",
      "cache_creation": { "ephemeral_1h_input_tokens": 5471, "ephemeral_5m_input_tokens": 0 }
    }
  },
  "timestamp": "2026-08-16T07:04:53.486Z",
  "sessionId": "81a2a94e-1ab6-4840-aac1-ea306c64e2f5",
  "version": "2.1.150"
}
```

| フィールド | 説明 |
|---|---|
| `message.id` | API のメッセージID。同一応答の複数行で共有 |
| `message.model` | 実際に応答したモデルID |
| `message.content[]` | ブロック配列(§6)。実測では1行に1ブロックが基本 |
| `message.stop_reason` | `end_turn`(完了)/ `tool_use`(ツール呼び出しで中断)等 |
| `message.usage` | トークン使用量。キャッシュ作成/読取の内訳を含む |
| `requestId` | API リクエストID |

**content ブロックの例**

```json
// thinking(思考。本文は空で署名のみの場合もある)
{ "type": "thinking", "thinking": "…", "signature": "Er8FCokBCBAYAipAof8p…" }

// tool_use(ツール呼び出し)
{
  "type": "tool_use",
  "id": "toolu_01MhRUXWDSAK58oHr5GfxiV1",
  "name": "Read",
  "input": { "file_path": "C:\\Users\\yanqi\\AppData\\Local\\Temp\\claude-mode-test\\sample.txt" },
  "caller": { "type": "direct" }
}
```

### 4.3 `queue-operation` — 入力キューへの投入

ユーザーが入力を送信した瞬間の記録。`user` 行より先に書かれる。

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "2026-08-16T07:05:20.506Z",
  "sessionId": "81a2a94e-1ab6-4840-aac1-ea306c64e2f5",
  "content": "合言葉を逆から言ってください。"
}
```

| フィールド | 説明 |
|---|---|
| `operation` | 実測では `enqueue` のみ |
| `content` | 入力テキスト |

### 4.4 `last-prompt` — 直近の入力と末尾ノード

`/resume` の一覧表示などで「最後に何を頼んだか」を素早く出すためのキャッシュと思われる。

```json
{
  "type": "last-prompt",
  "lastPrompt": "合言葉は『青りんご』です。『覚えました』とだけ答えてください。",
  "leafUuid": "c26b91f6-d1fe-4630-b9fe-b1e703cf9255",
  "sessionId": "81a2a94e-1ab6-4840-aac1-ea306c64e2f5"
}
```

| フィールド | 説明 |
|---|---|
| `lastPrompt` | 直近のユーザー入力 |
| `leafUuid` | その時点での会話チェーン末尾の `uuid` |

### 4.5 `custom-title` / `ai-title` — 会話タイトル

```json
{ "type": "custom-title", "customTitle": "Windows 11 画面の明るさ自動変化", "sessionId": "396a54d0-…" }
{ "type": "ai-title",     "aiTitle": "Create new GitHub repository skk.sitter", "sessionId": "3a38b136-…" }
```

- `custom-title`: UI の会話一覧に表示されるタイトル。更新のたびに追記されるので最後の行が有効
- `ai-title`: AI が自動生成したタイトル。`custom-title` とは別枠(1ファイルのみで観測)

### 4.6 `mode` — セッションのモード

```json
{ "type": "mode", "mode": "normal", "sessionId": "396a54d0-…" }
```

実測では全2,154行が `normal`。他の値(例: リモート制御やバックグラウンド)が入る可能性はあるが未観測。

### 4.7 `pr-link` — 紐づく GitHub PR

セッションから PR を作成した、または `--from-pr` で PR に紐づけたときに記録される。

```json
{
  "type": "pr-link",
  "sessionId": "6f8b7c1c-e7b3-4785-97c3-698816583b57",
  "prNumber": 58,
  "prUrl": "https://github.com/yanqirenshi/Spinor/pull/58",
  "prRepository": "yanqirenshi/Spinor",
  "timestamp": "2026-05-16T00:26:56.134Z"
}
```

### 4.8 `atis-latch` — 用途不明

```json
{ "type": "atis-latch", "atis": "", "sessionId": "0582f09a-…" }
```

31行すべて `atis` が空文字列。内部フラグと推測されるが意味は不明。読み飛ばしてよい。

### 4.9 `system` — 内部イベント(subtype で分岐)

会話チェーンにぶら下がるが本文ではない。`subtype` と `level`(`info` / `warning` / `error` / `suggestion`)を持つ。

| subtype | 行数 | 意味 |
|---|---|---|
| `stop_hook_summary` | 841 | ターン終了時に実行されたフックの結果 |
| `api_error` | 129 | API 呼び出しの失敗とリトライ |
| `compact_boundary` | 14 | `/compact` による履歴圧縮の境界 |
| `informational` | 1 | 情報通知(スキル引数の警告など) |

**`stop_hook_summary`**

```json
{
  "type": "system",
  "subtype": "stop_hook_summary",
  "level": "suggestion",
  "hookCount": 3,
  "hookInfos": [
    { "command": "\"C:/Users/yanqi/AppData/Local/GitKrakenCLI/gk.exe\" ai hook run --host claude-code", "durationMs": 246 },
    { "command": "callback" },
    { "command": "callback" }
  ],
  "hookErrors": [],
  "hookAdditionalContext": [],
  "preventedContinuation": false,
  "stopReason": "",
  "hasOutput": false,
  "timestamp": "2026-07-19T10:57:20.620Z",
  "uuid": "75c2eff8-…", "parentUuid": "83c7749d-…", "sessionId": "396a54d0-…"
}
```

**`api_error`**

```json
{
  "type": "system",
  "subtype": "api_error",
  "level": "error",
  "error": {
    "message": "Connection error.",
    "formatted": "Unable to connect to API (ENOTFOUND)",
    "connection": { "code": "ENOTFOUND", "message": "getaddrinfo ENOTFOUND api.anthropic.com", "isSSLError": false },
    "isNetworkDown": true,
    "rateLimits": null
  },
  "retryInMs": 611.8,
  "retryAttempt": 1,
  "maxRetries": 10,
  "source": "request_retry",
  "timestamp": "2026-07-24T22:36:05.473Z",
  "uuid": "78195e58-…", "parentUuid": "75abac40-…", "sessionId": "84d4d96e-…"
}
```

**`compact_boundary`**

圧縮後の新しいチェーンの起点となる行。`parentUuid` は `null` に戻り、代わりに `logicalParentUuid` で圧縮前の末尾を指す。

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "level": "info",
  "content": "Conversation compacted",
  "parentUuid": null,
  "logicalParentUuid": "505488ce-7d83-4816-9f01-b66186b5f468",
  "compactMetadata": {
    "trigger": "manual",
    "preTokens": 613979,
    "postTokens": 9212,
    "durationMs": 103219,
    "preservedSegment": { "headUuid": "…", "anchorUuid": "…", "tailUuid": "…" },
    "preservedMessages": { "anchorUuid": "…", "uuids": ["…"], "allUuids": ["…"] }
  },
  "timestamp": "2026-06-22T22:25:41.718Z",
  "uuid": "681bff46-…", "sessionId": "a7ecede2-…"
}
```

| フィールド | 説明 |
|---|---|
| `compactMetadata.trigger` | `manual`(`/compact`)か自動か |
| `preTokens` / `postTokens` | 圧縮前後のトークン数 |
| `preservedMessages` | 圧縮後も原文のまま残された行の `uuid` 群 |

**`informational`**

```json
{
  "type": "system",
  "subtype": "informational",
  "level": "warning",
  "content": "Args from unknown skill: …",
  "timestamp": "2026-05-09T23:32:59.039Z",
  "uuid": "3b0ea47c-…", "parentUuid": "338b925a-…", "sessionId": "a869f88f-…"
}
```

### 4.10 `attachment` — 実行環境が注入した付帯情報

Claude Code の実行環境(ハーネス)が、会話のコンテキストとしてモデルに渡した情報の記録。
本体は `attachment` オブジェクトで、`attachment.type` で23種に分かれる。

```json
{
  "type": "attachment",
  "uuid": "eac06b8c-bfb8-4baa-8b9f-1318e3f2b30b",
  "parentUuid": "4c1727c4-87df-490c-81d8-bf60da0f74fa",
  "isSidechain": false,
  "attachment": {
    "type": "deferred_tools_delta",
    "addedNames": ["CronCreate", "CronDelete", "CronList", "EnterPlanMode", "…"],
    "addedLines": ["…"],
    "removedNames": [],
    "readdedNames": [],
    "pendingMcpServers": ["claude.ai Figma"]
  },
  "timestamp": "2026-08-15T04:56:47.117Z",
  "sessionId": "56b61954-…",
  "version": "2.1.150"
}
```

**`attachment.type` の一覧(実測23種、意味は推定)**

| 分類 | attachment.type | 行数 | 意味 |
|---|---|---|---|
| 実行環境の変化 | `deferred_tools_delta` | 160 | 遅延ロード対象ツールの追加・削除 |
| | `mcp_instructions_delta` | 96 | MCP サーバーの接続/切断による指示文の変化 |
| | `agent_listing_delta` | 51 | 利用可能なエージェント種別の変化 |
| | `skill_listing` | 113 | 利用可能なスキル一覧 |
| | `invoked_skills` | 3 | スキルが呼び出された |
| | `command_permissions` | 6 | コマンドの許可設定 |
| | `auto_mode` | 46 | 自動モードの状態 |
| | `date_change` | 12 | 日付が変わった |
| ファイル・コンテキスト | `edited_text_file` | 216 | Claude が読んだ後に外部で編集されたファイルの通知 |
| | `file` | 44 | ファイル内容の添付 |
| | `compact_file_reference` | 27 | 圧縮後に参照ファイルを再提示 |
| | `plan_file_reference` | 1 | プランファイルの参照 |
| | `nested_memory` | 15 | サブディレクトリの CLAUDE.md 等の読み込み |
| リマインダー | `task_reminder` | 1,445 | タスク一覧の状態(最多) |
| | `todo_reminder` | 69 | TODO のリマインド |
| | `total_tokens_reminder` | 121 | 残りトークン量の通知 |
| | `batching_reminder_sent` | 12 | ツール呼び出しをまとめるよう促す通知 |
| 入力・フック・モード | `queued_command` | 164 | 応答中に投入された入力や通知がキューされた |
| | `hook_additional_context` | 270 | フックが返した追加コンテキスト |
| | `hook_cancelled` | 1 | フックの中断 |
| | `hook_non_blocking_error` | 1 | フックの非致命エラー |
| | `plan_mode` | 8 | プランモード開始 |
| | `plan_mode_exit` | 3 | プランモード終了 |

**代表的な attachment の例**

```json
// edited_text_file: 読み込み済みファイルが外部で変更された
{ "type": "edited_text_file",
  "filename": "C:\\Users\\yanqi\\.claude\\projects\\C--Users-yanqi-prj-AllBlacks\\memory\\MEMORY.md",
  "snippet": "1\t# Memory Index\n2\t\n3\t- [Stack: Tauri](stack-tauri.md) — …" }

// queued_command: 応答中にバックグラウンドタスクの通知が届いた
{ "type": "queued_command",
  "prompt": "<task-notification>\n<task-id>bhr14sqea</task-id>\n…",
  "commandMode": "task-notification",
  "timestamp": "2026-07-25T23:11:11.098Z" }

// hook_additional_context: PostToolUse フックが返した情報
{ "type": "hook_additional_context",
  "content": ["C:\\Users\\yanqi\\prj\\AllBlacks\\ui\\src\\index.html is now visible in the …"],
  "hookName": "PostToolUse:Edit",
  "toolUseID": "toolu_01E88qfrHYKdc5Asv6EYaYur",
  "hookEvent": "PostToolUse" }

// task_reminder: タスク一覧(空)のリマインド
{ "type": "task_reminder", "content": [], "itemCount": 0 }
```

## 5. `type` 毎の型定義(TypeScript)

実測データから起こした各行の型定義(クラス)。
公式スキーマではないため、**未知のフィールドを許容し、欠損時に落ちない**デシリアライズを前提とすること
(Rust なら `#[serde(default)]` + `deny_unknown_fields` を付けない、TypeScript なら実行時検証を緩くする)。

```ts
// ============ 共通 ============

/** 会話チェーンを構成する行(user / assistant / system / attachment)の共通フィールド */
interface ChainLineBase {
  uuid: string;
  parentUuid: string | null;   // 先頭行(チェーンの起点)は null
  isSidechain: boolean;        // サブエージェントの会話なら true
  sessionId: string;
  timestamp: string;           // ISO 8601(UTC)
  cwd: string;
  entrypoint: string;          // "claude-desktop" | "sdk-cli" など
  version: string;             // 記録時の Claude Code バージョン
  gitBranch: string;
  userType: "external";
  slug?: string;               // セッションの人間可読な別名(任意)
  agentId?: string;            // サブエージェント(subagents/ 配下)のみ
}

/** 全11種の行の合併型 */
type SessionLine =
  // 会話本体
  | UserLine
  | AssistantLine
  // 内部イベント
  | SystemLine
  | AttachmentLine
  // セッションメタ(parentUuid を持たない)
  | QueueOperationLine
  | LastPromptLine
  | CustomTitleLine
  | AiTitleLine
  | ModeLine
  | PrLinkLine
  | AtisLatchLine;

// ============ message.content のブロック(§6) ============

interface TextBlock {
  type: "text";
  text: string;                // 人間に見せる本文
}

interface ThinkingBlock {
  type: "thinking";
  thinking: string;            // 思考テキスト(空文字列の場合あり)
  signature: string;           // 改竄検証用の署名
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;                  // ツール呼び出しID(toolu_…)
  name: string;                // ツール名(Bash / Read / Edit …)
  input: Record<string, unknown>; // ツールごとの引数
  caller?: { type: string };   // "direct" 等
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;         // 対応する ToolUseBlock.id
  content: string | unknown[]; // モデルに渡された結果
  is_error?: boolean;
}

interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

// ============ 会話本体 ============

/** ユーザー入力(content が文字列)またはツール実行結果(content が配列) */
interface UserLine extends ChainLineBase {
  type: "user";
  message: {
    role: "user";
    content: string | Array<ToolResultBlock | TextBlock | ImageBlock>;
  };
  promptId?: string;               // 入力1回ごとのID
  permissionMode?: string;         // 入力時の権限モード("default" | "plan" | …)
  toolUseResult?: unknown;         // ツール固有の構造化結果(UI表示用。ツールごとに形が違う)
  sourceToolAssistantUUID?: string; // tool_use を発行した assistant 行の uuid
}

/** AIの応答。message は Anthropic Messages API のレスポンス形式 */
interface AssistantLine extends ChainLineBase {
  type: "assistant";
  requestId: string;               // API リクエストID(req_…)
  message: {
    id: string;                    // メッセージID(msg_…)。同一応答の複数行で共有
    type: "message";
    role: "assistant";
    model: string;                 // 実際に応答したモデルID
    content: Array<TextBlock | ThinkingBlock | ToolUseBlock>;
    stop_reason: "end_turn" | "tool_use" | null;
    stop_sequence: string | null;
    usage: Usage;
  };
}

/** トークン使用量 */
interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  service_tier?: string;
  cache_creation?: {
    ephemeral_1h_input_tokens: number;
    ephemeral_5m_input_tokens: number;
  };
}

// ============ 内部イベント ============

/** system 行は subtype で4種に分かれる */
type SystemLine =
  | StopHookSummaryLine
  | ApiErrorLine
  | CompactBoundaryLine
  | InformationalLine;

type SystemLevel = "info" | "warning" | "error" | "suggestion";

/** ターン終了時に実行されたフックの結果 */
interface StopHookSummaryLine extends ChainLineBase {
  type: "system";
  subtype: "stop_hook_summary";
  level: SystemLevel;
  hookCount: number;
  hookInfos: Array<{ command: string; durationMs?: number }>;
  hookErrors: unknown[];
  hookAdditionalContext: unknown[];
  preventedContinuation: boolean;  // フックがターン継続を止めたか
  stopReason: string;
  hasOutput: boolean;
  toolUseID?: string;
}

/** API 呼び出しの失敗とリトライ */
interface ApiErrorLine extends ChainLineBase {
  type: "system";
  subtype: "api_error";
  level: "error";
  error: {
    message: string;
    formatted: string;             // 表示用に整形されたメッセージ
    connection?: { code: string; message: string; isSSLError: boolean };
    isNetworkDown?: boolean;
    rateLimits?: unknown;
  };
  retryInMs: number;
  retryAttempt: number;
  maxRetries: number;
  source: string;                  // "request_retry" 等
}

/** /compact による履歴圧縮の境界。圧縮後チェーンの起点になる */
interface CompactBoundaryLine extends ChainLineBase {
  type: "system";
  subtype: "compact_boundary";
  level: "info";
  parentUuid: null;                // チェーンはここで切れる
  logicalParentUuid: string;       // 圧縮前チェーンの末尾 uuid
  content: string;                 // "Conversation compacted"
  isMeta: boolean;
  compactMetadata: {
    trigger: "manual" | string;    // 手動(/compact)か自動か
    preTokens: number;
    postTokens: number;
    durationMs: number;
    preservedSegment?: { headUuid: string; anchorUuid: string; tailUuid: string };
    preservedMessages?: { anchorUuid: string; uuids: string[]; allUuids: string[] };
    preCompactDiscoveredTools?: string[];
  };
}

/** 情報通知(スキル引数の警告など) */
interface InformationalLine extends ChainLineBase {
  type: "system";
  subtype: "informational";
  level: SystemLevel;
  content: string;
  isMeta: boolean;
}

/** 実行環境が会話に注入した付帯情報。attachment.type で23種に分かれる(§4.10) */
interface AttachmentLine extends ChainLineBase {
  type: "attachment";
  attachment: {
    type: string;                  // "deferred_tools_delta" | "task_reminder" | …
    [key: string]: unknown;        // 種類ごとに固有のフィールドを持つ
  };
}

// ============ セッションメタ(parentUuid を持たない) ============

/** 入力キューへの投入記録。user 行より先に書かれる */
interface QueueOperationLine {
  type: "queue-operation";
  operation: "enqueue";
  timestamp: string;
  sessionId: string;
  content: string;                 // 入力テキスト
}

/** 直近の入力と会話チェーン末尾のキャッシュ */
interface LastPromptLine {
  type: "last-prompt";
  lastPrompt: string;
  leafUuid: string;                // その時点のチェーン末尾の uuid
  sessionId: string;
}

/** 会話タイトル。追記式なので最後の行が有効 */
interface CustomTitleLine {
  type: "custom-title";
  customTitle: string;
  sessionId: string;
}

/** AI が自動生成したタイトル(custom-title とは別枠) */
interface AiTitleLine {
  type: "ai-title";
  aiTitle: string;
  sessionId: string;
}

/** セッションのモード(実測では "normal" のみ) */
interface ModeLine {
  type: "mode";
  mode: "normal" | string;
  sessionId: string;
}

/** セッションに紐づく GitHub PR */
interface PrLinkLine {
  type: "pr-link";
  sessionId: string;
  prNumber: number;
  prUrl: string;
  prRepository: string;            // "owner/repo"
  timestamp: string;
}

/** 用途不明の内部フラグ(実測では atis は全件空文字列) */
interface AtisLatchLine {
  type: "atis-latch";
  atis: string;
  sessionId: string;
}
```

## 6. `message.content` のブロック種別(実測)

| 行 type | ブロック種別 | 件数 | 説明 |
|---|---|---|---|
| `user` | (文字列) | 1,217 | 人間の入力 |
| `user` | `tool_result` | 16,321 | ツール実行結果 |
| `user` | `text` | 195 | 配列形式での入力テキスト(画像添付と併用時など) |
| `user` | `image` | 116 | 画像添付(base64) |
| `assistant` | `text` | 6,007 | 人間に見せる本文 |
| `assistant` | `thinking` | 6,973 | 思考(本文が空で署名のみの場合あり) |
| `assistant` | `tool_use` | 16,323 | ツール呼び出し |

人間に見せる「会話」を再構成するには、`user` の文字列 content と `assistant` の `text` ブロックだけを拾えばよい。

## 7. サブエージェントの記録

親セッションの `.jsonl` には `isSidechain: true` の行は**含まれない**(146ファイルで0件)。
代わりに `<セッションID>/subagents/agent-<ID>.jsonl` に独立したチェーンとして保存される。

**`agent-<ID>.jsonl` の先頭行**

```json
{
  "type": "user",
  "uuid": "3e62c627-fae6-4dce-8fe1-343d15944625",
  "parentUuid": null,
  "isSidechain": true,
  "agentId": "a096cdcb32e2ac995",
  "promptId": "48e43a56-3d68-4265-8d83-e8fe27335dc0",
  "message": { "role": "user", "content": "設計セッション成果物(スペック草案)への非相関レビュー…" },
  "sessionId": "84d4d96e-7acc-4f70-a113-0f406408fa27",
  "timestamp": "2026-07-19T09:51:46.082Z",
  "version": "2.1.209"
}
```

- `sessionId` は**親セッションのID**を引き継ぐ
- `agentId` でエージェントを識別。`parentUuid: null` から始まる独立チェーン
- 1行目の `content` が、親がエージェントに渡したプロンプト

**`agent-<ID>.meta.json`**

```json
{
  "agentType": "Explore",
  "description": "apps/web の構造調査",
  "name": "explore-web",
  "toolUseId": "toolu_01W2ZZZJ4NzdDVuvZxsvpPKd",
  "spawnDepth": 1
}
```

| フィールド | 説明 |
|---|---|
| `agentType` | エージェント種別(`Explore` / `general-purpose` / `claude-code-guide` 等) |
| `description` | 起動時に与えた短い説明 |
| `name` | 起動時に与えた名前 |
| `toolUseId` | 親セッション側の `Agent` ツール呼び出しの `tool_use.id` |
| `spawnDepth` | ネストの深さ(親直下なら1) |

## 8. apps/native への示唆

現行実装(`domain::extract_message`)は `user` / `assistant` の `text` だけを抽出しており、本調査の結果と整合している。
加えて以下の活用余地がある。

- **`custom-title` / `ai-title`**: 設定画面のセッション一覧は「先頭メッセージの60文字抜粋」だが、タイトル行があればそれを優先表示できる(最後の行を採用)
- **`pr-link`**: セッションと GitHub PR の紐づけがログに存在するため、GitHub 連携機能の材料になる
- **`system.subtype == "api_error"`**: 送信失敗の履歴を検出できる
- **`system.subtype == "compact_boundary"`**: 履歴圧縮の境界を表示に反映できる
- **`subagents/`**: エージェントの作業ログを表示したい場合はここを読む。現行の「ディレクトリ直下の `.jsonl` のみ走査」は、サブエージェントのログが混入しないという点で正しい
- **未知の `type` を読み飛ばす**現行方針は維持すること(バージョンで増減する)

## 付録: 集計に使ったスクリプト

```js
// ~/.claude/projects 配下の全 .jsonl を走査し、行 type / subtype / attachment.type / content ブロック種別を集計する
const fs = require("fs");
const path = require("path");
const root = path.join(process.env.USERPROFILE || process.env.HOME, ".claude", "projects");

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".jsonl")) files.push(p);
  }
})(root);

const count = (m, k) => (m[k] = (m[k] || 0) + 1);
const types = {}, subtypes = {}, attachments = {}, blocks = {};
for (const f of files) {
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    count(types, o.type);
    if (o.subtype) count(subtypes, `${o.type}/${o.subtype}`);
    if (o.type === "attachment" && o.attachment) count(attachments, o.attachment.type);
    const c = o.message && o.message.content;
    if (typeof c === "string") count(blocks, `${o.type}/(string)`);
    else if (Array.isArray(c)) for (const b of c) count(blocks, `${o.type}/${b.type}`);
  }
}
console.log({ files: files.length, types, subtypes, attachments, blocks });
```
