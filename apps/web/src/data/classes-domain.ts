/**
 * YAOYOROZU のドメインのオブジェクトモデル。
 *
 * データモデル(TM、`tm.ts`)を元に起こし、apps/native の domain クレート(Rust)で実装する
 * 前提で書く。
 *
 * 【書き方】TM からの写し方(何をクラス・フィールド・関係線にするか)、線の種類と向き、
 * 多重度、端点の指定、配置の手調整と確かめ方は `classDiagramGuide.ts` にまとめてある
 * (画面では `/class-diagram` の「クラス図の書き方」タブ)。ここには、このモデル固有の
 * こと(スコープ、TM との違い)だけを書く。
 *
 * 【スコープ】TM の「実行環境」のうち PC・ユーザー(第1弾)、Gitリポジトリ(第2弾)、
 * Gitブランチ・ワーキングツリー(第3弾)と、セッション(第4弾)、セッションファイル
 * (第5弾)、ログ行(第6弾。行種別のサブセット4種と、親子のつながりを含む)、
 * Phase 1(app から claude CLI と対話する。issue #381・#388。実行中セッション・権限の
 * 問い合わせ・途中経過)と、Phase 2 の設計(#404。現在のモデル・権限モード、リポジトリとの関連、
 * 会話ファイル 0..*)。設定ファイル類、セッションまわりの残り(入力キュー)、
 * システム行・付帯情報行の細分(TM でサブセットに分ける段階)は次段以降。既存のクラスと
 * それらの関係も、相手のクラスを書く段階で足す。
 * 作業ディレクトリは、TM でモノとして立てないことになった(cwd はログ行・実行中セッションの
 * 属性。tm.ts 冒頭の【作業ディレクトリを立てない】)ため、クラスにしない。
 *
 * 【TM との違い・未決】
 * - ログ行まわりのクラス名は TM の物理名から変えている(ChainLine → LogLine、UserLine →
 *   UserLogLine、AssistantLine → AssistantLogLine、SystemLine → SystemLogLine、
 *   AttachmentLine → AttachmentLogLine)。同じ図に載せている SessionLine の図(Labo。native の
 *   session_line.rs の型を写したもの)と、native の domain クレートの既存の型に同じ名前があり、
 *   図でも実装でも名前がぶつかるため。再帰表 ChainLineRecursion(ログ行．ログ行)はクラスに
 *   せず、LogLine のフィールド(`parent_uuid` / `logical_parent_uuid`)に含めている。
 * - TM の「セッション 1 : ログ行」(所属)は線を描かない。ログ行は SessionFile が所有し、
 *   SessionFile は Session が所有するので、行のセッションは所有の木でたどれる(持ち主は
 *   1つだけ)。サブエージェントのファイルの行も、親のセッションが所有するファイルに属する
 *   ので、行に記録される sessionId(親と同じ値)と食い違わない。
 * - TM の `fileKind`(ファイル種別)は SessionFile のフィールドにしない。Session が
 *   会話ファイル(`conversation_files`、0..*)とサブエージェントのファイル(`subagent_files`、
 *   0..*)を別の役割で持ち、どちらに入っているかで種別が決まるため。
 * - 会話ファイルは当初 1件固定(`conversation_file`)にしていたが、実機確認でセッション途中に
 *   worktree へ移動すると、同じセッションIDの jsonl が複数のプロジェクトフォルダに分かれて
 *   できることが判明した(#214)。TM どおり `conversation_files` を 1..* に直した(#216)。
 *   複数ファイルにまたがる属性(custom_title 等)の解決規則は図には書かず、実装イシュー側
 *   (#217)で扱う。
 * - 【Phase 2 の設計変更(#404。TM #403)】`conversation_files` を 1..* から 0..* に緩めた。
 *   新規作成では、セッションID は起動時に決まる(app が `--session-id` で決めることもある)のに、
 *   会話ファイルは最初の行が書かれた時点で作られるため、「ID は決まったが会話ファイルはまだ
 *   無い」窓がある。これで「ファイル0件のセッション」は型で作れるようになる。その間の状態は、
 *   RunningSessionByApp の process_state(Starting)で表す。**実装(`session.rs`)は未追従**
 *   (`conversation_files: Vec<SessionFile>` は空を許すが、組み立て規則・空のときの扱いは
 *   Phase 2 backend のイシューで扱う)。
 * - PC とユーザーはコンポジションにしている(PC が全体で User を所有する)。User は
 *   「その PC 上の OS のユーザーアカウント」で、1台の PC にしか属さない。同じ人が2台の
 *   PC を使えば User は2つになる。TM ではユーザーを PC から独立したリソースとし、対照表
 *   「PC．ユーザー」で多対多にしているので、ここは TM と違う。TM 側(Data セッション)に
 *   合わせてもらうなら、ユーザーの個体指定子を システムUUID(R) + ユーザーID にし、
 *   対照表「PC．ユーザー」をやめる形になる。
 *   これにより、以前ここで未決にしていた「`home_directory` は PC ごとに違いうる」問題は
 *   解消する(User が PC ごとのアカウントなので、User の属性でよい)。
 * - Gitリポジトリは PC ではなく User が所有するコンポジションにしている(User は PC 上の
 *   アカウント)。TM では Gitリポジトリを PC と対照表「PC．Gitリポジトリ」で多対多に
 *   しているので、ここは TM と違う。同じリポジトリを別の PC(別のアカウント)にクローン
 *   すれば、それぞれが別の GitRepository になる。TM 側に合わせてもらうなら、Gitリポジトリ
 *   をユーザーに属させ(個体指定子に システムUUID(R) + ユーザーID(R) を含める)、対照表
 *   「PC．Gitリポジトリ」をやめる形になる。
 *   これにより、以前ここで未決にしていた「同じリポジトリでも置き場所のパスが PC ごとに
 *   違いうるので、`repository_path` では PC をまたいで同じリポジトリだと言えない」問題は
 *   解消する(クローンごとに別の GitRepository なので、パスで区別してよい)。
 * - `Profile`(対象リポジトリ・GitHubプロジェクト・対象フォルダの組を名前付きで複数保存
 *   できる設定の単位。1ウィンドウ = 1プロファイル。native.md §6)は TM にまだ無い(未整備)。
 *   ユーザー指示により、実装(`profile.rs`。issue #72)を元に直接追加した。以前は
 *   `classes-native-prototype.ts` に as-is で載っていたが、こちらへ昇格したので削除した
 *   (Pc・User と同じ扱い)。TM 側への反映は デザイン(ドメイン:Data) セッションの今後の課題。
 * - (以下の【Phase 1】の各項は、#388 での設計の記録。実装した結果の差は、最後の
 *   【Phase 1: 実装との差】を参照。)
 * - 【Phase 1】実行中セッション(RunningSession。TM の物理名のまま)は、起動元で分け尽くされる
 *   ので抽象クラスにし、TM の相違のサブセット(app起動 / 外部起動)を継承で描いた。Session
 *   との線は、TM の E-R(セッション 1 : 実行中セッション 0..*)を、コンポジションではなく
 *   関連にした。プロセスの寿命は会話の寿命と別(終わった会話は動いていない。再開すると別の
 *   プロセス)で、Session は RunningSession を所有しないため。
 *   TM の 多値(MO)は、属性が1つだけのピア機能(RunningSessionPeerFeature)は値の列
 *   (`peer_features: Vec<String>`)にし、属性が複数ある権限の問い合わせ．提案は、問い合わせが
 *   所有する部分のクラス(PermissionSuggestion。0..*)にした。
 *   名前の重なり: native の app クレートには、#345 の実行中ガードが使う型 `RunningSession`
 *   (台帳のパスと PID と根拠。`app/src/lib.rs`)が既にあり、TM の `RunningSession` と別の
 *   もの(こちらは domain の型)だった。実装(#391)で app 側を `DetectedRunning` に改名して
 *   解消した(domain 側は TM の物理名のまま。app 側の型は `classes-infra.ts` にある)。
 * - 【Phase 1: domain と infra の境界】claude CLI の wire 形式(stream-json の各行:
 *   stream_event / system / result / control_request / control_response など)は infra が読む
 *   DTO であり、domain には置かない(版で項目が増えるため。未知の type / subtype は捨てる)。
 *   domain には CLI に依存しない中立の型だけを置く: 途中経過(ProgressEvent)、プロセスの状態
 *   (ProcessState)とその遷移契機(ProcessTrigger)、権限の問い合わせ・応答。infra が
 *   wire → domain に写す。ProgressEvent と ProcessTrigger は保存しない(画面へ流す・状態を動かす
 *   だけ)ので TM にモノは無く、TM に無い型を置いている。CLI の起動・標準入出力・台帳の読み取り
 *   といった I/O は port(app)の責務で、この図には描かない(クラスのメソッドは純粋な
 *   ロジックだけ。状態遷移 `RunningSessionByApp.apply` はその例)。
 * - 【Phase 1: 入力(送信)】ImageAttachment(#349)は起動したままのプロセスにもそのまま送れる
 *   (PoC #382 レポート §6.3。content ブロックが同じ形)。テキスト+画像(と、画像の上限・検証)は
 *   そのまま使える。一方、app の `AgentGateway.send` / `SendRequest`(cwd・本文・画像・
 *   モード・再開指定)は、送信のたびに `--resume` で CLI を起動し直す1回きりの送信が前提。
 *   Phase 1 では RunningSessionByApp の標準入力へ書く形に置き換わるため、実装で見直す
 *   (この図には描かない。app の型で、まだ図に無い)。
 * - 【Phase 1: 表示名・モデル切替・権限モード切替】RunningSession の操作だが、いずれも CLI への
 *   コマンド送信(I/O)なので、メソッドにはせず port の責務にした。表示名(`--name`)は属性
 *   `name`(台帳の name。会話タイトルの custom-title にも入る)で足りる。モデルと権限モード
 *   (default / acceptEdits / plan / dontAsk / bypassPermissions)の現在値は、TM に語彙が無い
 *   ため属性にしていない(system/init と、切替の応答から分かる)。画面で現在値を出す必要が
 *   あれば、TM(Data セッション)に語彙を足してもらってから属性にする(未決)。
 * - 【Phase 1: 権限の問い合わせ】問い合わせ種別(`/request_kind`)は TM の(D)なので / を付け、
 *   tool_name から求める(実装ではフィールドにしてよい)。応答の中身は TM に合わせて平らな
 *   フィールド(更新後の入力・拒否メッセージ・更新後の権限)にした。決着種別ごとに使うものは
 *   決まる(Allow は更新後の入力、Deny は拒否メッセージ、Cancelled はどれも持たない)ので、
 *   実装で型に落とすときは、決着種別ごとに持つ値が違うバリアントにしてよい。
 *   `tool_use_id`(AI応答行の tool_use ブロックを指す)は、ブロックが TM の第2弾でモノになる
 *   まで線を引かない。台帳のうち app が使わない語彙(ピア関連。peer_token は秘匿)も TM に
 *   あるため写したが、Debug やログに値を出さないこと(native.md §4)。
 * - 【Phase 1: 実装との差(#391。PR #395)】設計を実装した結果、次の点が設計と違う。図は
 *   実物(`crates/domain/src/`。1型 = 1ファイル)に合わせて描き直し、該当クラスの説明に
 *   「実装との差」として理由を残した(11点の判断の全文は PR #395)。
 *   (1) RunningSession は抽象クラスではなく共通フィールドの struct で、RunningSessionByApp /
 *   RunningSessionExternal は継承ではなく `base` で持つコンポジション(Rust に継承が無く、
 *   trait だと台帳の語彙の読み出しが全部メソッドになるため)。session_id(R)は実装ではフィールド。
 *   (2) PermissionBehavior は3値ではなく値を持つバリアント(Allow { updated_input,
 *   updated_permissions } / Deny { message } / Cancelled)で、PermissionResponse は
 *   request_id・behavior・responded_at だけを持つ(「Deny なのに更新後の入力がある」矛盾を
 *   型で作れなくするため)。(3) PermissionResponse は問い合わせに所有されず、応答の側が
 *   request_id で問い合わせを指す(関連)。(4) `/request_kind` はフィールドではなくメソッド。
 *   (5) RunningSessionByApp に、答え待ちの列を動かす receive_permission_request /
 *   settle_permission_request / exit が加わった。`apply` が process_state_at を記録するのは
 *   状態が変わったときだけ。(6) PermissionSuggestion に SDK の PermissionUpdate との往復
 *   (from_update_value / to_update_value)、PermissionRequestKind に from_tool_name が加わった。
 *   コンストラクタ(`new` / `allow` / `deny` / `cancelled`)は図に描いていない。
 * - 【Phase 2(複数セッション・モード切替・新規作成。issue #381・#404。TM #403)】
 *   (1) domain の変更は3つ。Session.conversation_files を 0..*(上記)、RunningSessionByApp に
 *   現在のモデル・現在の権限モード(属性)、RunningSessionByApp → GitRepository の関連
 *   (repository_path。0..* : 1。図では離れているため線ではなくフィールドで持つ)。いずれも **実装は未追従**(Phase 2 backend のイシューで扱う)。
 *   (2) 複数の実行中セッションを同時に持つことは、TM の「セッション 1 : 実行中セッション 0..*」
 *   と起動元のサブセットで既に表せていて、同時に持てる数の上限は運用の方針(語彙でも domain の
 *   規則でもない)。domain の型は増やさない。(3) 表示名は TM の語彙(会話タイトル・台帳の name)で
 *   足りるので、domain には足さない。(4) ProgressEvent は変えない(下記の包みで宛先を付ける)。
 * - 【Phase 2 の申し送り(app 側の型)】次の型は app / tauri のもので、この図(domain)にも
 *   as-is の図(classes-infra.ts / classes-tauri.ts)にも描かない(as-is は実装済みの型と1対1に
 *   保つため)。実装後に、Phase 1 と同じ流れで as-is の図へ写す。ここに一覧と理由を残す。
 *   (a) 複数保持: tauri の AppState.running_session(Option<RunningSessionSlot>。同時に1つ)を、
 *   複数を持てる集まり(Vec や Map)にする。キーは RunningSessionByApp の個体指定子
 *   (pid_domain + pid + started_at)。app の start_running_session は、いま持っている1つ
 *   (current)ではなく全部の PID を除外して外部の実行を調べる(own_running_pids はすでに列を
 *   返す形)。同時に持てる数の上限は app の定数(運用の方針)とし、超えたときは session_busy。
 *   「同じ会話を2つ起動しない」規則は、#361 のガード(自分の PID を除いた外部の実行の検知)では
 *   自分の起動を検知できないため、app が持つ集まりの中で session_id の一致を見て止める新しい規則
 *   として app に置く(純粋な規則。I/O は無い)。
 *   (b) 切り替え要求: app の型 `RunningSessionSwitch`(Model(String) / PermissionMode(...))を置く。
 *   実行は port(RunningProcess)に set_model / set_permission_mode を足す(Phase 1 と同じ
 *   「I/O は port」)。要求 ID(CLI の request_id)は infra が付けるので app の型には要らない。
 *   app の RunningPermissionMode(Plan / Default)には、画面が出す値(acceptEdits / auto など)を
 *   足す。domain の current_permission_mode は CLI の版で名前が変わる(default / manual)ため文字列で
 *   持ち、対応づけ(as_cli_value の逆)は app の責務。切り替えの結果(現在値の更新)は
 *   ユースケースが RunningSessionByApp の属性へ反映する。
 *   (c) 起動要求: app の StartRunningSession を、「再開」と「新規」の両方を表せる enum にする
 *   (Resume { session_id, cwd, mode } / New { session_id, cwd, mode })。持つ値が違うので(新規は
 *   ID を app が決める。既存の会話ファイルから cwd を求められない)バリアントにし、平らな型に
 *   Option を並べない(Phase 1 の PermissionBehavior と同じ理由)。新規のセッションID は
 *   **app が決める**(`--session-id` に UUID v4 を渡す)案を推す: 起動時に RunningSession の
 *   session_id が決まり、domain の型を Option にしなくて済み、TM の「ID は起動時に決まる」と
 *   一致する。CLI に任せる案は、system/init が届くまで session_id が無い状態を domain に
 *   持ち込む。どちらも、会話ファイルが作られるまでの窓は Session.conversation_files 0..* と
 *   process_state = Starting で表す。起動要求には、どのリポジトリか(repository_path。
 *   RunningSessionByApp の関連の元)と、表示名(--name。任意。起動引数として持つ。起動後の変更は
 *   Phase 1 と同じく port の責務)も持たせる。
 *   (d) 途中経過の宛先: domain の ProgressEvent は変えず(CLI にも複数セッションにも依存しない
 *   中立の型のまま)、宛先を付けた包み(app の型 `AddressedProgress { target: RunningSessionRef,
 *   event: ProgressEvent }`、RunningSessionRef は pid_domain + pid + started_at)を app に置き、
 *   Channel と running-session:changed のペイロードには包みを使う。RunningSessionEvent(app)も
 *   同じ宛先を持つ。
 *   (e) ハブ用の一覧項目: app の読み取り専用の型 `RunningSessionSummary`
 *   (RunningSessionRef・session_id・repository_path・process_state・答え待ちの数・現在のモデル・
 *   現在の権限モード・cwd)を置き、RunningSessionByApp からの純粋な変換(summarize)で作る。
 *   tauri の DTO はこれの写し(RunningSessionDto を一覧向けに絞った形)。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import {
  attr,
  defineDiagram,
  label,
  method,
  type ClassDef,
  type ClassFilePaths,
  type ClassLayers,
} from "./classDiagram";

const DEFS: ClassDef[] = [
  // ============ 実行環境 ============
  {
    name: { physical: "Pc", logical: "Pc", description: "Claude Code を動かしているマシン。TM: PC(リソース)" }, // 論理名: PC
    attributes: [
      attr("system_uuid", "String"), // 個体指定子。OS 由来のマシン固有値(アプリで採番しない)
      attr("pc_name", "String"),
      attr("description", "String"),
    ],
    position: { x: 55, y: -38 },
    filePath: "apps/native/crates/domain/src/pc.rs",
  },
  {
    name: { physical: "User", logical: "User", description: "PC 上の OS のユーザーアカウント。PC に所有される(コンポジション)。TM: ユーザー(リソース)" }, // 論理名: ユーザー
    attributes: [
      attr("user_id", "String"), // 個体指定子。OS のユーザー名(PC の中で一意)
      attr("user_name", "String"),
      attr("home_directory", "PathBuf"),
    ],
    methods: [
      // parsed は port が読み込み済みのパース結果(jsonl ファイル1つが1件。
      // 具体的な型は実装側(issue #208)が決める)。ファイルI/O・jsonl のパース自体は
      // このメソッドの責務ではない(port が担う。「メソッドを書く基準」を参照)。
      // 組み立てるのは Session とその配下の SessionFile まで。LogLine は遅延読み込みの
      // ため、ここでは組み立てない(セッションを開いたときに別途構築する。issue #207)。
      // parsed は port がそこまでに読み終えた分で、全件でも一部でもよい(走査が
      // ファイル単位で逐次進むため。issue #295・#305)。呼ばれるたびに、受け取った
      // 分から Session を組み立て直して保持中のものと置き換える。同じ session_id の
      // 複数件は1つの Session に集約する(issue #217)。呼び出しのタイミングは
      // 実行制御であり、図には描かない。
      method("load_sessions", ["parsed: Vec<ParsedSession>"], "()"),
    ],
    // Pc の真下に置く(Pc と Session にはさまれた列)。
    position: { x: 55, y: 217 },
    filePath: "apps/native/crates/domain/src/user.rs",
    // メソッド名・引数が長いので広げる(LogLine の size の説明を参照)。
    size: { w: 310, h: 0 },
  },
  {
    name: { physical: "GitRepository", logical: "GitRepository", description: "プロダクト開発の対象として登録したリポジトリ(クローン1つ)。User に所有される(コンポジション)。TM: Gitリポジトリ(リソース)" }, // 論理名: Gitリポジトリ
    attributes: [
      attr("repository_path", "PathBuf"), // 個体指定子。リポジトリのパス(User の中で一意)
      attr("repository_name", "String"),
      attr("description", "String"),
    ],
    // User の右に並べる(User の右辺と横につなぐ)。
    position: { x: 468, y: 217 },
    filePath: "apps/native/crates/domain/src/git_repository.rs",
  },
  {
    name: { physical: "GitBranch", logical: "GitBranch", description: "ブランチの作成・削除。git 自体はブランチに ID を持たないため、管理対象にするために ID を新設する。TM: Gitブランチ(イベント)" }, // 論理名: Gitブランチ
    attributes: [
      attr("branch_id", "String"), // 個体指定子。アプリが新設する GitブランチID
      attr("branch_name", "String"),
      attr("description", "String"),
      attr("created_at_time", "u64"),
      attr("deleted_at_time", "Option<u64>"),
    ],
    position: { x: 951, y: 161 },
    filePath: "apps/native/crates/domain/src/git_branch.rs",
  },
  {
    name: { physical: "GitWorktree", logical: "GitWorktree", description: "ワーキングツリーの作成・削除。git の識別子は台帳のディレクトリ名(パス由来)だけなので、ID を新設する。TM: ワーキングツリー(イベント)" }, // 論理名: ワーキングツリー
    attributes: [
      attr("worktree_id", "String"), // 個体指定子。アプリが新設する ワーキングツリーID
      attr("worktree_name", "String"),
      attr("description", "String"),
      attr("worktree_folder_path", "PathBuf"), // TM: フォルダパス(Claude)。実物のディレクトリ
      attr("worktree_git_file_path", "PathBuf"), // TM: ファイルパス(git)。直下の .git ファイル
      attr("created_at_time", "u64"),
      attr("deleted_at_time", "Option<u64>"),
    ],
    position: { x: 951, y: 470 },
    filePath: "apps/native/crates/domain/src/git_worktree.rs",
  },
  {
    name: { physical: "Profile", logical: "Profile", description: "対象リポジトリ・GitHubプロジェクト・対象フォルダの組を名前付きで複数保存できる設定の単位(issue #72)。1ウィンドウ = 1プロファイル(native.md §6)。TM 未整備(冒頭の【TM との違い・未決】を参照)" }, // 論理名: プロファイル
    attributes: [
      attr("id", "String"), // 個体指定子。名前変更に耐える安定ID(生成は実装側の責務)
      attr("name", "String"),
      // repository_path(GitRepository の個体指定子と同じ PathBuf)は ID 参照なので、
      // フィールドにはせず下の関連(repository_path)で表す(冒頭の「TM からの写し方」)。
      // domain::GithubProject(classes-native-prototype.ts)そのもの。図の離れた位置に
      // あるため線は引かない(同ファイル冒頭の方針を参照)。
      attr("github_project", "Option<GithubProject>"),
      attr("selected_project_folders", "Vec<String>"), // 対象フォルダ名(パスではなくフォルダ名のまま持つ)
    ],
    // GitRepository の真下に置く(GitRepository の下辺 → Profile の上辺)。
    position: { x: 468, y: 500 },
    filePath: "apps/native/crates/domain/src/profile.rs",
    // アプリ固有の設定の単位で、TM のモノではない(冒頭の【TM との違い・未決】)。
    layer: "application",
    // github_project の名前と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 280, h: 0 },
  },
  // ============ 会話 ============
  {
    name: { physical: "Session", logical: "Session", description: "1つの会話。セッションIDは会話開始時に発番される UUID v4 で、.jsonl のファイル名にもなる(ただしファイルは識別しない)。【Phase 2(#404)】会話ファイルは 0..*(新規作成で「ID は決まったが会話ファイルはまだ無い」窓がある。実装は未追従)。TM: セッション(リソース)" }, // 論理名: セッション
    attributes: [
      attr("session_id", "String"), // 個体指定子。UUID v4
      attr("custom_title", "Option<String>"), // custom-title 行(最後の行が有効)
      attr("ai_title", "Option<String>"),
      attr("mode", "Option<String>"),
      attr("slug", "Option<String>"), // TM: セッション別名
      attr("/last_prompt", "Option<String>"), // TM: 直近入力テキスト(D)。ログから導出する
    ],
    position: { x: 55, y: 824 },
    filePath: "apps/native/crates/domain/src/session.rs",
  },
  {
    name: { physical: "SessionFile", logical: "SessionFile", description: "セッションログの .jsonl ファイル1件。会話ファイル(<フォルダ名>/<セッションID>.jsonl)とサブエージェントのファイル(<フォルダ名>/<セッションID>/subagents/agent-<エージェントID>.jsonl)がある。TM: セッションファイル(jsonl)(リソース)" }, // 論理名: セッションファイル(jsonl)
    attributes: [
      attr("file_path", "PathBuf"), // 個体指定子。ファイルパス
      // 種別(TM の fileKind)は持たない。冒頭の【TM との違い・未決】を参照。
    ],
    // Session の右に置く(Session の右辺と横に2本並べてつなぐ)。
    position: { x: 489, y: 875 },
    filePath: "apps/native/crates/domain/src/session_file.rs",
  },
  // ============ ログ行 ============
  {
    name: { physical: "LogLine", logical: "LogLine", description: "uuid / parentUuid で親子チェーンを構成する行。行種別(user / assistant / system / attachment)ごとのサブクラスに分け尽くされるので抽象クラスにする。TM: ログ行(イベント)" }, // 論理名: ログ行
    stereotype: "abstract",
    attributes: [
      attr("uuid", "String"), // 個体指定子。行UUID
      // TM: 再帰表「ログ行．ログ行」。親の行を行UUIDで指す(自己参照は線にできないので ID で持つ)。
      // チェーン種別(TM の linkKind)は、どちらのフィールドに入っているかで決まる。
      // 1つの行を親とする行は 0..*(--fork-session で分岐しうる)、起点の行は親を持たない。
      attr("parent_uuid", "Option<String>"), // 物理チェーンの親
      attr("logical_parent_uuid", "Option<String>"), // 論理チェーンの親(compact_boundary で圧縮前の末尾)
      attr("timestamp", "u64"), // TM: 記録日時
      attr("cwd", "Option<PathBuf>"), // TM: 作業ディレクトリパス。1ファイルの中でも行ごとに変わりうる
      attr("entrypoint", "Option<String>"),
      attr("version", "Option<String>"),
      attr("git_branch", "Option<String>"),
      attr("is_sidechain", "Option<bool>"), // TM: サブエージェント区分
      attr("user_type", "Option<String>"),
      // 行種別(TM の type)は持たない。どのサブクラスかで決まる。
    ],
    // SessionFile の右に置く。サブクラス4つはその下の横一列(y = 1248)。
    position: { x: 943, y: 773 },
    filePath: "apps/native/crates/domain/src/log_line/log_line.rs",
    // d3.classes は箱の幅を中身から計算せず、指定が無ければ 200 で固定する。
    // logical_parent_uuid と型の列が重なるので広げる(h は無視され、中身から計算される)。
    size: { w: 250, h: 0 },
  },
  {
    name: { physical: "UserLogLine", logical: "UserLogLine", description: "人間の入力とツール実行結果の行(type = user)。実測では約9割がツール実行結果。TM: ユーザー行(イベントのサブセット)" }, // 論理名: ユーザー行
    attributes: [attr("prompt_id", "Option<String>"), attr("permission_mode", "Option<String>")],
    // AssistantLogLine との間は 180px ほど空ける。関連のラベル source_tool_assistant
    // (幅 約112px)は線の中央に置かれるので、間が狭いと箱に隠れたり、線の両端の記号
    // (起点の ×、終点の矢印)に重なったりする。
    position: { x: 410, y: 1248 },
    filePath: "apps/native/crates/domain/src/log_line/user_log_line.rs",
    // permission_mode と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 230, h: 0 },
  },
  {
    name: { physical: "AssistantLogLine", logical: "AssistantLogLine", description: "AI の応答の行(type = assistant)。1回の API 応答が複数ブロックなら行が分かれ、同じ message_id を共有する。TM: AI応答行(イベントのサブセット)" }, // 論理名: AI応答行
    attributes: [
      attr("request_id", "Option<String>"),
      attr("message_id", "Option<String>"),
      attr("model", "Option<String>"),
      attr("stop_reason", "Option<String>"),
    ],
    position: { x: 821, y: 1248 },
    filePath: "apps/native/crates/domain/src/log_line/assistant_log_line.rs",
  },
  {
    name: { physical: "SystemLogLine", logical: "SystemLogLine", description: "内部イベントの行(type = system)。TM: システム行(イベントのサブセット)" }, // 論理名: システム行
    attributes: [
      // TM: システム副種別(stop_hook_summary / api_error / compact_boundary / informational)。
      // 区分コードだが TM はまだサブセットに分けていないので、分けた段階でサブクラスにする。
      attr("subtype", "String"),
      attr("level", "Option<String>"),
    ],
    position: { x: 1063, y: 1248 },
    filePath: "apps/native/crates/domain/src/log_line/system_log_line.rs",
  },
  {
    name: { physical: "AttachmentLogLine", logical: "AttachmentLogLine", description: "実行環境が会話に注入した情報の行(type = attachment)。TM: 付帯情報行(イベントのサブセット)" }, // 論理名: 付帯情報行
    attributes: [
      // TM: 付帯情報種別(23種)。SystemLogLine の subtype と同じく、TM で分けた段階でサブクラスにする。
      attr("attachment_type", "String"),
    ],
    position: { x: 1317, y: 1248 },
    filePath: "apps/native/crates/domain/src/log_line/attachment_log_line.rs",
  },
  // ============ 実行中セッション・権限の問い合わせ・途中経過(Phase 1。issue #381・#388) ============
  {
    name: { physical: "RunningSession", logical: "RunningSession", description: "いま動いている Claude Code のプロセス1つ。~/.claude/sessions/<pid>.json(と .key)が台帳。起動元(app 自身 / 外部)で分け尽くされる。会話(Session)はこのプロセスの中で動き、終わった会話は動いていない(0件)。同じ会話を後で再開すると別のプロセスになる。【実装との差(#391)】設計では抽象クラスだったが、Rust には継承が無いため、共通のフィールドを持つ struct にし、サブクラスにあたる RunningSessionByApp / RunningSessionExternal がこれを base として持つ(コンポジション)。trait にすると台帳の語彙(20超のフィールド)の読み出しが全部メソッドになるため。session_id(R)は実装ではフィールド(String)で持つ(図では関連 session)。peer_token は Debug を手書きして値を出さない。TM: 実行中セッション(イベント)" }, // 論理名: 実行中セッション
    attributes: [
      // 個体指定子は pidDomain + pid + startedAt。pid は OS が使い回すので単独では個体を指定できない。
      // sessionId(R)は関係線(session)で表す。
      attr("pid_domain", "String"), // 個体指定子。pid が有効な範囲(`<OS>:<ホスト名>`)
      attr("pid", "u32"), // 個体指定子。プロセスID
      attr("started_at", "u64"), // 個体指定子。起動日時(Claude Code がセッションを始めた時刻)
      // sdk-cli 起動の台帳には原則書かれない。形式も版で違う(FILETIME / .NET tick)ので文字列で持つ。
      attr("proc_start", "Option<String>"), // 生存判定に使う値(OS のプロセス作成時刻)
      attr("cwd", "Option<PathBuf>"), // TM: 作業ディレクトリパス
      // 台帳の状態(idle / busy)。app が起動したものの processState(5値)とは別の語彙。
      attr("status", "Option<String>"),
      attr("status_updated_at", "Option<u64>"),
      attr("host_session_id", "Option<String>"),
      attr("version", "Option<String>"),
      attr("kind", "Option<String>"),
      attr("entrypoint", "Option<String>"), // sdk-cli は ほかの SDK 利用でも同じ値で、起動元の区分には使えない
      attr("name", "Option<String>"), // 表示名(--name)。会話タイトル(custom-title)にも入る
      attr("name_source", "Option<String>"),
      attr("name_since", "Option<u64>"),
      attr("updated_at_time", "Option<u64>"),
      attr("peer_protocol", "Option<String>"),
      attr("messaging_socket_path", "Option<PathBuf>"),
      attr("bridge_session_id", "Option<String>"),
      // .key にある認証値。値は秘匿で、画面・ログ・Debug 出力に出さない(native.md §4)。
      attr("peer_token", "Option<String>"),
      // TM: 実行中セッション．ピア機能(多値)。属性が1つだけなので、値の列として持つ。
      attr("peer_features", "Vec<String>"),
    ],
    position: { x: 55, y: 1650 },
    filePath: "apps/native/crates/domain/src/running_session.rs",
    // messaging_socket_path と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "RunningSessionByApp", logical: "RunningSessionByApp", description: "app が子プロセスとして起動した claude CLI(PoC #382)。標準入出力(stream-json)で対話し続けるため、このサブクラスだけがプロセスの状態と権限の問い合わせを持つ。台帳は外部起動と同じ形で書かれる(entrypoint は sdk-cli)ので台帳では区別できず、app が自分の子プロセスの PID を知っていることで区分する。#361 のガード(実行中の検知)では app は自分が起動した PID を除外する。【実装との差(#391)】継承ではなく、共通のフィールドの struct RunningSession を base として持つコンポジション(線 base)。permission_requests は「まだ答えていない」問い合わせの列(答えたものは外す)。【Phase 2(#404)】現在のモデル・現在の権限モードの属性と、リポジトリパス(R)による GitRepository との関連(フィールド repository_path で参照する。app は起動時にプロファイル = 登録済みリポジトリを選ぶので、cwd からの推測ではなく記録された事実。外部起動は結ばない)が加わった。新規作成で会話ファイルが無い間は process_state が Starting。実装(running_session_by_app.rs)は未追従。TM: 実行中セッション(app起動)(イベントのサブセット)" }, // 論理名: 実行中セッション(app起動)
    attributes: [
      attr("process_state", "ProcessState"), // TM: プロセス状態
      attr("process_state_at", "u64"), // TM: プロセス状態の更新日時
      // 【Phase 2(#404。TM #403)】set_model / set_permission_mode で途中から変わる、いま送る
      // ときに使われる値(レポート §6.2)。ログ側の モデルID(AI応答行)・権限モード(ユーザー行)は
      // 記録された当時の値で意味が違うので別の属性。更新日時は持たない(履歴は model_changed 行と
      // ユーザー行に残る)。起動してから system/init などで分かるまで None。権限モードは CLI の版で
      // 名前が変わる(default / manual)ので文字列で持つ(app の RunningPermissionMode との
      // 対応づけは app の責務。domain は app に依存しない)。
      attr("current_model", "Option<String>"), // TM: 現在のモデル
      attr("current_permission_mode", "Option<String>"), // TM: 現在の権限モード
      // 【Phase 2】TM: リポジトリパス(R)。Gitリポジトリ 1 : 実行中セッション(app起動)0..*(E-R)。
      // app は起動時にプロファイル(登録済みリポジトリ)を選ぶので、cwd からの推測ではなく記録された
      // 事実。GitRepository は User が所有しているので(持ち主は1つだけ)、コンポジションにせず
      // ID(GitRepository.repository_path)で参照する。TM の規則では (R) は線にしてフィールドに
      // しないが、この図では GitRepository と離れていて、線を引くと Profile・SessionFile・LogLine
      // 系の箱と継承線を横切るため、線は引かず、参照であることを示すフィールドとして持つ(未決:
      // 図の配置を見直せるなら、線に改める)。外部起動(RunningSessionExternal)は結ばない。
      attr("repository_path", "PathBuf"),
    ],
    methods: [
      // 状態遷移は純粋な関数(I/O は port の責務。「メソッドを書く基準」を参照)。
      // 入口・出口は PoC #382 レポート §7.1:
      //   Initialized: 起動中 → 待機 / MessageSent: 待機 → 実行中 / PermissionAsked: 実行中 → 権限待ち
      //   PermissionSettled: 権限待ち → 実行中 / TurnFinished: 実行中 → 待機 / Exited: どの状態からでも → 終了
      // 表にない組み合わせは状態を変えない(実行中に次の入力を送っても実行中のまま。キューは CLI 側)。
      // 終了は戻らない。【実装との差(#391)】at_time を process_state_at に記録するのは、状態が
      // 変わったときだけ(設計は「いずれの場合も」。変わらない契機や終了後の契機で「状態を最後に
      // 変えた日時」が動くと意味を失うため)。
      method("apply", ["trigger: ProcessTrigger", "at_time: u64"], "()"),
      // 【実装での追加(#391)】答え待ちの列(permission_requests)を動かすメソッド。
      // receive: 列に足し(同じ request_id は足さない)、PermissionAsked で状態を動かす。
      // settle: 列から外し、答え待ちが無くなったら PermissionSettled で状態を動かす(列に無ければ何もしない)。
      // exit: 答え待ちを捨てて Exited で状態を動かす。
      method("receive_permission_request", ["request: PermissionRequest", "at_time: u64"], "()"),
      method("settle_permission_request", ["request_id: &str", "at_time: u64"], "Option<PermissionRequest>"),
      method("exit", ["at_time: u64"], "()"),
    ],
    position: { x: 400, y: 2350 },
    filePath: "apps/native/crates/domain/src/running_session_by_app.rs",
    // メソッドの引数が長く、戻り値型の列と重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 580, h: 0 },
  },
  {
    name: { physical: "RunningSessionExternal", logical: "RunningSessionExternal", description: "app 以外(ターミナルの claude、Claude Desktop、ほかの SDK 利用)が起動した実行中セッション。app は台帳から存在を知るだけで、標準入出力を持たないため対話できない。右側の語彙は親が持つものだけ。【実装との差(#391)】継承ではなく、RunningSession を base として持つコンポジション(線 base)。TM: 実行中セッション(外部起動)(イベントのサブセット)" }, // 論理名: 実行中セッション(外部起動)
    attributes: [],
    position: { x: 55, y: 2350 },
    filePath: "apps/native/crates/domain/src/running_session_external.rs",
    size: { w: 260, h: 0 },
  },
  {
    name: { physical: "ProcessState", logical: "ProcessState", description: "app が起動した claude CLI プロセスの状態(PoC #382 レポート §7.1)。app 側が持つ状態で台帳には無い(台帳の status: idle / busy より細かい)。履歴が必要になったら、状態の移り変わりをイベントとして別に立てる(TM)。TM: プロセス状態(RunningSessionByApp の属性の区分コード)" }, // 論理名: プロセス状態
    stereotype: "enumeration",
    // 起動中 / 待機 / 実行中 / 権限待ち / 終了。
    attributes: ["Starting", "Idle", "Running", "AwaitingPermission", "Exited"].map(label),
    position: { x: 1200, y: 2350 },
    filePath: "apps/native/crates/domain/src/process_state.rs",
  },
  {
    name: { physical: "ProcessTrigger", logical: "ProcessTrigger", description: "ProcessState を動かす出来事(RunningSessionByApp.apply の入力)。app が子プロセスとのやり取りから決める。TM には無い(状態遷移の入力であり、保存しない)" }, // 論理名: プロセス状態の遷移契機
    stereotype: "enumeration",
    attributes: [
      "Initialized",
      "MessageSent",
      "PermissionAsked",
      "PermissionSettled",
      "TurnFinished",
      "Exited",
    ].map(label),
    position: { x: 1500, y: 2350 },
    filePath: "apps/native/crates/domain/src/process_trigger.rs",
  },
  {
    name: { physical: "PermissionRequest", logical: "PermissionRequest", description: "CLI から届く control_request(subtype: can_use_tool)。ツールを使ってよいかを app に尋ねる(PoC #382 レポート §2.1)。AskUserQuestion(選択肢)と ExitPlanMode(計画の承認)も同じ形で届く(§2.4)ので、tool_name から求まる問い合わせ種別(/request_kind)で区別して画面を出し分ける。tool_use_id は AI応答行の tool_use ブロックを指すが、ブロックは TM の第2弾でモノにするため今は結ばない。【実装との差(#391)】導出値 /request_kind はフィールドにせず、メソッド request_kind()(tool_name から PermissionRequestKind::from_tool_name で求める)にした(ガイドの「導出できる値」の許す形)。提案(suggestions)は問い合わせが持つ列。応答(PermissionResponse)は問い合わせが所有せず、response 側が request_id で指す(線 request_id)。TM: 権限の問い合わせ(イベント)" }, // 論理名: 権限の問い合わせ
    attributes: [
      // 個体指定子は request_id と、尋ねてきた実行中セッションの値(R。関係線 permission_requests)。
      attr("request_id", "String"), // 個体指定子
      attr("tool_name", "String"),
      attr("display_name", "Option<String>"),
      attr("description", "Option<String>"),
      attr("tool_use_id", "String"),
      attr("tool_input", "serde_json::Value"), // TM: 入力(ツールに渡される引数。ツールごとに形が違う)
      attr("blocked_path", "Option<PathBuf>"), // Bash のときに付く
      attr("requested_at", "u64"), // TM: 問い合わせ日時
      attr("/request_kind", "PermissionRequestKind"), // TM: 問い合わせ種別(D)。tool_name から求める
    ],
    position: { x: 400, y: 2800 },
    filePath: "apps/native/crates/domain/src/permission_request.rs",
    // tool_input と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 330, h: 0 },
  },
  {
    name: { physical: "PermissionRequestKind", logical: "PermissionRequestKind", description: "権限の問い合わせの種別。tool_name から求まる(導出)。ToolUse: 通常のツール使用の許可 / AskUserQuestion: 選択肢の質問(許可・拒否ではなく、ユーザーの選択を更新後の入力に入れて返す。レポート §2.4)/ ExitPlanMode: 計画の承認。TM: 問い合わせ種別(D)" }, // 論理名: 問い合わせ種別
    stereotype: "enumeration",
    attributes: ["ToolUse", "AskUserQuestion", "ExitPlanMode"].map(label),
    // tool_name から種別を求める純粋な導出(AskUserQuestion / ExitPlanMode 以外は ToolUse)。
    methods: [method("from_tool_name", ["tool_name: &str"], "Self")],
    position: { x: 980, y: 3200 },
    filePath: "apps/native/crates/domain/src/permission_request_kind.rs",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "PermissionResponse", logical: "PermissionResponse", description: "app が返す control_response(レポート §2.1)。許可なら更新後の入力(そのまま、または書き換えた引数)を返し、拒否なら拒否メッセージがそのままモデルへの tool_result になる。「今後も許可」は更新後の権限に入れて返す。中断すると CLI から control_cancel_request が来て、app は応答せずに終わるため、決着種別に取り消しを含める(取り消しのときは更新後の入力・拒否メッセージ・更新後の権限は持たない)。問い合わせとは別の行為(日時が別)なので別のクラスにし、問い合わせが 0..1 を持つ。TM: 権限の応答(イベント)" }, // 論理名: 権限の応答
    attributes: [
      // 個体指定子は request_id(R)だけ。TM では関係線で表すが、実装は問い合わせを所有せず、
      // ID で指すフィールドとして持つ(線 request_id。設計の「問い合わせが response を所有」との差。#391)。
      attr("request_id", "String"),
      // 更新後の入力・拒否メッセージ・更新後の権限は、決着種別ごとに持つ値が違うので、
      // 平らなフィールドにせず PermissionBehavior のバリアントが持つ(#391。設計との差)。
      attr("behavior", "PermissionBehavior"), // TM: 決着種別
      attr("responded_at", "u64"), // TM: 応答日時
    ],
    position: { x: 830, y: 2800 },
    filePath: "apps/native/crates/domain/src/permission_response.rs",
    size: { w: 260, h: 0 },
  },
  {
    name: { physical: "PermissionBehavior", logical: "PermissionBehavior", description: "権限の問い合わせの決着種別。Allow: 許可(updated_input はツールへ渡す入力。updated_permissions は「今後も許可」にする更新の列 = PermissionSuggestion::to_update_value の JSON の配列)/ Deny: 拒否(message がそのままモデルへの tool_result になる)/ Cancelled: 取り消し(中断による control_cancel_request。app は応答せずに終わる)。【実装との差(#391)】設計では Allow / Deny / Cancelled の3値と平らなフィールドだったが、決着種別ごとに持つ値が違う(Cancelled はどれも持たない)ので、値を持つバリアントにした。「Deny なのに更新後の入力がある」ような矛盾を型で作れなくするため。TM: 決着種別" }, // 論理名: 決着種別
    stereotype: "enumeration",
    attributes: [
      "Allow { updated_input: serde_json::Value, updated_permissions: Option<serde_json::Value> }",
      "Deny { message: String }",
      "Cancelled",
    ].map(label),
    position: { x: 1250, y: 2800 },
    filePath: "apps/native/crates/domain/src/permission_behavior.rs",
    // データを持つバリアントの表記が長いので広げる(LogLine の size の説明を参照)。
    size: { w: 600, h: 0 },
  },
  {
    name: { physical: "PermissionSuggestion", logical: "PermissionSuggestion", description: "permission_suggestions の1件(レポート §2.1)。setMode / addRules / addDirectories などの種別と、適用先(session / localSettings など)を持つ。SDK の PermissionUpdate 型そのもので、許可応答の更新後の権限に入れ返すと「今後も許可」になる。TM: 権限の問い合わせ．提案(多値)" }, // 論理名: 権限の問い合わせ．提案
    attributes: [
      // 個体指定子は request_id(R)だけで、1件ごとには一意でない。関係線 suggestions で表す。
      attr("suggestion_type", "String"), // 提案種別
      attr("suggestion_destination", "String"), // 適用先
      // 内容(種別ごとに形が違う)。実装は type と destination を除いた残りの項目(JSON オブジェクト)。
      attr("suggestion_content", "serde_json::Value"),
    ],
    methods: [
      // SDK の PermissionUpdate の JSON との往復(純粋な変換)。許可応答の更新後の権限に
      // 入れ返すときに to_update_value を使う。type か destination が文字列でなければ None(読み飛ばす)。
      method("from_update_value", ["value: &serde_json::Value"], "Option<Self>"),
      method("to_update_value", [], "serde_json::Value"),
    ],
    position: { x: 400, y: 3200 },
    filePath: "apps/native/crates/domain/src/permission_suggestion.rs",
    size: { w: 500, h: 0 },
  },
  {
    name: { physical: "ProgressEvent", logical: "ProgressEvent", description: "画面へ流す途中経過の型。CLI の wire 形式(stream_event / system / result / control_request などの JSON 行)は infra が読む DTO であり、domain には置かない。domain にはこの CLI に依存しない中立の型だけを置き、infra が wire → domain に写す(この境界の判断は冒頭の【TM との違い・未決】を参照)。保存しない(画面へ流すだけ。確定した応答は AI応答行が受ける)ので TM にモノは無い。TextDelta: 文章の断片が届いた / ToolStarted: ツール実行が始まった / ToolResultArrived: ツール結果が届いた / TurnFinished: ターンが終わった(成功・失敗。失敗のときは、送信した行を会話に残さない判断に使う。#352 で残った件)/ SentLineConfirmed: 送信した行の uuid が確定した(--replay-user-messages。画面上の「送信中」の行と jsonl の行を結ぶ)" }, // 論理名: 途中経過
    stereotype: "enumeration",
    attributes: [
      "TextDelta { text: String }",
      "ToolStarted { tool_use_id: String, tool_name: String }",
      "ToolResultArrived { tool_use_id: String, is_error: bool }",
      "TurnFinished { succeeded: bool }",
      "SentLineConfirmed { uuid: String }",
    ].map(label),
    position: { x: 900, y: 1650 },
    filePath: "apps/native/crates/domain/src/progress_event.rs",
    // 画面へ流す出力で、ユースケース(app)の入出力にあたる。TM のモノではない。
    layer: "application",
    // データを持つバリアントの表記が長いので広げる(LogLine の size の説明を参照)。
    size: { w: 470, h: 0 },
  },
];

// 既定は企業のビジネスルール(TM を元にしたドメインの型)。アプリ固有のものだけ layer を書く。
const { classes, rel, filePaths, layers } = defineDiagram(DEFS, {
  layerOf: () => "enterprise",
});

const RELATIONSHIPS = [
  // TM: PC．ユーザー(対照表、属性なし)。1台に1人以上。
  // PC が User(その PC 上のアカウント)を所有するのでコンポジションにする(TM は多対多。
  // 冒頭の【TM との違い・未決】を参照)。線は「部分 → 全体」の向き(◆が Pc 側に付く)で、
  // ラベルは全体側のフィールド名、多重度は部分側だけ書く。
  // Pc を User の真上に置き、縦向き(User の上辺 → Pc の下辺)につなぐ。
  rel("composition", "User", "Pc", "users", "top", "bottom", {
    fromMultiplicity: "1..*",
  }),
  // TM: PC．Gitリポジトリ(対照表、属性なし)。オブジェクトモデルでは PC ではなく User が
  // GitRepository を所有するコンポジションにする(TM との違いは冒頭の【TM との違い・未決】)。
  // 1人に 0 件以上。GitRepository の左辺から User の右辺へ横につなぐ(User の上辺は
  // Pc への線、下辺は Session からの線で使っている)。
  rel("composition", "GitRepository", "User", "repositories", "left", "right", {
    fromMultiplicity: "0..*",
  }),
  // TM: Gitリポジトリ 1 : Gitブランチ 0..*(E-R。ブランチ側の repositoryPath(R))。
  // GitRepository が所有するのでコンポジション。GitRepository の右辺はワーキングツリーと
  // 分け合うので、上寄り(250°)で受ける。
  rel("composition", "GitBranch", "GitRepository", "branches", "left", 250, {
    fromMultiplicity: "0..*",
  }),
  // TM: Gitリポジトリ 1 : ワーキングツリー 1..*(E-R。リポジトリ本体が常に1つ目)。
  // GitRepository が所有するのでコンポジション。右辺の下寄り(290°)で受ける。
  // ワーキングツリーはブランチの真下に置く(画面上での手調整で決めた配置)。
  rel("composition", "GitWorktree", "GitRepository", "worktrees", "left", 290, {
    fromMultiplicity: "1..*",
  }),
  // TM: Gitブランチ．ワーキングツリー(対応表、属性なし)。ブランチを開けるワーキング
  // ツリーは1つまで、ワーキングツリーが開くブランチも1つまで(detached HEAD なら無し)。
  // ブランチもワーキングツリーも GitRepository が所有しているので、コンポジションにはせず
  // 関連にする(持ち主は1つだけ。冒頭の「TM からの写し方」を参照)。向きは GitWorktree →
  // GitBranch で、ワーキングツリーがチェックアウト中のブランチを ID で参照する
  // (実装: `GitWorktree { checked_out_branch: Option<ブランチID> }`)。ブランチの側からは
  // たどらない(起点の × の意味どおり)。ラベルは参照するフィールド名。
  // 起点はワーキングツリーの上辺、終点はブランチの下辺(手調整で決めた配置を保つ)。
  rel("association", "GitWorktree", "GitBranch", "checked_out_branch", "top", "bottom", {
    fromMultiplicity: "0..1",
    toMultiplicity: "0..1",
  }),
  // Profile が対象リポジトリを ID(パス)で参照する(実装:
  // `Profile { repository_path: Option<PathBuf> }`)。GitRepository は User が所有して
  // いるので(持ち主は1つだけ)、コンポジションにはせず関連にする。GitRepository の側から
  // はたどらない(起点の × の意味どおり)。GitRepository の真下に Profile を置き、
  // Profile の上辺から GitRepository の下辺へ縦につなぐ。
  rel("association", "Profile", "GitRepository", "repository_path", "top", "bottom", {
    fromMultiplicity: "0..1",
    toMultiplicity: "0..*",
  }),
  // TM: ユーザー．セッション(対照表、属性なし)。1人に会話は 0 件以上、1つの会話は
  // 必ず1人のもの。User が Session を所有するのでコンポジションにする(「1つの会話は
  // 必ず1人のもの」はコンポジションの全体側の多重度 1 と一致し、TM と矛盾しない)。
  // 線は「部分 → 全体」の向き(◆が User 側に付く)で、ラベルは全体側のフィールド名、
  // 多重度は部分側だけ書く。Session は User の下に置き、Session の上辺から User の
  // 下辺へつなぐ(画面上での手調整で決めた配置)。
  rel("composition", "Session", "User", "sessions", "top", "bottom", {
    fromMultiplicity: "0..*",
  }),
  // TM: セッション．セッションファイル(対照表、属性なし)。1つの会話にファイルは
  // 会話ファイル0..* + サブエージェント0件以上、ファイルは必ず1つの会話に属する
  // (Phase 2 で会話ファイルを 1..* から 0..* に緩めた。下記)。
  // Session が SessionFile を所有するのでコンポジションにし、役割(会話ファイル /
  // サブエージェントのファイル)ごとに線を分ける。1つのファイルはどちらか一方にだけ入る。
  // 線は「部分 → 全体」の向き(◆が Session 側に付く)。SessionFile を Session の右に置き、
  // SessionFile の左辺から Session の右辺へ、2本を上下に並べてつなぐ。conversation_files は
  // 上寄り(左辺 100° → 右辺 260°)、subagent_files は下寄り(左辺 80° → 右辺 280°)で、
  // 2本は交差しない。
  // conversation_files は当初 1件固定だったが、実機確認でセッション途中に worktree へ
  // 移動すると同じセッションIDの jsonl が複数のプロジェクトフォルダにできることが判明し
  // (#214)、TM どおりの 1..* に直した(#216)。複数ファイルにまたがる属性(custom_title 等)
  // の解決規則は図には書かず、実装イシュー側(#217)で扱う。
  // 【Phase 2(#404。TM #403)】新規作成では、セッションID は起動時に決まるが会話ファイルは
  // 最初の行が書かれた時点で作られるので、その窓を表せるよう 0..* に緩めた。その間の状態は
  // RunningSessionByApp の process_state(Starting)。実装(session.rs)は未追従。
  rel("composition", "SessionFile", "Session", "conversation_files", 100, 260, {
    key: "conversation_files",
    fromMultiplicity: "0..*",
  }),
  rel("composition", "SessionFile", "Session", "subagent_files", 80, 280, {
    key: "subagent_files",
    fromMultiplicity: "0..*",
  }),
  // TM: セッションファイル 1 : ログ行 1..*(書かれた先)。行はファイルに書かれるので、
  // SessionFile が LogLine を所有するコンポジションにする。TM の「セッション 1 : ログ行」
  // は線を描かない(冒頭の【TM との違い・未決】)。LogLine の左辺から SessionFile の右辺へ
  // 横につなぐ。
  rel("composition", "LogLine", "SessionFile", "lines", "left", "right", {
    fromMultiplicity: "1..*",
  }),
  // TM: ログ行のサブセット(×行種別。区分コードによる切断)。継承(汎化)で描く。線は
  // 「サブクラス → 親」の向き(三角が LogLine 側に付く)。LogLine の下辺を角度で分けて
  // 受ける(左から 30, 10, 350, 330。線どうしが交差しない順)。
  rel("inheritance", "UserLogLine", "LogLine", undefined, "top", 30),
  rel("inheritance", "AssistantLogLine", "LogLine", undefined, "top", 10),
  rel("inheritance", "SystemLogLine", "LogLine", undefined, "top", 350),
  rel("inheritance", "AttachmentLogLine", "LogLine", undefined, "top", 330),
  // TM の再帰表「ログ行．ログ行」は線にしない(LogLine の parent_uuid / logical_parent_uuid)。
  // TM: AI応答行 → ユーザー行(ツール発行元。E-E の先行・後続で、どちらも 0..1)。ユーザー行が
  // sourceToolAssistantUUID で tool_use を発行した AI応答行を指すので、UserLogLine →
  // AssistantLogLine の関連にし、実装では ID で参照する。ラベルが箱に隠れないよう、
  // 2つのクラスの間を広めに空けている(UserLogLine の position の説明を参照)。
  rel("association", "UserLogLine", "AssistantLogLine", "source_tool_assistant", "right", "left", {
    fromMultiplicity: "0..1",
    toMultiplicity: "0..1",
  }),
  // ---- Phase 1(実行中セッション・権限の問い合わせ。issue #388) ----
  // TM: セッション 1 : 実行中セッション 0..*(E-R。sessionId(R))。RunningSession は
  // プロセスの寿命で決まり、会話(Session)は所有しない(終わった会話は動いていない = 0件。
  // 同じ会話を再開すると別のプロセス)ので、コンポジションにはせず関連にし、実装では
  // 会話を session_id で参照する。Session の側からはたどらない(起点の × の意味どおり)。
  // Session の真下に RunningSession を置き、RunningSession の上辺から Session の下辺へ縦につなぐ。
  rel("association", "RunningSession", "Session", "session", "top", "bottom", {
    fromMultiplicity: "0..*",
    toMultiplicity: "1",
  }),
  // TM: 実行中セッションのサブセット(×起動元。属性構成が異なる相違のサブセット)。設計は継承だったが、
  // 実装(#391)は Rust に継承が無いため、共通のフィールドの struct RunningSession を、サブセットの
  // 型が `base` として持つコンポジションにした(RunningSession の説明を参照)。線は「部分 → 全体」の
  // 向き。RunningSession の下辺を左右に分けて出す(外部起動が左 = 20、app 起動が右 = 340。
  // 線どうしが交差しない順)。
  rel("composition", "RunningSession", "RunningSessionExternal", "base", 20, "top"),
  rel("composition", "RunningSession", "RunningSessionByApp", "base", 340, "top"),
  // プロセス状態(TM: RunningSessionByApp の属性の区分コード)。値として持つ enum なのでコンポジション。
  rel("composition", "ProcessState", "RunningSessionByApp", "process_state", "left", "right"),
  // TM: app が起動した実行中セッション 1 : 権限の問い合わせ 0..*(E-E。問い合わせが実行中セッションの
  // 値を (R) で継承する)。RunningSessionByApp が所有するのでコンポジション。線は「部分 → 全体」の
  // 向きで、問い合わせを ByApp の真下に置き、問い合わせの上辺から ByApp の下辺へ縦につなぐ。
  rel("composition", "PermissionRequest", "RunningSessionByApp", "permission_requests", "top", "bottom", {
    fromMultiplicity: "0..*",
  }),
  // TM: 権限の問い合わせ 1 : 権限の応答 0..1(E-E。中断で取り消されると応答が無い。request_id(R))。
  // 設計は問い合わせが応答を所有するコンポジションだったが、実装(#391)は問い合わせが応答を
  // 持たず、応答の側が request_id で問い合わせを指す(応答は組み立てて CLI へ書く値で、答えた
  // 問い合わせは答え待ちの列から外れる)ので、関連にした。問い合わせの側からはたどらない
  // (起点の × の意味どおり)。応答は問い合わせの右に置き、問い合わせの右辺の上寄り(250°)で
  // 受ける(下寄り 290° は問い合わせ種別の線に使う)。
  rel("association", "PermissionResponse", "PermissionRequest", "request_id", "left", 250, {
    fromMultiplicity: "0..1",
    toMultiplicity: "1",
  }),
  // 決着種別(TM: 権限の応答の属性の区分コード)。値として持つ enum なのでコンポジション。
  rel("composition", "PermissionBehavior", "PermissionResponse", "behavior", "left", "right"),
  // TM: 権限の問い合わせ 1 : 提案 0..*(多値。request_id(R))。問い合わせが所有するのでコンポジション。
  // 提案は問い合わせの真下に置き、提案の上辺から問い合わせの下辺へ縦につなぐ。
  rel("composition", "PermissionSuggestion", "PermissionRequest", "suggestions", "top", "bottom", {
    fromMultiplicity: "0..*",
  }),
  // 問い合わせ種別(TM: (D) 導出。実装ではフィールドにせず、tool_name から求める)。属性の型を
  // 表す線で、導出でも型の関係は変わらないため引く。問い合わせの右辺の下寄り(290°)で受ける。
  rel("composition", "PermissionRequestKind", "PermissionRequest", "request_kind", "left", 290),
];

export const DOMAIN_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};

// 全24クラスが実装済み(Pc・User(第1弾)・GitRepository・GitBranch・GitWorktree(第2〜3弾)・
// Session(第4弾)・SessionFile(第5弾)・LogLine・UserLogLine・AssistantLogLine・
// SystemLogLine・AttachmentLogLine(第6弾)・Profile(classes-native-prototype.ts から昇格)・
// Phase 1 の11クラス(issue #388 で設計、#391 で実装))。すべて filePath を持つ。
// Phase 1 の型は、実装の結果、設計と形が違う所がある(冒頭の【Phase 1: 実装との差】)。
export const DOMAIN_CLASS_FILE_PATHS: ClassFilePaths = filePaths;
export const DOMAIN_CLASS_LAYERS: ClassLayers = layers;
