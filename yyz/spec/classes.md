## このファイルは何か

`/{リポジトリ名}/class-diagram` に描くオブジェクトモデル(Classes)について、**横断する判断の記録**を置く。
データ(箱・線とその説明)は隣の `classes.json` にある。

図そのものは `classes.json` が一次資料で、このファイルは「なぜそう描いたか」「どこまで確かめたか」を残すためのもの。
実装との対応を確かめる相手(= 本当の一次資料)は `apps/native` の Rust のソースで、図はその写しである。

issue #589(#543 の最終段)で `apps/web/src/data/classes*.ts` から移した。
移す前は TypeScript のコメントとして同じ内容が書かれていた。

## 置き場所と形

```
{リポジトリ}/yyz/spec/classes.json   データ(機械が読む)
{リポジトリ}/yyz/spec/classes.md     判断の記録(このファイル)
```

`classes.json` は `{ "sections": [...], "classes": [...], "relationships": [...] }` の形。

`sections` は図の中の区切り(移行前の `// ==== … ====` の見出し)で、`{ group, title, notes? }` を並びの順に持つ。
`notes` は、その区切りの下にまとめて書いていた説明。

`classes` の各要素は d3.classes の `ClassInput`(`id` / `name` / `stereotype` / `attributes` / `methods` / `position` / `size`)に、図を読むための項目を足したもの。

| 足した項目 | 意味 |
|---|---|
| `group` | 移行前にどのファイルにいたか(`domain` / `native-prototype` / `infra` / `tauri`)。編集の単位 |
| `section` | ファイルの中の区切り(移行前の `// ==== … ====` の見出し) |
| `layer` | クリーンアーキテクチャの層。箱のヘッダの色と、インスペクタの表示に使う |
| `filePath` | 対応する Rust の実装ファイル(リポジトリルートからの相対) |
| `notes` | その箱についての補足(移行前にクラスの定義へ添えていたコメント) |

`attributes` / `methods` の各要素には `description`(文字列の配列)が付くことがある。
移行前に属性・メソッドへ添えていたコメントで、その項目を消せば一緒に消える説明。

`relationships` の各要素にも `notes` が付くことがある(同じ理由)。
d3.classes の `RelationshipInput` には説明の欄が無いので、図へ渡す前に取り除く。
`group` / `section` / `layer` / `filePath` / `notes` も同じく、描画のライブラリへは渡さない。

