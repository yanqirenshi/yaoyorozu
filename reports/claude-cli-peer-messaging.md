# claude CLI 同士のセッション間メッセージ(PoC #429)

Issue: [#429](https://github.com/yanqirenshi/yaoyorozu/issues/429)(親: [#381](https://github.com/yanqirenshi/yaoyorozu/issues/381) Phase 3-0)。
実施: Lab (PM)、2026-09-25。
出発点: [claude-cli-stream-json-session.md](claude-cli-stream-json-session.md)(#382)と `reports/tools/cli-probe/`。

## 結論

**CLI 任せで足りる(app が仲介する仕組みは要らない)。ただし CLI は 2.1.280 系が必要**。

#382 と同じ方式(stream-json、`--name` 付き)で app が起動した `claude` 同士で、`ListAgents` に相手が現れ、`SendMessage` が相手に user ターンとして届き、相手が `SendMessage` で返事をすると送り元にも届いた。
Desktop のセッションとも双方向に届いた(Desktop → app 起動の CLI、app 起動の CLI → Desktop)。
一方、PATH の 2.1.150 には `ListAgents` / `SendMessage` も受信口(名前付きパイプ)も無く、一覧に出ず、送っても「見つからない」になる。

app が補うのは次の 4 点だけ(§8)。

1. `--name` を一意に付ける(同名があると送信側が ref の指定を求められる)
2. app が起動する CLI に `--settings '{"crossSessionInbound":"accept"}'` を渡すか、権限モードのクラスを揃える(揃わないと「保留」になり、headless では承認する口が無い)
3. 受信・送信を画面に出すなら jsonl の `origin.kind === "peer"` 行と `SendMessage` の tool_use / tool_result 行を読む(§5)
4. CLI の版を 2.1.280 系に固定する(§6)

## 検証環境

| 項目 | 内容 |
|---|---|
| OS | Windows 11 Pro |
| CLI (a) | 2.1.150 — PATH の WinGet 版 |
| CLI (b) | 2.1.280 — Desktop 同梱 `%APPDATA%\Claude\claude-code\2.1.280\claude.exe` |
| 探査ツール | `cli-probe`(#382)に `listen` シナリオと `--`(以降を claude にそのまま渡す)を追加したもの(§付録 B) |
| 作業フォルダ | スクラッチパッド配下の使い捨て `wsA` / `wsB` |
| Desktop 側 | Lab (PM) セッション自身(送受信の相手として使った。他の実運用セッションには送っていない) |

## 0. 仕組み(実測と CLI の文字列から分かったこと)

### 0.1 部品

| 部品 | 場所 | 内容 |
|---|---|---|
| 受信口 | 名前付きパイプ `\\.\pipe\LOCAL\cc-msg-<32 hex>` | CLI が起動時に開く。台帳の `messagingSocketPath` と `system/init` の `messaging_socket_path` に書かれる |
| 実行中台帳 | `~/.claude/sessions/<PID>.json` | `name` / `nameSource` / `status`(`idle` / `busy` / `waiting`)/ `peerProtocol: 1` / `peerFeatures` / `messagingSocketPath` / `entrypoint` / `hostSessionId`。`ListAgents` の一覧はこれから作られる |
| 認証鍵 | `~/.claude/sessions/<PID>.<64 hex>.key` | JSON `{"peerToken": <32 hex>, "procStartFt": …, "pidDomain": …}`。モード 0600(本人のみ)。**値は記録しない** |
| ツール | `ListAgents` / `SendMessage`(組み込み。`SendMessage` は `ToolSearch` で読み込む遅延ツール) | 280 の組み込みツール一覧にある。150 には無い |
| 設定 | `crossSessionInbound: "accept" | "hold" | "refuse"`、`isolatePeerMachines`、`dialogExpiry` | SDK 0.3.281 の設定型にある |

### 0.2 名前の決まり方

- `--name <name>` を付けると台帳の `name` がその値、`nameSource: "user"`。jsonl には `custom-title` と `agent-name` 行が書かれる(#382 §6.1)
- 付けないと `nameSource: "derived"` の自動名(`ws-41` のような「フォルダ名-2桁」)
- Desktop 起動のものはタブ名(`hostSessionId` 付き)。一覧では「Claude Desktop session」と表示される

## 1. CLI 同士(A → B)

A(`--name poc429-A`)と B(`--name poc429-B`)を 2.1.280 で起動し、A に「`ListAgents` を呼び、`SendMessage` で poc429-B に `hello from A (poc429)` を送れ」と指示した。

### 1.1 一覧(A の `ListAgents` の tool_result、抜粋)

```
This session is poc429-A [14eae0] — the name other sessions use to message it (…).

Peer sessions (13):
  デザイン (全体) [8257ef]  ·  interactive  ·  idle  ·  Claude Desktop session  ·  started 1d ago
  …
  poc429-B [87ad72]  ·  interactive  ·  idle  ·  started 6s ago
  Lab (PM) [49c7c3]  ·  interactive  ·  busy  ·  Claude Desktop session  ·  started 1d ago
  …
```

行の形は `名前 [ref 6桁] · interactive · 状態 · (Claude Desktop session ·) started N ago`。
状態は台帳の `status`(`idle` / `busy` / `waiting`)。
app が起動した CLI は「Claude Desktop session」の印が無いだけで、同じ一覧に並ぶ。

### 1.2 送信(A の `SendMessage` の tool_result)

```json
{"success":true,
 "message":"“hello from A (poc429)” → poc429-B (another Claude session on this machine; queued there — a [Cross-session delivery notice] follows if that session holds it (different permission mode: its user must approve first) or refuses it)",
 "msg_id":"3e8394a8-cf25-4982-9d50-dfd5ff4cd8ca"}
```

権限の問い合わせ(`can_use_tool`)は出なかった(`default` モードで `ListAgents` / `SendMessage` は許可不要)。

### 1.3 受信(B の stdout。B は待機中)

```
<< {"type":"command_lifecycle","state":"started","command_uuid":"9a5629c0-…","session_id":"…"}
<< system/init …
<< {"type":"user","isReplay":true,"isSynthetic":true,"uuid":"9a5629c0-…",
     "message":{"role":"user","content":"Another Claude session sent a message:\n<cross-session-message from=\"uds:\\\\.\\pipe\\LOCAL\\cc-msg-<hash>\" from-name=\"poc429-A\" from-mode=\"prompting\">\nhello from A (poc429)\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user, … that's permission laundering."},
     "origin":{"kind":"peer","from":"uds:\\\\.\\pipe\\LOCAL\\cc-msg-<hash>","name":"poc429-A","fromMode":"prompting","msg_id":"3e8394a8-…","body":"hello from A (poc429)","hopChain":["…"]}}
<< assistant … tool_use ToolSearch(select:SendMessage)
<< assistant … tool_use SendMessage {"to":"uds:\\\\.\\pipe\\LOCAL\\cc-msg-<hash>","message":"Hello from B (poc429-wsB) — message received.",…}
<< user … tool_result {"success":true,…}
<< assistant … text="別のClaudeセッション「poc429-A」から…届きました。…"
<< result subtype="success" num_turns=3
<< {"type":"command_lifecycle","state":"completed","command_uuid":"9a5629c0-…"}
```

- **user ターンとして届く**。本文は `Another Claude session sent a message:` + `<cross-session-message from=… from-name=… from-mode=…>` の封筒 + 注意書き(Desktop で受け取るものと同じ)
- `origin.kind: "peer"` に、送り元の受信口(`from`)、名前、権限モードのクラス(`fromMode`)、送信側の `msg_id`、**封筒を剥いだ本文(`body`)** が入る。画面に出すなら `body` を使えばよい
- 前後に `command_lifecycle`(`started` / `completed`、`command_uuid` = その user 行の `uuid`)が出る。app はこれで「メッセージ 1 件の処理の始まりと終わり」が分かる
- B は指示していないのに自発的に返事を送った(モデルの判断)。返事の宛先は名前ではなく `uds:` の受信口アドレス
- B の返事は A に届いた(A は stdin を閉じた直後だったが、終了前に処理して `result` まで出した)

### 1.4 相手が実行中のとき

| B の状態 | 結果 |
|---|---|
| 長文を生成中(1〜600 を数える。ターンは約 10 秒で終了) | ターンが終わったあと(約 6 秒後)に別ターンとして届いた(§1.3 の形) |
| ツール実行の合間(`sleep 45` をバックグラウンドにして待機中のターン) | **同じターンの途中に割り込んで**届いた。このとき本文に `Another Claude session sent a message:` の前置きは無く、`<cross-session-message …>` から始まる。B はそのターン内で返事を送った(`num_turns: 5`) |
| 送信側 A2 が自分のターンの途中(ツール呼び出しの合間)に返事を受けた | 同じく割り込みで届き、A2 はそのターンの最後の文でまとめて触れた |

送信側の tool_result は常に「queued there」で、届いたかどうかは返事が来るまで分からない(保留・拒否のときだけ通知が来る。§5.3)。

## 2. 宛先の指定

| 指定 | 結果(`SendMessage` の tool_result) |
|---|---|
| `--name` の名前(`poc429-busy`) | `{"success":true,…}` 届いた |
| 同名が 2 つ(`poc429-dup` × 2) | `{"success":false,"message":"2 agents are named 'poc429-dup'. Re-send with the ref of the one you mean:\n  poc429-dup [c8146e] — Claude session, on this machine, active 15s ago\n  poc429-dup [bbeb69] — …"}`。どちらにも届いていない(両方の stdout に何も出ず) |
| 無い名前(`poc429-nobody`) | `{"success":false,"message":"No agent named 'poc429-nobody' is reachable.\nUse ListAgents to see everyone you can message."}`。似た名前があると `Did you mean: poc429-hold?` が付く |
| `uds:\\.\pipe\LOCAL\cc-msg-<hash>`(受信口アドレス) | 届いた(B から A への返事はこの形) |
| `名前 [ref]` | 未実施(同名の解決にはこれを使う、と tool_result が言っている) |

app が名前を付けるなら一意にする。
表示名とは別に「セッション ID の先頭など一意な接尾辞」を付けるか、`ref` を使う。

## 3. Desktop との相互運用

| 向き | 結果 |
|---|---|
| Desktop(Lab (PM))の `ListAgents` | app 起動の `poc429-B` が `poc429-B [87ad72] · interactive · idle · started 38s ago` として見えた |
| Desktop → app 起動の CLI | Lab (PM) から `SendMessage` → B に届き(`origin.name: "Lab (PM)"`, `fromSession: "local_…"`)、B が `ack-from-B` を返した |
| app 起動の CLI → Desktop | B の返事が Lab (PM) に「Another Claude session sent a message」の user ターンとして届いた |
| app 起動の CLI の一覧 | Desktop の全セッションが「Claude Desktop session」付きで見える |

Desktop の `send_message`(MCP)と CLI の `SendMessage` は別の経路だが、受け取る側の形は同じ封筒(`<cross-session-message>`)。
Desktop 由来は `from-session="local_…"` が付き、CLI 由来は `from="uds:…"` だけ、という違いがある。
**移行期間中(Desktop と app が混在)でも、両方向に届く**。

## 4. 認証と安全

### 4.1 `.key` と `peerToken`

- 受信側の CLI が起動時に `~/.claude/sessions/<PID>.<64 hex>.key` を **モード 0600 で**書く(CLI 内の文字列 `[uds-auth] key publish`、スキーマ `peerToken: /^[0-9a-f]{32}$/`、`procStart` / `procStartFt` / `pidDomain` は任意)
- 送信側は相手の `.key` を読んで `peerToken` を得て、パイプ接続時に提示する(`requireAuth`、`cross_session_inbox_auth`)。**つまり `peerToken` は「同じユーザーのホームディレクトリを読める者だけが送れる」ための共有秘密**
- 相手の PID が死んでいて `procStart` が合わないときは `dead-owner` として使わない(古い `.key` の悪用防止)
- パイプ名は `\\.\pipe\LOCAL\…`。`LOCAL` 名前空間は同じログオンセッション内だけで見える
- `verifiedPeerPid`(接続元 PID を OS から取る仕組み)は **Windows では無効**(CLI 内の `kT()` が `windows` で `false`)。実際に届いた `origin` にも無かった

### 4.2 他のユーザー・他のマシン

実測はしていない(このマシンにユーザーが 1 人しかいない)。
仕組み上は、`.key` が本人のみ読める(`icacls` で SYSTEM / Administrators / 本人だけ)ことと、`LOCAL` パイプがログオンセッション内に閉じることから、他のユーザー・他のマシンからは届かない。
他のマシンへは Remote Control 経由の別経路があり、`isolatePeerMachines` 設定で承認を要求できる(SDK の設定型の説明)。

### 4.3 保留(hold)と権限モードの不一致

| 受信側 | 送信側(`default` = prompting) | 受信側の stdout | 送信側の stdout |
|---|---|---|---|
| `--settings '{"crossSessionInbound":"hold"}'` | 送れた(`success: true`) | `system/peer_message_hold {"state":"held","cause":"explicit-setting","from":"uds:…","from_name":"poc429-A3","lane":"socket","message_uuid":"…"}`。**user ターンにはならない**。プロセス終了時に `{"state":"dropped","outcome":"discarded"}` | `system/informational {"level":"warning","content":"Cross-session message held for approval (recipient: uds:…). The recipient's session has different permission-mode settings, so their user must approve it before Claude sees it."}` |
| `--permission-mode bypassPermissions` | 同上 | 同上だが `"cause":"mode-mismatch"` | 同上 |

- 設定が無いときは「送信側と受信側の権限モードのクラス(prompting / bypass)が一致すれば配達、違えば保留」(SDK の設定型の説明どおり。実測も一致)
- **保留を承認する口は headless(stream-json)には見つからなかった**。CLI の `request_user_dialog` の種類は `refusal_fallback_prompt` だけで、保留メッセージ用の dialog kind は無い。対話 UI では「Review it below」の画面で承認する作り(CLI 内の文字列)
- app が起動する CLI は全部 app の管理下なので、`crossSessionInbound: "accept"` を `--settings` で渡す(または権限モードを揃える)のが簡単。Desktop 側と app 側でモードのクラスが違う運用にすると、Desktop → app が保留になる

## 5. app から見えるもの

### 5.1 受信(jsonl)

受信側の jsonl に user 行として書かれる(`isMeta: true`、`origin` 付き):

```json
{"type":"user","isMeta":true,"userType":"external","entrypoint":"sdk-cli",
 "message":{"role":"user","content":"Another Claude session sent a message:\n<cross-session-message …>…"},
 "origin":{"kind":"peer","from":"uds:\\\\.\\pipe\\LOCAL\\cc-msg-<hash>","msg_id":"…","name":"poc429-A","fromMode":"prompting","body":"hello from A (poc429)"},
 "uuid":"…","timestamp":"…","sessionId":"…"}
```

Desktop 由来なら `origin.fromSession: "local_…"` と `hopChain` が付く。
app のビューアは `origin.kind === "peer"` で「他セッションからのメッセージ」と分かり、`origin.name` と `origin.body` で表示できる(封筒を自前で剥がす必要は無い)。

### 5.2 送信(jsonl)

送信側は通常のツール呼び出しとして残る: `assistant` 行の `tool_use`(`name: "SendMessage"`, `input: {to, message, summary?}`)と、続く `user` 行の `tool_result`(§1.2 の JSON 文字列)。
`msg_id` が受信側の `origin.msg_id` と一致するので、送った・届いたを突き合わせられる。

### 5.3 stdout(app が起動したプロセス)

| 出来事 | stream-json の出力 |
|---|---|
| 受信して処理 | `command_lifecycle`(started)→ `system/init` → `user`(`isReplay`, `isSynthetic`, `origin.kind: "peer"`)→ … → `result` → `command_lifecycle`(completed) |
| 保留 | `system/peer_message_hold`(`state: "held"` / `"released"` / `"dropped"`) |
| 送信が相手で保留・拒否 | `system/informational`(`level: "warning"`) |
| 送信の成否 | `SendMessage` の tool_result |

### 5.4 `peerFeatures`

台帳の `peerFeatures: ["notify_idle","artifact_yield"]` は、その CLI が対応している拡張の宣言(CLI 内の定数 `"notify_idle"` / `"artifact_yield"`)。
`notify_idle` は「相手が idle になったら知らせる」機能(`notify_when_idle` のフレーム、`cross_session_notify_idle`)。
`artifact_yield` は名前しか確認できなかった(本 PoC の範囲では使われなかった)。
app が読む必要は今のところ無い。

## 6. 版差

| 項目 | 2.1.150(PATH) | 2.1.280(Desktop 同梱) |
|---|---|---|
| `ListAgents` / `SendMessage` ツール | **無い**(`system/init` の tools に無い) | ある |
| 受信口 `messagingSocketPath` | 台帳に無い。`system/init` にも無い | ある |
| `.key`(`peerToken`) | 書かれない(CLI 内に `peerToken` の文字列も無い) | 書かれる |
| 一覧に出るか | 出ない(`--name poc429-old` で起動しても Desktop・280 の `ListAgents` に現れない) | 出る |
| 送れるか | 280 から送ると `No agent named 'poc429-old' is reachable` | — |
| 台帳の `status` | 無い | `idle` / `busy` / `waiting` |

追記(2026-09-25、PATH の WinGet 版を 2.1.268 に上げたあとに確認): **2.1.268 でも使える**。
`ListAgents` / `SendMessage`、`messagingSocketPath`、`.key` がそろい、Desktop の一覧に現れて双方向に届いた(Issue #429 のコメント参照)。
280 との差は、台帳に `status` が無い(一覧に idle/busy が出ない)ことと、`SendMessage` の tool_result に「queued there — …」の説明文が無いことだけ。
機能の有無の境界は 2.1.150 と 2.1.268 の間にあり、正確な版は未確認。

**「CLI を上げれば使える」で済む**。
app が起動する `claude` を Desktop 同梱の 2.1.280(または同等以上)にすれば、Desktop の全セッションと相互に届く。
PATH の WinGet 版を上げる(`winget upgrade Anthropic.ClaudeCode`)か、app が実行ファイルの場所を選べるようにする(#345 で `claude_executable()` に閉じてある)。

## 7. 代替(app が MCP で仲介する方式)の評価

app が stdio の MCP サーバとして `list_sessions` / `send_message` を提供し、`--mcp-config` で各 CLI に渡し、宛先の CLI の stdin に user メッセージを注入する方式。

| 部品 | 必要なこと |
|---|---|
| MCP サーバ | app 内に JSON-RPC(stdio)のサーバを持ち、CLI ごとに子プロセスとして起動される(CLI が `--mcp-config` の `command` を spawn する)。app 本体との連絡にローカル API(14200)かパイプが要る |
| 一覧 | app が持つプロセス一覧を返す。Desktop のセッションは含められない(Desktop の台帳を読めば名前は出せるが、送れない) |
| 送信 | app が宛先の CLI の stdin に `{"type":"user",…}` を書く。実行中なら CLI のキューに乗る(#382 で確認済みの経路)。封筒(`<cross-session-message>`)と注意書きは app が付ける |
| 保留・承認 | app が自前で実装 |
| 難しさ | Desktop との相互運用が無い。封筒の形を CLI に合わせ続ける必要がある。MCP サーバの起動・認証・寿命管理が増える |

**CLI 任せで足りるので採らない**。
Desktop と混在する移行期間に相互に届くことは、この方式では得られない。

## 8. 方式の判断

**CLI 任せ(+ app が 4 点を補う)**。

| app が補うこと | 理由 |
|---|---|
| `--name` を一意に付ける | 同名があると送信側が ref を求められ、届かない(§2) |
| `--settings '{"crossSessionInbound":"accept"}'` を渡す、または権限モードのクラスを Desktop 側と揃える | 保留になると headless では承認できず、終了時に捨てられる(§4.3) |
| 受信は jsonl の `origin.kind === "peer"` 行、送信は `SendMessage` の tool_use / tool_result 行から表示する | 封筒を自前で解釈しなくてよい(§5) |
| CLI を 2.1.280 系にする | 150 には機能自体が無い(§6) |

Phase 3 で「作業依頼・完了報告」の運用を引き継ぐときも、Desktop でやっていることと同じ(モデルが `SendMessage` を呼ぶ)で足りる。
app が仲介する仕組み(MCP サーバ、注入、封筒)は作らない。

残る論点(Phase 3 の設計で扱う):

- 送信の到達確認は返事でしか分からない(`queued there` 止まり)。必要なら `notify_idle` の調査
- Windows では `verifiedPeerPid` が無いため、送り元の同一性は `peerToken` と封筒の `from` に依る
- 実行中の相手に送ると、ツール呼び出しの合間に割り込む(§1.4)。相手の作業に影響し得るので、運用上「実行中には送らない」を続けるか、割り込みを許容するかを決める

## 付録 A. 実行一覧

| ログ | 送信側 | 受信側 | 内容 | 結果 |
|---|---|---|---|---|
| A-280-send / B-280-listen | poc429-A(280) | poc429-B(280) | 一覧・送信・返信 | ○(§1) |
| (Desktop) | Lab (PM) | poc429-B | Desktop → CLI、CLI → Desktop | ○(§3) |
| A2-send / B2-busy, B3-dup1, B4-dup2 | poc429-A2 | poc429-busy / poc429-dup ×2 / 無い名前 | 実行中・同名・不在 | §1.4, §2 |
| A3-send / B5-hold, B6-bypass, B7-150 | poc429-A3 | hold 設定 / bypassPermissions / 2.1.150 | 保留・モード不一致・旧版 | §4.3, §6 |
| A4-send / B8-sleeper | poc429-A4 | ツール実行の合間で待機中 | 割り込み配達 | §1.4 |

## 付録 B. 探査ツールの変更

`reports/tools/cli-probe/` に対して次を足した(スクラッチパッドで実施。リポジトリへの反映は別 PR)。

- `listen` シナリオ: `POC_PROMPT` があれば先に送り(`POC_NOWAIT=1` なら `result` を待たない)、`POC_LISTEN_SECS` 秒のあいだ届くものを全部記録する。`can_use_tool` は許可で答える
- `--` 以降の引数を `claude` にそのまま渡す(`--settings` などを試すため)
