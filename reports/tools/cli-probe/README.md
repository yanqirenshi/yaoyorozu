# cli-probe

`claude` CLI を**起動したまま** stream-json で対話する、探査用の使い捨て CLI です(Rust。約 430 行)。
PoC #382 で、Phase 1(#381)の設計材料を実測するために使いました。
Phase 1 の実装者が「CLI をどう起動し、どう対話し、何を読めばよいか」を確かめるための**参照実装**として、リポジトリに残しています。

- 実測の結果とその読み方: [`reports/claude-cli-stream-json-session.md`](../../claude-cli-stream-json-session.md)(このツールの説明は [付録 A](../../claude-cli-stream-json-session.md#付録-a-探査ツール-cli-probe)、実行の一覧は付録 B)
- app 本体(`apps/native`)・Cargo workspace には**入っていません**。単独の crate です(`apps/native/Cargo.toml` の `members` に加えないでください)。
- 製品コードではありません。探査のために書いたもので、エラー処理は最小限です(引数の誤りは `panic!` します)。

## 使い捨てフォルダで使うこと

**実運用の会話・リポジトリには向けないでください。** 必ず、このツールのための使い捨てフォルダ(と使い捨ての会話)を `<cwd>` に指定します。

- **権限の問い合わせに自動で許可を返します。** `perm-allow` / `perm-write` / `set-mode` / `prompt` は、`can_use_tool` に `allow`(入力はそのまま)で即答するので、`Bash` や `Write` が実際に実行されます。`prompt` は本文の内容しだいで任意のツールが許可されます。
- **ファイルを作ります。** `perm-write` は `<cwd>` に `poc382.txt` を、`perm-write-deny` は `poc382-deny.txt` を、`perm-interrupt` は `poc382-int.txt` を作らせようとします。
- **既存の会話へ書き込みます。** `--resume ID` を付けると、その会話の jsonl に追記されます。実運用の会話の ID を渡さないでください。
- **実行中セッションの台帳を残すことがあります。** `kill` はプロセスを強制終了するため、`~/.claude/sessions/<PID>.json` が残ります(レポート §4.3)。
- **親の環境変数を外します。** 名前が `CLAUDE` で始まる環境変数は、子プロセスに渡しません(このツールを Claude Code の中から動かしても、起動元を示す変数を引き継がないため)。

## ビルドと実行

Rust 1.85 以上が必要です(`edition = "2024"`)。Windows を前提にしています(台帳のパスを `USERPROFILE` から作ります)。

```bash
cd reports/tools/cli-probe
cargo build
cargo run -- <claude.exe> <cwd> <scenario> [オプション]
```

```
cli-probe <claude.exe> <cwd> <scenario> [--resume ID] [--permission-mode M] [--print] [--no-init] [--name N] [--model M] [--log FILE]
```

| 引数 | 意味 |
|---|---|
| `<claude.exe>` | 起動する `claude` の実行ファイル(フルパス) |
| `<cwd>` | 子プロセスの作業ディレクトリ。**使い捨てフォルダ**を指定する。`image` シナリオでは、ここに置いた `red.png` を読む |
| `<scenario>` | 実行するシナリオ(下の一覧) |
| `--resume ID` | `--resume=ID` を付けて既存の会話を再開する |
| `--permission-mode M` | `--permission-mode M` を付ける(`default` / `plan` / `acceptEdits` など) |
| `--print` | `--print` を付けて起動する |
| `--no-init` | 起動直後の `initialize` 要求を送らない(`initialize` が必須でないことの確認用。レポート §0.4) |
| `--name N` | `--name N`(表示名)を付ける |
| `--model M` | `--model M` を付ける |
| `--log FILE` | 標準出力に出す要約とは別に、**行全体**を `FILE` に書き出す |

子プロセスは常に次の引数で起動します: `--output-format stream-json --verbose --input-format stream-json --permission-prompt-tool stdio --replay-user-messages --include-partial-messages`(`--print` などのオプションは上に足されます)。

## シナリオ一覧

各シナリオは、`Probe` にユーザーメッセージ(`{"type":"user",…}`)や制御要求(`control_request`)を送り、`result` 行が来るまで読む、という流れです。`can_use_tool` は、シナリオごとに `allow`(入力をそのまま `updatedInput` に)か `deny` で即答します。

| シナリオ | やること |
|---|---|
| `roundtrip` | 1語(PING)を頼み、`result` のあとプロセスが生きているかを見て、同じプロセスで2回目を頼む(複数回の往復) |
| `perm-allow` | `Bash` で `echo` を実行させ、`can_use_tool` に許可で答える。続けて1語を頼む |
| `perm-deny` | 同じ依頼に、`can_use_tool` を拒否で答える。続けて1語を頼む |
| `perm-write` | `Write` で `poc382.txt` を作らせ、許可で答える |
| `perm-write-deny` | `Write` で `poc382-deny.txt` を作らせ、拒否で答える。続けて1語を頼む |
| `perm-interrupt` | `Write` の権限を問い合わされたら**答えずに** `interrupt` を送る。プロセスの生存を見て、続けて1語を頼む |
| `interrupt` | 長い出力を頼み、テキスト差分が5回来たところで `interrupt` を送る。プロセスの生存を見て、続けて1語を頼む |
| `resume` | `--resume ID` と組み合わせて、「この会話で最初に何を頼んだか」を聞く |
| `image` | `<cwd>/red.png` を base64 の `image` ブロックとして送り、色を聞く。続けて1語を頼む |
| `set-model` | 1語を頼み、`set_model`(`haiku`)を送り、続けて1語を頼む |
| `set-mode` | `set_permission_mode`(`plan`)を送ってから `Bash` を依頼し、許可で答える |
| `kill` | 1語を頼み、台帳を読み、プロセスを `kill` して、台帳が残るかを見る |
| `prompt` | 環境変数 `POC_PROMPT` の本文をそのまま送り、権限の問い合わせには許可で答える |

`prompt` は、上のシナリオにない依頼を試すためのものです。

```bash
POC_PROMPT="Reply with exactly one word: HELLO" cargo run -- <claude.exe> <cwd> prompt --log probe.log
```

## 出力の見方

標準出力には、経過時間つきの要約が出ます。

- `[  1.234s] >> …`: 子プロセスへ送った行(300文字まで)
- `[  1.234s] << …`: 子プロセスの標準出力から読んだ行の要約。`system/init` は `session_id` / `model` / `permissionMode` / `tools` / `claude_code_version` を出し、`control_request` などの制御行は全文(1500文字まで)を出す
- `[  1.234s] !! stderr: …`: 標準エラー
- `## …`: このツールの注記。起動引数、子プロセスの PID、`initialize` の応答のキー、**実行中セッションの台帳** `~/.claude/sessions/<PID>.json` の内容(`after init` / `after 1st result` / `before kill` / `before stdin close` / `after exit` などの時点)、`session_id`、終了時の**行の種類ごとの件数**
- 標準出力が JSON でない行は `(non-json)` として出す

`--log FILE` を付けると、要約ではなく**行全体**を `FILE` に書きます。

実装の読みどころ: 子プロセスを `Stdio::piped()` で起動し、標準出力を読むスレッドと標準エラーを読むスレッドをそれぞれ立て、メインスレッドがチャンネル経由でシナリオを進めます(`main` と `Probe`)。終了は、標準入力を閉じて子プロセスの終了を待つ形です(`drain_until_exit`)。