レイアウト(箱の位置の手調整と視点)は**ここには入れない**。
`apps/web/src/data/layout/classes.json` のまま置いてある(保存 API が apps/web の下に書く作りのため。#587 に記録がある)。

## ファイルを1本にまとめた理由

移行前は4本(`classes-domain.ts` / `classes-native-prototype.ts` / `classes-infra.ts` / `classes-tauri.ts`)に分かれていたが、**JSON は 1 本**(`classes.json`)にした。

- **1枚の図だから。** 4本は編集の都合で分けていただけで、`mergeDiagrams` が1枚に重ねて描いていた
- **名前の一意がファイルをまたぐ制約だから。** 物理名は図全体で重複してはいけない(関係線の参照・DOM の id・レイアウトの保存キーがすべて物理名)。1本なら、その制約がファイルの形として見える
- **ページが全部を同時に必要とするから。** 分けると取得が4回になる
- **#587 の許可リストを増やさずに済むから**
- **サイトマップ・TM と形が揃うから**(どちらも1本)

**引き換えに、ファイルは大きい**(約 14,500 行 / 440KB)。
分けていた単位は各クラスの `group` と `section` に残したので、「infra の図に足す」といった編集のまとまりは失われていない。

## 旧ファイル名と group の対応

以下の記録の本文には、移行前のファイル名がそのまま出てくる。
次のように読み替える(本文は要約せず、そのまま移した)。

| 本文に出てくる名前 | いまの場所 |
|---|---|
| `classes-domain.ts` | `classes.json` の `group: "domain"` |
| `classes-native-prototype.ts` | `classes.json` の `group: "native-prototype"` |
| `classes-infra.ts` | `classes.json` の `group: "infra"` |
| `classes-tauri.ts` | `classes.json` の `group: "tauri"` |
| `classes.ts` | 4つを重ねていたファイル。1本にまとめたので無くなった |
| `classDiagram.ts` | 図を書くための道具(`attr` / `method` / `rel` / `defineDiagram`)。データを組み立てる役目は JSON へ移った |

## 突き合わせの記録(どこまで見たか)

as-is の図(`group` が `native-prototype` / `infra` / `tauri` のもの)は、Rust の実物の写しである。
**目視で読み比べず、宣言から機械的に取り出して比べる**ことにしている。
次に突き合わせる人が「前回どこまで見たか」を分かるように、範囲と結果をここに残す。

| いつ | 範囲 | 結果 |
|---|---|---|
| #400 | tauri の `struct` / `enum` を、名前・フィールド・バリアントで突き合わせ | 一致 |
| #420 | 4つのクレートの型名を双方向で突き合わせ(図にあって実物に無い / 実物にあって図に無い) | 載せない型を決め、理由を記録 |
| #441 / #465 / #494 / #501 / #523 | 実装の PR ごとに、増えた型・変わったフィールドを突き合わせ | その都度反映 |
| #528 | **port のメソッド一覧**(26個)を名前・引数・戻り値まで突き合わせ。メソッドを描いている struct / enum(13個)も名前で突き合わせ | `HubTuningStore` の型名と `StartModel.from_cli_value` の2件を直した。ほかは一致 |

#400 の突き合わせは**型の名前とフィールドが中心**で、port のメソッド一覧は対象外だった。
そのため `SessionSource` のずれ(`session` / `latest_session_id` / `latest_session_cwd` が実物から消えていた)が #523 まで残っていた。
#528 で port のメソッドまで広げたので、いまは型名・フィールド・port のメソッド・struct のメソッドの4つを見ている。

やり方は、使い捨てのスクリプトを3つ書く。

1. **型名の双方向**: 図の `name.physical` の集合と、Rust の `pub struct|enum|trait|type`(インデント 0。`#[cfg(test)]` 以降は切る)を比べる
2. **port のメソッド**: `pub trait` の本文から、名前・引数(`&self` を除く)・戻り値まで取り出して比べる
3. **struct / enum のメソッド**: `impl X {` の `pub fn` と名前で比べる(`new` / `default` は図に描かない方針なので除く)

**載せない型**(実物にあるが図に描かないもの)とその理由は、下の group ごとの記録に書いてある。

## 図ごとの記録(移行前の冒頭コメント)

ここから下は、移行前に各ファイルの冒頭へ書いていた記録を**そのまま**移したもの。
折り返しを「。」ごとの改行に直しただけで、内容は削っていない。

### 図全体(5本をどう重ねていたか)

`/class-diagram` に描く1枚の図。
図ごとのデータファイルを重ねる。

- `classes-domain.ts`: YAOYOROZU のドメインのオブジェクトモデル(原点付近)
- `classes-native-prototype.ts`: domain クレートに実装済みの、まだオブジェクトモデルへ置き換えられていない型(プロトタイプ期の型。x 正側、ドメインモデルのさらに右)
- `classes-infra.ts`: infra クレートの型と、それが実現する app の port(trait)。
  x 正側、`classes-native-prototype.ts` のさらに下
- `classes-tauri.ts`: tauri クレートの型(DTO・アプリ状態・ローカルAPI)。
  x 正側、`classes-infra.ts` のさらに下

どちらも座標は同じ平面上にあるので、新しい図を足すときは既存の図と重ならない位置に置く。

### ドメインのオブジェクトモデル(group: domain)

YAOYOROZU のドメインのオブジェクトモデル。

データモデル(TM、`tm.ts`)を元に起こし、apps/native の domain クレート(Rust)で実装する前提で書く。

【書き方】TM からの写し方(何をクラス・フィールド・関係線にするか)、線の種類と向き、多重度、端点の指定、配置の手調整と確かめ方は `classDiagramGuide.ts` にまとめてある(画面では `/class-diagram` の「クラス図の書き方」タブ)。
ここには、このモデル固有のこと(スコープ、TM との違い)だけを書く。

【スコープ】TM の「実行環境」のうち PC・ユーザー(第1弾)、Gitリポジトリ(第2弾)、Gitブランチ・ワーキングツリー(第3弾)と、セッション(第4弾)、セッションファイル(第5弾)、ログ行(第6弾。行種別のサブセット4種と、親子のつながりを含む)、Phase 1(app から claude CLI と対話する。issue #381・#388。実行中セッション・権限の問い合わせ・途中経過)と、Phase 2 の設計(#404。現在のモデル・権限モード、リポジトリとの関連、会話ファイル 0..*)、Phase 3 の設計(#434。実行中セッションと worktree の関連)。
設定ファイル類、セッションまわりの残り(入力キュー)、システム行・付帯情報行の細分(TM でサブセットに分ける段階)は次段以降。
既存のクラスとそれらの関係も、相手のクラスを書く段階で足す。
作業ディレクトリは、TM でモノとして立てないことになった(cwd はログ行・実行中セッションの属性。tm.ts 冒頭の【作業ディレクトリを立てない】)ため、クラスにしない。

【TM との違い・未決】
- ログ行まわりのクラス名は TM の物理名から変えている(ChainLine → LogLine、UserLine → UserLogLine、AssistantLine → AssistantLogLine、SystemLine → SystemLogLine、AttachmentLine → AttachmentLogLine)。
  同じ図に載せている SessionLine の図(Labo。native の session_line.rs の型を写したもの)と、native の domain クレートの既存の型に同じ名前があり、図でも実装でも名前がぶつかるため。
  再帰表 ChainLineRecursion(ログ行．ログ行)はクラスにせず、LogLine のフィールド(`parent_uuid` / `logical_parent_uuid`)に含めている。
- TM の「セッション 1 : ログ行」(所属)は線を描かない。
  ログ行は SessionFile が所有し、SessionFile は Session が所有するので、行のセッションは所有の木でたどれる(持ち主は 1つだけ)。
  サブエージェントのファイルの行も、親のセッションが所有するファイルに属するので、行に記録される sessionId(親と同じ値)と食い違わない。
- TM の `fileKind`(ファイル種別)は SessionFile のフィールドにしない。
  Session が会話ファイル(`conversation_files`、0..*)とサブエージェントのファイル(`subagent_files`、0..*)を別の役割で持ち、どちらに入っているかで種別が決まるため。
- 会話ファイルは当初 1件固定(`conversation_file`)にしていたが、実機確認でセッション途中に worktree へ移動すると、同じセッションIDの jsonl が複数のプロジェクトフォルダに分かれてできることが判明した(#214)。
  TM どおり `conversation_files` を 1..* に直した(#216)。
  複数ファイルにまたがる属性(custom_title 等)の解決規則は図には書かず、実装イシュー側(#217)で扱う。
- 【Phase 2 の設計変更(#404。TM #403)】`conversation_files` を 1..* から 0..* に緩めた。
  新規作成では、セッションID は起動時に決まる(app が `--session-id` で決めることもある)のに、会話ファイルは最初の行が書かれた時点で作られるため、「ID は決まったが会話ファイルはまだ無い」窓がある。
  これで「ファイル0件のセッション」は型で作れるようになる。
  その間の状態は、RunningSessionByApp の process_state(Starting / Idle)で表す。
  **実装済み**(PR #413。`Session::without_files` / `has_conversation_file`)。
  ファイルの走査から組み立てる `User::load_sessions` は、ファイルのある会話だけを作るので空にならない(ファイルの無い新規の会話は実行中セッションの一覧 = RunningSessionSummary に出る)。
- PC とユーザーはコンポジションにしている(PC が全体で User を所有する)。
  User は「その PC 上の OS のユーザーアカウント」で、1台の PC にしか属さない。
  同じ人が2台の PC を使えば User は2つになる。
  TM ではユーザーを PC から独立したリソースとし、対照表「PC．ユーザー」で多対多にしているので、ここは TM と違う。
  TM 側(Data セッション)に合わせてもらうなら、ユーザーの個体指定子を システムUUID(R) + ユーザーID にし、対照表「PC．ユーザー」をやめる形になる。
  これにより、以前ここで未決にしていた「`home_directory` は PC ごとに違いうる」問題は解消する(User が PC ごとのアカウントなので、User の属性でよい)。
- Gitリポジトリは PC ではなく User が所有するコンポジションにしている(User は PC 上のアカウント)。
  TM では Gitリポジトリを PC と対照表「PC．Gitリポジトリ」で多対多にしているので、ここは TM と違う。
  同じリポジトリを別の PC(別のアカウント)にクローンすれば、それぞれが別の GitRepository になる。
  TM 側に合わせてもらうなら、Gitリポジトリをユーザーに属させ(個体指定子に システムUUID(R) + ユーザーID(R) を含める)、対照表「PC．Gitリポジトリ」をやめる形になる。
  これにより、以前ここで未決にしていた「同じリポジトリでも置き場所のパスが PC ごとに違いうるので、`repository_path` では PC をまたいで同じリポジトリだと言えない」問題は解消する(クローンごとに別の GitRepository なので、パスで区別してよい)。
- `Profile`(対象リポジトリ・GitHubプロジェクト・対象フォルダの組を名前付きで複数保存できる設定の単位。1ウィンドウ = 1プロファイル。native.md §6)は TM にまだ無い(未整備)。
  ユーザー指示により、実装(`profile.rs`。issue #72)を元に直接追加した。
  以前は `classes-native-prototype.ts` に as-is で載っていたが、こちらへ昇格したので削除した(Pc・User と同じ扱い)。
  TM 側への反映は デザイン(ドメイン:Data) セッションの今後の課題。
- (以下の【Phase 1】の各項は、#388 での設計の記録。実装した結果の差は、最後の【Phase 1: 実装との差】を参照。)
- 【Phase 1】実行中セッション(RunningSession。TM の物理名のまま)は、起動元で分け尽くされるので抽象クラスにし、TM の相違のサブセット(app起動 / 外部起動)を継承で描いた。
  Session との線は、TM の E-R(セッション 1 : 実行中セッション 0..*)を、コンポジションではなく関連にした。
  プロセスの寿命は会話の寿命と別(終わった会話は動いていない。再開すると別のプロセス)で、Session は RunningSession を所有しないため。
  TM の 多値(MO)は、属性が1つだけのピア機能(RunningSessionPeerFeature)は値の列(`peer_features: Vec<String>`)にし、属性が複数ある権限の問い合わせ．提案は、問い合わせが所有する部分のクラス(PermissionSuggestion。0..*)にした。
  名前の重なり: native の app クレートには、#345 の実行中ガードが使う型 `RunningSession`(台帳のパスと PID と根拠。`app/src/lib.rs`)が既にあり、TM の `RunningSession` と別のもの(こちらは domain の型)だった。
  実装(#391)で app 側を `DetectedRunning` に改名して解消した(domain 側は TM の物理名のまま。app 側の型は `classes-infra.ts` にある)。
- 【Phase 1: domain と infra の境界】claude CLI の wire 形式(stream-json の各行:stream_event / system / result / control_request / control_response など)は infra が読む DTO であり、domain には置かない(版で項目が増えるため。未知の type / subtype は捨てる)。
  domain には CLI に依存しない中立の型だけを置く: 途中経過(ProgressEvent)、プロセスの状態(ProcessState)とその遷移契機(ProcessTrigger)、権限の問い合わせ・応答。
  infra が wire → domain に写す。
  ProgressEvent と ProcessTrigger は保存しない(画面へ流す・状態を動かすだけ)ので TM にモノは無く、TM に無い型を置いている。
  CLI の起動・標準入出力・台帳の読み取りといった I/O は port(app)の責務で、この図には描かない(クラスのメソッドは純粋なロジックだけ。状態遷移 `RunningSessionByApp.apply` はその例)。
- 【Phase 1: 入力(送信)】ImageAttachment(#349)は起動したままのプロセスにもそのまま送れる(PoC #382 レポート §6.3。content ブロックが同じ形)。
  テキスト+画像(と、画像の上限・検証)はそのまま使える。
  一方、app の `AgentGateway.send` / `SendRequest`(cwd・本文・画像・モード・再開指定)は、送信のたびに `--resume` で CLI を起動し直す1回きりの送信が前提。
  Phase 1 では RunningSessionByApp の標準入力へ書く形に置き換わるため、実装で見直す(この図には描かない。app の型で、まだ図に無い)。
- 【Phase 1: 表示名・モデル切替・権限モード切替】RunningSession の操作だが、いずれも CLI へのコマンド送信(I/O)なので、メソッドにはせず port の責務にした。
  表示名(`--name`)は属性 `name`(台帳の name。会話タイトルの custom-title にも入る)で足りる。
  モデルと権限モード(default / acceptEdits / plan / dontAsk / bypassPermissions)の現在値は、TM に語彙が無いため属性にしていない(system/init と、切替の応答から分かる)。
  画面で現在値を出す必要があれば、TM(Data セッション)に語彙を足してもらってから属性にする(未決)。
- 【Phase 1: 権限の問い合わせ】問い合わせ種別(`/request_kind`)は TM の(D)なので / を付け、tool_name から求める(実装ではフィールドにしてよい)。
  応答の中身は TM に合わせて平らなフィールド(更新後の入力・拒否メッセージ・更新後の権限)にした。
  決着種別ごとに使うものは決まる(Allow は更新後の入力、Deny は拒否メッセージ、Cancelled はどれも持たない)ので、実装で型に落とすときは、決着種別ごとに持つ値が違うバリアントにしてよい。
  `tool_use_id`(AI応答行の tool_use ブロックを指す)は、ブロックが TM の第2弾でモノになるまで線を引かない。
  台帳のうち app が使わない語彙(ピア関連。peer_token は秘匿)も TM にあるため写したが、Debug やログに値を出さないこと(native.md §4)。
- 【Phase 1: 実装との差(#391。PR #395)】設計を実装した結果、次の点が設計と違う。
  図は実物(`crates/domain/src/`。1型 = 1ファイル)に合わせて描き直し、該当クラスの説明に「実装との差」として理由を残した(11点の判断の全文は PR #395)。
  (1) RunningSession は抽象クラスではなく共通フィールドの struct で、RunningSessionByApp / RunningSessionExternal は継承ではなく `base` で持つコンポジション(Rust に継承が無く、trait だと台帳の語彙の読み出しが全部メソッドになるため)。
  session_id(R)は実装ではフィールド。
  (2) PermissionBehavior は3値ではなく値を持つバリアント(Allow { updated_input,updated_permissions } / Deny { message } / Cancelled)で、PermissionResponse は request_id・behavior・responded_at だけを持つ(「Deny なのに更新後の入力がある」矛盾を型で作れなくするため)。
  (3) PermissionResponse は問い合わせに所有されず、応答の側が request_id で問い合わせを指す(関連)。
  (4) `/request_kind` はフィールドではなくメソッド。
  (5) RunningSessionByApp に、答え待ちの列を動かす receive_permission_request / settle_permission_request / exit が加わった。
  `apply` が process_state_at を記録するのは状態が変わったときだけ。
  (6) PermissionSuggestion に SDK の PermissionUpdate との往復(from_update_value / to_update_value)、PermissionRequestKind に from_tool_name が加わった。
  コンストラクタ(`new` / `allow` / `deny` / `cancelled`)は図に描いていない。
- 【Phase 2(複数セッション・モード切替・新規作成。issue #381・#404・#407・#414。TM #403)】**実装済み(PR #413)。
  ** domain の変更3つ(Session.conversation_files を 0..*、RunningSessionByApp に現在のモデル・現在の権限モード、リポジトリパス(R))は、この図に実物どおり描いた。
  複数の実行中セッションを同時に持つことは、TM の「セッション 1 : 実行中セッション 0..*」と起動元のサブセットで既に表せていて、同時に持てる数の上限は運用の方針(語彙でも domain の規則でもない。app の定数 MAX_RUNNING_SESSIONS = 24。issue #453 で 8 から引き上げ)。
  表示名は TM の語彙(会話タイトル・台帳の name)で足りる。
  domain の ProgressEvent は変えていない。
- 【Phase 2 の申し送り(app 側の型)= 実装済み(PR #413)】#404 で申し送った app / tauri の型(複数保持・切り替え要求・再開/新規の起動要求・途中経過の宛先の包み・ハブ用の一覧項目)は実装された。
  as-is は `classes-infra.ts`(app の型・port と infra の実装)と `classes-tauri.ts`(DTO・状態)を参照(実装の結果、申し送りと違う所は各図の説明に書いた)。
  実装で加わった主なもの: 起動要求は enum(Resume / New)に加えて、画面から来る値だけの ResumeRunningSession / CreateRunningSession、出来事の Configured / SwitchApplied、宛先付きの AddressedRunningSessionEvent、一覧項目の name(新規の直後は会話タイトルがまだ無いため)。
  1回きり送信(AgentGateway / --print)は #392 で撤去された。
- 【Phase 3(worktree の用意。issue #381・#434・#441。TM #430)】**実装済み(PR #440。issue #437)。
  ** app が「このリポジトリの、このブランチの worktree」を用意して、そこを cwd に CLI を起動する段。
- RunningSessionByApp に `worktree_id`(TM: ワーキングツリーID(R))を足し、GitWorktree と結んだ(GitWorktree 1 : RunningSessionByApp 0..*)。
  app が起動時に worktree を選ぶので、cwd からの推測ではなく記録された事実になる。
  GitWorktree の個体指定子はワーキングツリーID + リポジトリパス(R)の組で、リポジトリパス(R)は GitWorktree を所有する GitRepository(線 worktrees)の個体指定子と同じ。
  RunningSessionByApp の `repository_path` は、その組の片方(worktree を指す鍵の一部)として残る。
- **Phase 2 で張っていた GitRepository との関係は、関連としては外した**(worktree が決まればリポジトリも決まるので、導出できる関係を重ねて張らない。リポジトリへは GitWorktree 経由でたどる)。
  ただし Phase 2 では `repository_path` のフィールドで表していたので、図の上で外れるのは説明(関連であること)だけで、フィールドは残る。
  git ではリポジトリ本体のディレクトリも1つ目の worktree なので、worktree を作らずに本体で起動する場合も同じ関係で表せる。
- **線で描かず、フィールド(worktree_id と repository_path)で持つ**。
  #404 と同じ規則(交差を避ける優先)で、GitWorktree(図の上部)と RunningSessionByApp(図の下部)が離れていて、線を引くと Profile・SessionFile・LogLine 系の箱と継承線を横切るため。
  図の配置を見直せるなら、線に改める(未決)。
- ブランチの指定は既存の語彙で足りる(新しい属性・クラスは無い)。
  GitWorktree と GitBranch は関連(GitWorktree → GitBranch の checked_out_branch)で結んであり、「このブランチの worktree」はそれをたどれば決まる(detached HEAD は checked_out_branch が None)。
  worktree の作成・最新化の記録(作成日時・削除日時は GitWorktree の created_at_time / deleted_at_time が持つ。最終 merge の時刻などは Git 自身の履歴から分かる)も足さない。
- **役割(セッションの雛形。名前・固定ブランチ・表示名・権限モード・モデル)は立てない**(TM の判断。ユーザー決定)。
  CLAUDE.md に書かれた運用の方針であって、app が管理する対象ではないため。
  起動時に決まった値は、RunningSessionByApp の既存の属性(worktree_id・現在の権限モード・現在のモデル)と、台帳の名前に記録される。
  不採用の案は tm.ts の【Phase 3】を参照。
- 【Phase 3 の申し送り(app 側の型)= 実装済み(PR #440)】起動要求への worktree の指定・worktree を用意する port とユースケース・セッション間メッセージ対応(表示名の一意化・CLI の版)は実装された。
  as-is は `classes-infra.ts`(app の型・port と infra の実装)と `classes-tauri.ts`(DTO)を参照(実装の結果、申し送りと違う所は各図の説明に書いた)。
  実装で加わった主なもの: 起動要求は enum(Resume / New)の値に `worktree_id`、画面から来る値だけの ResumeRunningSession / CreateRunningSession に、用意済みの worktree(ResolvedWorktree)。
  指定は WorktreeSpec(main / existing / branch)で、パスは app が決める。
  port は GitWorktreeManager(実装は SystemGitWorktreeManager)。
- 【Phase 3 で domain に加わった小さなもの(PR #440)】(1) **予約の worktree_id**: git ではリポジトリ本体のディレクトリも1つ目の worktree だが、台帳(GitWorktree)は本体を記録しない(issue #193)ので台帳に ID が無い。
  本体で起動したセッションの `worktree_id` には `MAIN_WORKTREE_ID`("main-worktree")、リポジトリの worktree のどれでもない場所(既存の会話の cwd がリポジトリの外など)で起動したときは `OUTSIDE_WORKTREE_ID`("outside-repository")を入れる。
  定数なので図には描かない。
  (2) **セッション間メッセージの表示**: 会話の表示用の Message に `kind`(MessageKind。通常 / 受信 / 送信 / 送信の結果)が加わった(`classes-native-prototype.ts`。会話ファイルは書き換えず、表示のための見分け)。
  user 行の `origin`(UserOrigin。`kind: "peer"` が他のセッションからの受信)は session_line/ の JSONL 行の読み取り用の型なので、他の session_line/ の型と同じく図には描かない。
  行から Message を取り出す関数(extract.rs)も関数なので描かない。

#### 層の既定とそのほかの記録(移行前はファイルの本体に書いていた)

既定は企業のビジネスルール(TM を元にしたドメインの型)。
アプリ固有のものだけ layer を書く。
全24クラスが実装済み(Pc・User(第1弾)・GitRepository・GitBranch・GitWorktree(第2〜3弾)・Session(第4弾)・SessionFile(第5弾)・LogLine・UserLogLine・AssistantLogLine・SystemLogLine・AttachmentLogLine(第6弾)・Profile(classes-native-prototype.ts から昇格)・Phase 1 の11クラス(issue #388 で設計、#391 で実装))。
すべて filePath を持つ。
Phase 1 の型は、実装の結果、設計と形が違う所がある(冒頭の【Phase 1: 実装との差】)。

### domain クレートの as-is(group: native-prototype)

apps/native の domain クレート(`crates/domain/src/`)に実装済みの、まだオブジェクトモデル(`classes-domain.ts`)へ置き換えられていない型(プロトタイプ期の型)のクラス図。

【目的】`classes-domain.ts` は TM を元にした設計側の図で、まだ実装されていない型も含む。
こちらは逆に、domain クレートに現に実装されている型を、コードと1対1で対応する形でそのまま写した図("as-is" のスナップショット)。
フィールド・型は Rust のソースをそのまま書き写し、意味づけの解釈は加えない。

【書き方】
- フィールドは Rust の宣言順・型をそのまま `attr()` に写す。
- フィールドの型が図中の別のクラス(enum を含む)を指すときだけ関係線を引く。
- 必須(`Option` でない)・単数(`Vec`/`HashMap` でない)の struct/enum フィールド → コンポジション(その型を値として持つ。ラベルはフィールド名)。
- `Option<T>`、`Vec<T>`、`HashMap<K, T>` の struct/enum フィールド→ 関連(ラベルはフィールド名)。
- `String`・`PathBuf`・`Value`・プリミティブ型のフィールド(`*_id: String` のような、意味的には他の型を指すが Rust の型としては単なる文字列のフィールドを含む)は関係線を引かない。
  コードにそのまま対応させるため、型注釈からは読み取れない関係(IDによる参照など)を図だけの判断で描き足さない。
- `session_line/`(旧 `classes-session-line.ts`。図は削除済み)と違い、tag 付き enum のバリアント分岐(依存関係)は無い(該当する型が無いため)。

【対象・ファイル対応】native.md §1 の「1型(クラス)= 1ファイル」(issue #184、PR #185)により、domain クレートは各型が型名 snake_case のファイルに分かれている(例: `Settings` → `settings.rs`)。
`lib.rs` は `mod` 宣言と `pub use` のみ。
本図の42クラスのうち、`ProjectItemKind` は `ProjectItem` と同じ `project_item.rs` に、`ClaudeDirEntryKind` は `ClaudeDirEntry` と同じ `claude_dir_entry.rs` に、`GitRepositoryLedger` は `GitLedger` と同じ `git_ledger.rs` に、`ObservedWorktree` は `ObservedGitState` と同じ `observed_git_state.rs` に、`MessageStatus` は `Message` と同じ `message.rs` に、`ImageMediaType`・`ImageAttachmentError` は `ImageAttachment` と同じ `image_attachment.rs` に同居する(native.md 曰く「その型専用の小さな補助enum」だが、補助structも同じ扱いにしている。なお `ImageMediaType` は `ImageAttachment` と `MessageImage` の両方から使われるため、「専用」には厳密には当たらない。図は実物のファイル対応どおりに描いた)。
ほかの35 クラス(`MessageKind` は `message_kind.rs`、復元の2型は `restorable_running_session(s).rs`)はそれぞれ単独のファイル(型名 snake_case)。
掲載対象は `classes-domain.ts` に掲載済みの Pc・User・Profile と、`session_line/`(34型。かつては `classes-session-line.ts` で描いていたが、不要になったため図ごと削除した)を除いたもの。

【GitBranch・GitWorktree への参照】`GitRepositoryLedger.branches`/`worktrees` は `classes-domain.ts` のオブジェクトモデル側のクラス(`GitBranch`・`GitWorktree`)を指す。
図の離れた位置にあり線を引くと長く伸びるため、`AppState.settings` 等と同じ方針で線は引かない(属性の型名だけで分かるようにする)。

【Conversation(旧 Session)】オブジェクトモデル実装 第4弾(issue #197、PR #199)で、クラス図のオブジェクトモデル側の `Session`(セッションリソース。session_id/custom_title/ai_title/mode/slug/last_prompt)が `session.rs` に実装され、`User` にコンポジションで所有されるようになった(`User.sessions`)。
これに伴い、このプロトタイプ側の型(id/messages/agent。ビューアに表示する会話内容そのものの入れ物)は名前がぶつからないよう `Conversation` に改名された(`conversation.rs`)。
以前はここを `SessionPrototype` という表記で描いていたが、実装側の改名で本来の型名のまま描けるようになったため、この図でも `Conversation` に改めた。
第5〜6弾(SessionFile/LogLine)の実装後、ビューアがそちらのモデルへ移行すれば、この型と `Message` は退役する見込み。

【Profile】ユーザー指示により `classes-domain.ts` へ `Profile` を追加したため、このプロトタイプ側からは削除した(Pc・User と同じ扱い)。
`Settings.profiles` は `Profile` 型そのものを指すが、図の離れた位置にあるため線は引かない(`GitRepositoryLedger.branches`/`worktrees` と同じ方針)。
`GithubProject`・`GithubProjectSummary` はまだ `Profile` の実装をそのまま写したこの図側に残す(`Profile.github_project` からも同じ方針で線を引かない)。

【ScannedLine】`session_line/scanned_line.rs`(issue #302・#308)。
`session_line/` の34型は図から外しているが、`ScannedLine` は実装済みの domain の型で、走査(.jsonl 全行の読み取り)が実際に使うため、この図に1つだけ載せる(「session_line 群の近く」に置く先は無いので、独立した節にした)。
- フィールド `line: SessionLine` は private。
  宣言をそのまま写す方針なので属性として描き、可視性は `-` で表す。
  `SessionLine` は図に無いので線は引かない。
- メソッド(`parse` と、`SessionLine` から値を取り出すだけの `session_id`・`cwd`・`git_branch`・`slug`・`custom_title`・`ai_title`・`mode`・`last_prompt`・`message`・`user_message_text` 等)は描かない。
  この図はフィールドを写す図で(メソッドを載せるのはオブジェクトモデルと port(infra の図)だけ)、これらは `extract_*` と同じ値を返すだけの薄い取り出し口であり、型の形を決めるのは private な `line` 1つのため。
  一覧は説明(description)に書いた。

【Phase 1 の型(実行中セッション・権限・途中経過)】#391 で domain クレートに実装された 11型(`RunningSession` など。`running_session.rs`・`permission_*.rs`・`progress_event.rs`・`process_*.rs`)は、この図には描かず、`classes-domain.ts` に載せている(#388 の設計と同じ名前で、`mergeDiagrams` はクラス名の重複を許さないため。Pc・User・Profile と同じ扱い)。
設計と実装の差は、`classes-domain.ts` の冒頭【Phase 1: 実装との差】と各クラスの説明に書いた。
app・infra・tauri 側の型は `classes-infra.ts`・`classes-tauri.ts` にある。

【ParsedSession】`parsed_session.rs`(issue #208・#214・#217)。
`User::load_sessions`(オブジェクトモデル側。`classes-domain.ts`)への入力で、`GitLedger` の `ObservedGitState` と同じ「ただの運搬型」。
`ScannedLine` と同じ節に置く(走査からセッション組み立てまでの一連の型のため)。

#### 層の既定とそのほかの記録(移行前はファイルの本体に書いていた)

既定はアプリケーションのビジネスルール(ユースケースの入出力・アプリ固有の状態)。
それ以外のものだけ layer を書く。

### app の port と infra の実装(group: infra)

apps/native の infra クレート(`crates/infra/src/`)に実装済みの型と、それが実現する app クレートの port(trait、`crates/app/src/lib.rs`)のクラス図。
`classes-native-prototype.ts`(domain クレートのプロトタイプ期の型)と同じ「実装の as-is スナップショット」の書き方を踏襲する。

【目的】infra は「ports & adapters」の adapter 側にあたり、各型は app の port(trait)を1つ実装する(SessionWatcher を除く。後述)。
port をインターフェースとして図に載せ、実現(realization)の線で結ぶことで、どの実装がどの port を満たしているかを図から読めるようにする。

【書き方】
- infra の struct はフィールドをそのまま `attr()` に写す(書き方は `classes-native-prototype.ts` と同じ基準)。
  フィールドの型に他クラスへの参照は無い(String・PathBuf・外部ライブラリの型のみ)ため、コンポジション・関連の線は引かない。
- app の port(trait)は `stereotype: "interface"` にし、メソッドを `method()` で写す。
  引数は `&self` を除く Rust の宣言どおり、戻り値型も宣言どおり(`domain::` の有無も含め、トレイト定義の実物と一致させる)。
- 実現(realization)の線は「実装 → port」の向き(三角が port 側に付く。継承と同じ記法で、線だけ破線になる)。
  ラベルは付けない。
- `impl <Trait> for <型>` を実際に読んで対応を確認した(型名からの推測はしない)。
  1型につき実装する port はちょうど1つで、1対1に対応する。

【SessionWatcher】trait を実装する構造体ではなく、`session_source.rs` の `pub type SessionWatcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;` という型エイリアス(`FileSystemRepository::watch_projects` の戻り値)。
実現の線は引かず、`stereotype: "type alias"` として `FileSystemRepository` の隣に置く。

【対象・ファイル対応】infra クレートは domain と違い、まだ1型=1ファイルに揃っている(型名 snake_case のファイル。例外: `FileClaudeDirStore` は `claude_dir_store.rs`、`SessionWatcher`/`FileSystemRepository` は `session_source.rs` に同居(`SessionFileRef`・`SessionFsChange` も同じ)、`ClaudeCliProcess`・`ExitSignal` は `ClaudeCliProcessLauncher` と同じ `claude_cli_process.rs` に同居)。
infra の型 31個(port を実装するもの25 + port を実装しない補助の型6: `SessionWatcher`・`SessionFileRef`・`SessionFsChange`・`GithubAuthLog`・`ExitSignal`・`PendingSwitches`)と、app の port 26個を載せた(1回きり送信の `AgentGateway`・`ClaudeCliAgent` は #392 で撤去。`GitWorktreeManager`・`SystemGitWorktreeManager` は #441(Phase 3。PR #440)、`RestorableRunningSessionsStore`・`FileRestorableRunningSessionsStore` は #465(実行中セッションの復元。issue #459。PR #463)、`LocalApiPortStore`・`FileLocalApiPortStore` は #470 で追加。`ViewerTabsStore`・`FileViewerTabsStore`(#420 で追加)は、ビューアのタブの並びの保存・復元そのものの廃止(issue #489。PR #490)で撤去された。`ArchivedSessionsStore`・`FileArchivedSessionsStore` は #494 で追加)。

【セッションのアーカイブ(issue #494。PR #497)】会話ファイルは消さず、一覧から隠してプロセスを止める印(`domain::ArchivedSessions`。`classes-native-prototype.ts`)を `app_data_dir/archived-sessions.json` へ保存する port `ArchivedSessionsStore`(実装 `FileArchivedSessionsStore`)が加わった。
印の読み書き(`archive_session` / `unarchive_session` / `load_archived_sessions`)は関数なので描かない。
実行中プロセスを先に止める処理は `AppState`(ランタイム状態)を見る必要があるため tauri 層の責務(native.md §1)。
復元の入り口(`sessions_to_restore`)も印を受け取って除外するようになった(関数)。

【実行中セッションの復元(issue #459。PR #463)】app の起動時に前回動かしていたセッションを再開するため、再開に必要な指定(`domain::RestorableRunningSessions`。`classes-native-prototype.ts`)を `app_data_dir/running-sessions.json` へ保存する port `RestorableRunningSessionsStore`(実装 `FileRestorableRunningSessionsStore`)と、覚えていた1件を起動の指定へ組み立てた `PlannedRestore` が加わった。
覚える・忘れる・組み立てる(`remember_running_session` / `forget_running_session` / `plan_restore` / `sessions_to_restore` / `ensure_restorable_conversation`)は関数なので描かない。

【セッションの表示名の変更(issue #523。PR #525)】`SessionSource` に `append_custom_title` が加わった。
この port で唯一の書き込みで、会話ファイルを**置き換えず追記する**(理由は `FileSystemRepository` の説明を参照)。
ユースケース `rename_session`(`rename_session.rs`)と command `rename_session` は関数なので描かない。
あわせて、`SessionSource` のメソッド一覧を実物にそろえた(`session` / `latest_session_id` / `latest_session_cwd` は実装側で `read_session` / `session_fingerprint` / `session_cwd` / `list_parsed_sessions` / `session_line_raw` に置き換わっていたが、図が追従していなかった。#400 の突き合わせは型の名前・フィールド中心で、port のメソッド一覧は対象外だった)。

【port のメソッド一覧の突き合わせ(issue #528)】#400 の突き合わせは型の名前・フィールド中心で、port のメソッド一覧は対象外だった(そのため `SessionSource` のずれが #523 まで残っていた)。
port 26 個のメソッドを名前・引数・戻り値まで実物と突き合わせ、`HubTuningStore` の型名(`domain::HubTuning` → 宣言どおりの `HubTuning`)を直した。
ほかの 25 個は一致していた。
メソッドを描いている struct / enum 13 個も名前で突き合わせ、`StartModel` の `from_cli_value`(#459 の復元で加わった逆写像)の漏れを足した。

【app の port の入出力の型(issue #420)】方針: app の非 port の型は、port のシグネチャ(引数・戻り値・エラー)に出てくるものだけを載せる(層はアプリケーションのビジネスルール)。
載せたもの: `AppError`(ほぼすべての port のエラー)・`FileFingerprint`・`SessionContent`(`SessionSource`)・`LoadedSettings`(`SettingsStore`)・`ProjectSettingsFile`(`ProjectSettingsStore`)・`DeviceAuthorization`・`PollResult`・`GithubViewer`(`GithubGateway`)。
Phase 3(worktree の用意。PR #440)の `worktree.rs` の型 `WorktreeSpec`・`WorktreeEntry`・`MergeOutcome`・`PreparedWorktree`・`ResolvedWorktree`・`WorktreeIndex` は、port(`GitWorktreeManager`)と起動要求の入出力なので載せた。
`cli_version.rs`(`MIN_PEER_MESSAGING_VERSION` と版の判定の関数)は型を持たず、定数と関数だけなので描かない。
これに加えて、tauri 層の `AppState` が持つ `CachedMessages`・`RescanQueue`・`WindowRegistry`(tauri 図から参照される型)も載せた。
**載せないもの(理由)**:
- ユースケースの戻り値のための型: `OpenedSession`・`ReloadedSession`・`SessionDisplayHint`・`ReconcileGitLedgerResult`・`BuildUserSessionsResult`・`ViewerCheckOutcome`(関数の結果であって、port の入出力でも状態でもない。関数は図に描かない)。
- 型エイリアス `NowMs`(= u64)。
- infra の private な型: `DeviceCodeResponse`(GitHub の応答の読み取り用)・`LedgerEntry`・`ProcessProbe`(実行中セッションの台帳の読み取り・生存確認)・`SessionCwdSelector`・`CachedSessionSummary`(セッション走査の内部)・`LegacySettingsRaw`・`SettingsV4Raw`・`SettingsV5Raw`・`SettingsV6Raw`(設定ファイルの旧版の読み取り = マイグレーション用)・`GitOutput`(git コマンドの出力の入れ物。`git_worktree_manager.rs` の内部)。
  wire / ファイル形式の写し(serde)で、外から見える構造ではない。
  `ExitSignal` は複数の型が共有するため例外として載せている。
- domain クレートの `session_line/`(34型。JSONL 行の読み取り用。`classes-native-prototype.ts` の説明を参照)と、`LogLineBase`(`LogLine` の共通属性を Rust では埋め込み struct にしたもの。`classes-domain.ts` の `LogLine` の属性として描いている)・`LogLineConversionError`(JSONL 行 → `LogLine` の変換関数のエラー)。

【実行中セッション(Phase 1。issue #391)】`RunningSessionSource`(#361 のガード。`exclude_pids` が加わった)・`RunningSessionLauncher`・`RunningProcess`・`RunningSessionEventSink` の4 port と、その実装を載せた。
`ExitSignal`(private)は `ClaudeCliProcess` が共有する終了の合図で、port を実装しない補助の型。
port の入出力の app の型(`StartRunningSession`・`RunningPermissionMode`・`StartedRunningSession`・`RunningSessionEvent`・`PermissionDecision`・`DetectedRunning`・`RunningEvidence`。Phase 2 の分は下の【Phase 2】)は、app の非 port の型は基本的に載せない方針だが、port のシグネチャに出てくるので例外として載せた(層はアプリケーションのビジネスルール)。
`RunningSessionEventSink` の実装(`ChannelSink`)は tauri 層(`classes-tauri.ts`)で、実現の線は引かない。
`claude_stream_json.rs`(起動引数・標準入出力の JSON 行・wire → domain の写し)は、型(struct / enum)を持たず関数だけ(wire は `serde_json::Value` から取れるものだけを取り出す。未知の type / subtype と必須項目の欠けた行は捨てる)なので、クラスとしては描かない。

【実行中セッション(Phase 2。issue #407。PR #413)】複数の実行中セッション・新規作成・モデル / 権限モードの切り替え・画面ごとの購読を足した。
`StartRunningSession` は struct から enum(Resume / New)になり、画面から来る値だけの `ResumeRunningSession` / `CreateRunningSession` が加わった(起動のユースケースは `resume_running_session` / `create_running_session` に分かれた。関数なので図には描かない)。
切り替え(`RunningSessionSwitch`)は port(`RunningProcess`)の `set_model` / `set_permission_mode` で、infra の `PendingSwitches` が要求と応答を対応づける。
出来事に `Configured` / `SwitchApplied`、途中経過に宛先を付ける包み(`RunningSessionRef` / `AddressedProgress` / `AddressedRunningSessionEvent`)、ハブ用の一覧項目 `RunningSessionSummary`(`summarize` で作る)も app の型。
定数(`MAX_RUNNING_SESSIONS`= 24(issue #453 で 8 から引き上げ)/ `MAX_KEPT_EXITED_SESSIONS` = 10)は型ではないので描かない。
Phase 3(worktree の用意・セッション間メッセージ対応。issue #437。PR #440)で、起動要求に `worktree_id`(Resume / New の値)と、画面から来る値だけの `ResumeRunningSession` / `CreateRunningSession` に用意済みの worktree(`ResolvedWorktree`)が加わり、worktree を用意する port `GitWorktreeManager`(実装 `SystemGitWorktreeManager`。`git worktree add` / `git fetch` / `git merge`。用意のユースケース `prepare_worktree` は関数なので描かない)、`RunningSessionLauncher` の `cli_version`(起動する claude の版)、`RunningSessionSource` の `taken_names`(台帳の名前。表示名の一意化 `unique_session_name` は関数)、`RunningSessionSummary` の版の項目、`AppError` の `WorktreeSyncFailed` が加わった。
起動時の `--settings`(`PEER_SETTINGS`。セッション間メッセージの受信を受け入れる)は定数なので描かない。
起動時のモデルの指定(issue #445。PR #446)で、起動要求(Resume / New の値、`ResumeRunningSession` / `CreateRunningSession`)に `model`(`StartModel`。別名 opus / sonnet / haiku。「既定」は None)が加わった。
CLI への `--model` の引数の組み立ては関数なので描かない。
再開時の表示名の初期値(issue #447。PR #450)のための `SessionSummary.custom_title` は `classes-native-prototype.ts` にあり、infra の `session_source.rs` がそれを読み取る(関数。型は増えていない)。
ビューア(issue #409。PR #418)で、CLI が `initialize` の応答で報告する選べるモデル `AvailableModel` と、出来事 `ModelsListed` が加わった(状態は動かさない)。

【GitLedgerStore・GitStateSource への参照】メソッドの戻り値・引数に出てくる `domain::GitLedger`・`domain::ObservedGitState` は、`classes-native-prototype.ts` に載っているクラス(`GitLedger`・`ObservedGitState`)だが、別の図の離れた位置にあるため、ほかの `domain::` 参照と同じ方針で線は引かない。

#### 層の既定とそのほかの記録(移行前はファイルの本体に書いていた)

port(interface)は app クレートが定義するのでアプリケーションのビジネスルール、それを実装する型はインターフェイスアダプター。
それ以外のものだけ layer を書く。

### tauri クレートの as-is(group: tauri)

apps/native の tauri クレート(`crates/tauri/src/`。ディレクトリ名は `tauri` だが実体はアプリの薄い境界層)に実装済みの型のクラス図。
`classes-native-prototype.ts`・`classes-infra.ts` と同じ「実装の as-is スナップショット」の書き方を踏襲する。

【対象】
- `dto.rs`: フロント(React)へ渡す DTO(実行中セッション分を含む)。
  native.md §3.1 により、command の戻り値は必ず DTO で、`domain`/`app` の型に `Serialize` を付けて直接返さない(型注釈のとおり、DTO は `domain`/`app` の型と1対1で対応することが多いが、フィールドを絞る・別名にする等の違いがある)。
- `state.rs`: `AppState`(アプリの唯一の真実、native.md §2)・`LoadResult`。
  実行中セッション(issue #391)の `RunningSessionSlot`(`AppState.running_session` に入る)も同じファイル。
- `local_api.rs`: ローカルAPIサーバ(native.md §7)のハンドラが使う3型。
  `pub` が付いていない(モジュール内だけで使う)。
- `running_session.rs`: 実行中セッションの command 群(関数なので図には描かない)と、`RunningSessionEventSink` の実装 `ChannelSink`(private)。
- `session_scan_queue.rs`: 走査キューの `ScanProgressDto`・`RescanOutcome`(どちらも private)。
- `lib.rs` の `WatcherSlot`(private な型エイリアス。`Mutex<Option<infra::SessionWatcher>>`。ファイル監視の保持先で、Tauri の管理状態)は、`SessionWatcher`(`classes-infra.ts`)を包むだけの別名なので載せない(issue #420)。

【実行中セッション(Phase 2。issue #407。PR #413)】`AppState.running_session`(1つ)は `running_sessions`(複数)になり、`RunningSessionSlot` は購読(`ProgressSubscriber`)を持つ。
DTO は宛先(`RunningSessionRefDto`)を取る command の入出力と、途中経過の包み(`AddressedProgressDto`)、ハブの一覧項目(`RunningSessionSummaryDto`)、起動・切り替えの引数(`StartRunningSessionDto`・`RunningSessionSwitchDto`)が加わった。
1回きり送信の `AgentModeDto` は #392 で撤去された。

ビューア(issue #409。PR #418)で、選べるモデルの一覧(`AvailableModelDto`。`RunningSessionSlot` と `RunningSessionDto` が持つ)が加わった。
domain は変わっていない。

【実行中セッション(Phase 3。issue #437。PR #440)】起動の引数(`StartRunningSessionDto`)に、どの worktree で起動するか(`WorktreeSpecDto`。パスは含まない)と、起動前の最新化の有無が加わった。
実行中セッションの DTO に、起動した worktree の ID と、CLI の版・セッション間メッセージに使える版か(警告文を含む)が加わった(`RunningSessionDto` / `RunningSessionSummaryDto`)。
会話の表示用の `MessageDto` に、セッション間メッセージの見分け(`MessageKindDto`)と相手の名前・送信の成否が加わった。
エラーコード `worktree_sync_failed` は `AppError` の変換(関数)なので描かない。

起動時のモデルの指定(issue #445。PR #446)で `StartModelDto` が、再開時の表示名の初期値(issue #447。PR #450)で `SessionSummaryDto.custom_title` が加わった。

実行中セッションの復元(issue #459。PR #463)で、`app:warning` の `AppWarningEventDto` と、設定の `restore_running_sessions`(`SettingsDto` は bool、`SettingsInputDto` は Option = 省略で「変えない」)が加わった。
`StartModelDto`・`WorktreeSpecDto` は、復元のために app → DTO の向きの変換も持つようになった(変換は線では結ばない)。

【実物との突き合わせ】`tauri/src/*.rs` の struct / enum を、この図と名前・フィールド・バリアントで突き合わせた(issue #400)。

ビューアのタブの並びの保存・復元の廃止(issue #489。PR #490)で、`ViewerTabsChangedEventDto` は撤去され、`ViewerTabDto` は `ViewerTargetDto` に改名された(開く・前面化・移動の指定として残った)。

セッションのアーカイブ(issue #494。PR #497)で、`SessionSummaryDto`・`SessionDto` に `archived: bool` が加わった(どちらも command が `archived-sessions.json` 由来の印を差し込む)。
command の `archive_session` / `unarchive_session`(`running_session.rs`)は関数なので描かない。

【書き方】`classes-native-prototype.ts` と同じ基準。
- フィールドの型がこの図の中の別のクラス(enum を含む)を指すときだけ関係線を引く(必須・単数 → コンポジション、`Option`/`Vec`/`HashMap` → 関連)。
- `AppState.settings`(`domain::Settings`)・`AppState.pc`(`domain::Pc`)・`AppState.user_sessions`(`Vec<domain::ParsedSession>`)は、それぞれ `classes-native-prototype.ts`・`classes-domain.ts` に載っている実在のクラスだが、別の図の離れた位置にあり線を引くと図をまたいで長く伸びるため、線は引かない(属性の型名にそのまま `domain::` を残して分かるようにする)。
  `AppState.window_states`(`app::WindowRegistry`)・`AppState.loaded_messages`(`app::CachedMessages`)・`AppState.session_rescan`(`app::RescanQueue`)は `classes-infra.ts`(app の型)に、`AppState.git_ledger`(`domain::GitLedger`)は `classes-native-prototype.ts` に載っているが、別の図の離れた位置にあるため、同様に線を引かない(issue #420 で、以前「どの図にも無い」としていたものを infra 図へ載せた)。
- `From<domain::X>`/`From<app::X>` の実装(DTOへの変換)がある型は、対応するクラスをコメントに書いた(`classes-native-prototype.ts`・`classes-infra.ts` に同名 + `Dto` を外した名前で載っている)。
  線では結ばない(変換であってフィールドの型ではないため。冒頭の書き方の基準を参照)。
- `SessionDto` は issue #197(第4弾)で入れ替わっている。
  旧 `SessionDto`(会話内容 = id/messages/agent)は `ConversationDto` に改名され(`domain::Conversation` から変換)、`SessionDto` という名前はクラス図の `Session`(session_id/custom_title/ai_title/mode/slug/last_prompt。`domain::Session` から変換)に付け替わった。
  この図でも同じ名前の入れ替えを反映している。

#### 層の既定とそのほかの記録(移行前はファイルの本体に書いていた)

既定はインターフェイスアダプター(DTO・コマンドの入出力)。
Tauri 本体に属する状態などだけ layer を書く。
