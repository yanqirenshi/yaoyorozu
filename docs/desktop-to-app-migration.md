# Claude Desktop から yaoyorozu app へのセッション移行 手順書

親イシュー: [#381](https://github.com/yanqirenshi/yaoyorozu/issues/381)(Phase 0〜3 完了。2026-09-25 時点)
対象: Claude Desktop で運用している yaoyorozu の 15 セッションを、yaoyorozu app(Tauri)から対話する形へ移す。

## 0. 考え方

- **会話は移動しない**。会話ファイル(`~/.claude/projects/C--Users-yanqi-prj-yaoyorozu/<ID>.jsonl`)は Desktop も app も同じものを使う。移行とは「その会話を開く側を Desktop から app に替える」ことでしかない。
- **1 セッションずつ**、**連携の少ないものから**。まず 1〜2 件を数日使い、問題がなければ残りを順に移す。
- **戻せる**。Desktop 側の記録(`local_*.json`)は消さずアーカイブするだけにする。app で開いたセッションを止めれば、Desktop から同じ会話を再開できる。
- **同じ会話を Desktop と app で同時に開かない**。app には実行中ガード(#361)があり、Desktop が開いている会話へは送れないが、Desktop 側にはガードが無い。Desktop で止めてから app で開く。

## 1. 前提(移行を始める前に 1 回だけ)

| 項目 | 状態 | 確認方法 |
|---|---|---|
| CLI の版 | **2.1.268 以上**(セッション間メッセージに必要。2026-09-25 に winget で更新済み) | `claude --version` |
| app の版 | Phase 3(#437 / #438)を含む main のビルド | 開発版(`npm run native:dev`)か、**新しいリリース**を 運用:リリース に依頼する(v0.4.1 は Phase 0 以前) |
| app のプロファイル | リポジトリ `C:\Users\yanqi\prj\yaoyorozu`、対象フォルダに `C--Users-yanqi-prj-yaoyorozu` | app の設定画面 |
| ハブの表示 | 15 セッションが**セッションノード**として見える | ハブ(`/`) |

app の起動は、これまでどおり 運用:リリース セッションに依頼する(CLAUDE.md の取り決め)。

## 2. 1 セッションの移し方

### 2.1 Desktop 側で止める

1. Desktop のサイドバーでそのセッションを開き、実行中なら終わるのを待つ。
2. セッションを**閉じる**(タブを閉じる。Desktop の記録は残る)。
3. 台帳に残っていないことを確認する(任意): `~/.claude/sessions/` にそのセッション ID を含む `<PID>.json` が無い。

> 削除・アーカイブはまだしない。app で数日使って問題が無いと分かってから、Desktop 側をアーカイブする(§4)。

### 2.2 app 側で開く(再開)

1. ハブで、そのセッションのノードを選び、インスペクタの「起動(再開)」を使う。
2. 入力は次のとおりにする。

| 入力 | 値 | 理由 |
|---|---|---|
| 権限モード | **auto** | Desktop と同じ。クラス(prompting)がそろい、Desktop との間でメッセージが保留にならない |
| 表示名 | **元のタイトルと同じ文字列**(例: `デザイン (全体)`) | セッション間メッセージの宛先になる名前。同じ値なので会話のタイトルは変わらない(空にすると名前が付かず、宛先に指定できない) |
| worktree | **リポジトリ本体**(既定のまま) | 今のセッションは cwd = リポジトリ本体で動いていて、会話ファイルと記憶(`memory/`)がそのフォルダに紐づいている。worktree を cwd にすると別のプロジェクトフォルダに会話が分かれる(#217 と同じ現象)。worktree へは、これまでどおりセッション自身が移動する |

3. 起動 → 待機になったら、「ビューアで開く」で会話ビューを開き、動作確認の質問を 1 つ送る(例: 「直前の作業を 1 行で要約して」)。文脈を持っていれば成功。
4. その会話ビューの状態バーに「claude の版」の警告が**出ていない**ことを確認する。

### 2.3 セッション間メッセージの確認

1. app で開いたセッションから、Desktop に残っているセッション(例: Lab (PM))へ `SendMessage` で短い連絡を送り、届くことを確認する。
2. 逆方向(Desktop → app)も 1 回確認する。
3. 届かない・保留になる場合は §5 を見る。

## 3. 順番(案)

| 段 | セッション | 固定ブランチ | 理由 |
|---|---|---|---|
| 1(試行) | 実装:Web、Lab (PoC:検証) | `session/impl-web`、`session/lab-poc-verify` | 他との連携が少ない |
| 2 | 実装:APP (画面:/)、(画面:/settings)、(画面:/claude)、Lab (PoC:実装) | `session/impl-app-hub`、`session/impl-app-settings`、`session/impl-app-claude`、`session/lab-poc-impl` | 画面別・PoC の実装 |
| 3 | デザイン (UI)、(ドメイン:Data)、(ドメイン:オブジェクト)、(画面構成)、Lab (PM) | `session/design-ui`、`session/design-domain-data`、`session/design-domain-object`、`session/design-sitemap`、`session/lab` | 設計・調査 |
| 4 | 実装:APP (共通)、運用:リリース、管理 | `session/impl-app`、main、main | 共有層と運用 |
| 5(最後) | デザイン (全体) | main | 全体の連絡役なので最後 |

段が進むたびに、前の段のセッションが数日問題なく動いていることを確かめてから次へ進む。

### セッション ID の一覧(2026-09-24 に Desktop の記録から取得)

| セッション | 会話ファイルの ID(cliSessionId) |
|---|---|
| デザイン (全体) | `dc51f1f6-330a-448e-9335-cc22d2795d1e` |
| デザイン (UI) | `39f67217-7a07-4fef-89d8-330a98300451` |
| デザイン (ドメイン:Data) | `eb5aa8b7-ab28-4caa-97af-274698f7dea9` |
| デザイン (ドメイン:オブジェクト) | `762e46e1-7682-4680-8586-02692882c5a8` |
| デザイン (画面構成) | `9053e84e-63b7-488a-a30a-db4a990ff300` |
| 実装:APP (共通) | `5302184c-6187-49ec-8aaf-14a9b25bd24f` |
| 実装:APP、画面:/ | `cfceb972-6fe4-4220-b007-69ac7c68a8ee` |
| 実装:APP、画面:claude/ | `6d8704b8-8ddd-4dbb-aec9-c7aec46d639e` |
| 実装:APP、画面:setting/ | `b7d60850-d2ff-4604-89a4-d4c9a705cfa5` |
| 実装:Web | `50791d6a-4532-4521-868f-3ed3a96b3182` |
| Lab (PM) | `94d56c50-dcd7-4a3b-aae1-3cd099a52de7` |
| Lab (PoC:実装) | `ebadab40-c172-49c9-8066-df5b8e384787` |
| Lab (PoC:検証) | `2fc10751-8489-4f6f-a4df-9ede24ead8e0` |
| 運用:リリース | `4fa1a5e9-26d1-41b6-b057-1930354efa9e` |
| 管理 | `9a49b049-fec2-444d-88f8-45904e785c2c` |

> Desktop で圧縮(compact)や再開が起きると ID が変わることがある(Desktop は `priorCliSessionIds` に履歴を持つ)。移す直前に、Desktop の記録 `%APPDATA%\Claude\claude-code-sessions\<org>\<project>\local_*.json` の `cliSessionId` を確認する。ハブには最新の会話ファイルがノードとして出ているので、タイトルで選べば通常はそれで足りる。

## 4. 全部移し終えたら

1. Desktop 側の 15 セッションを**アーカイブ**する(削除しない。しばらく戻せるように)。
2. `CLAUDE.md` の「セッション間コミュニケーション」の記述を、Desktop のツール名(`list_sessions` / `send_message`)から CLI のツール名(`ListAgents` / `SendMessage`)へ改める(デザイン (全体) がドキュメント変更として main へ直接コミット)。
3. 各セッションに、新しい環境での注意を 1 回伝える: 宛先は表示名で指定する / 実行中の相手には送らない(ツール呼び出しの合間に割り込むため。app の状態表示で確認できる)/ 作業依頼にはイシュー番号と URL を添える(従来どおり)。
4. 安定したら、Desktop 側のセッションを削除してよい(会話ファイルは残る)。

## 5. 困ったとき

| 症状 | 原因 | 対処 |
|---|---|---|
| app の起動で「実行中」と言われて開けない | Desktop(または別の CLI)が同じ会話を開いている(#361 のガード) | Desktop 側でそのセッションを閉じる。台帳 `~/.claude/sessions/` の該当 `<PID>.json` が消えるのを待つ |
| 状態バーに「claude の版」の警告 | PATH の `claude` が 2.1.268 未満 | `winget upgrade Anthropic.ClaudeCode` |
| `SendMessage` で「No agent named … is reachable」 | 宛先の表示名が違う、または相手が起動していない | 相手の `ListAgents` 上の名前を確認する。app のセッションは起動時の表示名、Desktop のセッションはタイトル |
| 「2 agents are named …」で送れない | 同名のセッションが 2 つ | app 側は起動時に一意化されるが、Desktop に同名が残っていると衝突する。片方の表示名を変える |
| 送ったのに相手が反応しない(保留) | 権限モードのクラスが違う(prompting / bypass) | 両方を auto(prompting)にそろえる。app 側は `crossSessionInbound: accept` を渡しているので、app が受け取る側では起きない |
| 会話のタイトルが変わった | 表示名に元と違う文字列を入れて再開した | 元のタイトルで再開し直す(最後のタイトル行が採用される)。会話の中身は変わらない |
| 会話が 2 つのフォルダに分かれた | worktree を cwd にして起動した | 以後はリポジトリ本体で起動する。分かれた分は同じセッション ID なので app は 1 つの会話として扱う(#217) |

## 6. 戻し方(ロールバック)

1. app のインスペクタで「停止」する(会話ビューの「終了」でも同じ)。
2. Desktop で、アーカイブしていればアーカイブから戻し、そのセッションを開く。Desktop は自分の記録の `cliSessionId` で会話を再開する。
3. app で表示名を変えていなければ、タイトルはそのまま。

## 7. 記録

- 会話ファイルの形: `reports/claude-session-jsonl-format.md`
- app が CLI を持つ仕組み: `reports/claude-cli-stream-json-session.md`(#382)
- セッション間メッセージ: `reports/claude-cli-peer-messaging.md`(#429)。CLI 任せで足り、app は名前の一意化・accept 設定・表示・版の警告を補う
- 各段階の実装: Phase 1 #391 / #392、Phase 2 #407 / #408 / #409、Phase 3 #437 / #438
