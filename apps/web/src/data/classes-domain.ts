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
 * 問い合わせ・途中経過)。設定ファイル類、セッションまわりの残り(入力キュー)、
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
 *   会話ファイル(`conversation_files`、1..*)とサブエージェントのファイル(`subagent_files`、
 *   0..*)を別の役割で持ち、どちらに入っているかで種別が決まるため。
 * - 会話ファイルは当初 1件固定(`conversation_file`)にしていたが、実機確認でセッション途中に
 *   worktree へ移動すると、同じセッションIDの jsonl が複数のプロジェクトフォルダに分かれて
 *   できることが判明した(#214)。TM どおり `conversation_files` を 1..* に直した(#216)。
 *   1..* なので「ファイル0件のセッション」は引き続き型で作れない。複数ファイルにまたがる
 *   属性(custom_title 等)の解決規則は図には書かず、実装イシュー側(#217)で扱う。
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
 *   もの(こちらは domain の型)。app 側の型はまだどの図にも載せていない。実装のときに、
 *   どちらかを改名して名前をそろえる必要がある(domain 側は TM の物理名のまま残した)。
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
    name: { physical: "Session", logical: "Session", description: "1つの会話。セッションIDは会話開始時に発番される UUID v4 で、.jsonl のファイル名にもなる(ただしファイルは識別しない)。TM: セッション(リソース)" }, // 論理名: セッション
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
    name: { physical: "RunningSession", logical: "RunningSession", description: "いま動いている Claude Code のプロセス1つ。~/.claude/sessions/<pid>.json(と .key)が台帳。起動元(app 自身 / 外部)で分け尽くされるので抽象クラスにする。会話(Session)はこのプロセスの中で動き、終わった会話は動いていない(0件)。同じ会話を後で再開すると別のプロセスになる。TM: 実行中セッション(イベント)" }, // 論理名: 実行中セッション
    stereotype: "abstract",
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
    // messaging_socket_path と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "RunningSessionByApp", logical: "RunningSessionByApp", description: "app が子プロセスとして起動した claude CLI(PoC #382)。標準入出力(stream-json)で対話し続けるため、このサブクラスだけがプロセスの状態と権限の問い合わせを持つ。台帳は外部起動と同じ形で書かれる(entrypoint は sdk-cli)ので台帳では区別できず、app が自分の子プロセスの PID を知っていることで区分する。#361 のガード(実行中の検知)では app は自分が起動した PID を除外する。TM: 実行中セッション(app起動)(イベントのサブセット)" }, // 論理名: 実行中セッション(app起動)
    attributes: [
      attr("process_state", "ProcessState"), // TM: プロセス状態
      attr("process_state_at", "u64"), // TM: プロセス状態の更新日時
    ],
    methods: [
      // 状態遷移は純粋な関数(I/O は port の責務。「メソッドを書く基準」を参照)。
      // 入口・出口は PoC #382 レポート §7.1:
      //   Initialized: 起動中 → 待機 / MessageSent: 待機 → 実行中 / PermissionAsked: 実行中 → 権限待ち
      //   PermissionSettled: 権限待ち → 実行中 / TurnFinished: 実行中 → 待機 / Exited: どの状態からでも → 終了
      // 表にない組み合わせは状態を変えない(実行中に次の入力を送っても実行中のまま。キューは CLI 側)。
      // 終了は戻らない。いずれの場合も at_time を process_state_at に記録する。
      method("apply", ["trigger: ProcessTrigger", "at_time: u64"], "()"),
    ],
    position: { x: 400, y: 2350 },
    // apply の引数が長く、戻り値型の列と重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 330, h: 0 },
  },
  {
    name: { physical: "RunningSessionExternal", logical: "RunningSessionExternal", description: "app 以外(ターミナルの claude、Claude Desktop、ほかの SDK 利用)が起動した実行中セッション。app は台帳から存在を知るだけで、標準入出力を持たないため対話できない。右側の語彙は親が持つものだけ。TM: 実行中セッション(外部起動)(イベントのサブセット)" }, // 論理名: 実行中セッション(外部起動)
    attributes: [],
    position: { x: 55, y: 2350 },
    size: { w: 260, h: 0 },
  },
  {
    name: { physical: "ProcessState", logical: "ProcessState", description: "app が起動した claude CLI プロセスの状態(PoC #382 レポート §7.1)。app 側が持つ状態で台帳には無い(台帳の status: idle / busy より細かい)。履歴が必要になったら、状態の移り変わりをイベントとして別に立てる(TM)。TM: プロセス状態(RunningSessionByApp の属性の区分コード)" }, // 論理名: プロセス状態
    stereotype: "enumeration",
    // 起動中 / 待機 / 実行中 / 権限待ち / 終了。
    attributes: ["Starting", "Idle", "Running", "AwaitingPermission", "Exited"].map(label),
    position: { x: 900, y: 2350 },
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
    position: { x: 1200, y: 2350 },
  },
  {
    name: { physical: "PermissionRequest", logical: "PermissionRequest", description: "CLI から届く control_request(subtype: can_use_tool)。ツールを使ってよいかを app に尋ねる(PoC #382 レポート §2.1)。AskUserQuestion(選択肢)と ExitPlanMode(計画の承認)も同じ形で届く(§2.4)ので、tool_name から求まる問い合わせ種別(/request_kind)で区別して画面を出し分ける。tool_use_id は AI応答行の tool_use ブロックを指すが、ブロックは TM の第2弾でモノにするため今は結ばない。TM: 権限の問い合わせ(イベント)" }, // 論理名: 権限の問い合わせ
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
    position: { x: 400, y: 2650 },
    // tool_input と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 330, h: 0 },
  },
  {
    name: { physical: "PermissionRequestKind", logical: "PermissionRequestKind", description: "権限の問い合わせの種別。tool_name から求まる(導出)。ToolUse: 通常のツール使用の許可 / AskUserQuestion: 選択肢の質問(許可・拒否ではなく、ユーザーの選択を更新後の入力に入れて返す。レポート §2.4)/ ExitPlanMode: 計画の承認。TM: 問い合わせ種別(D)" }, // 論理名: 問い合わせ種別
    stereotype: "enumeration",
    attributes: ["ToolUse", "AskUserQuestion", "ExitPlanMode"].map(label),
    position: { x: 830, y: 3050 },
    size: { w: 230, h: 0 },
  },
  {
    name: { physical: "PermissionResponse", logical: "PermissionResponse", description: "app が返す control_response(レポート §2.1)。許可なら更新後の入力(そのまま、または書き換えた引数)を返し、拒否なら拒否メッセージがそのままモデルへの tool_result になる。「今後も許可」は更新後の権限に入れて返す。中断すると CLI から control_cancel_request が来て、app は応答せずに終わるため、決着種別に取り消しを含める(取り消しのときは更新後の入力・拒否メッセージ・更新後の権限は持たない)。問い合わせとは別の行為(日時が別)なので別のクラスにし、問い合わせが 0..1 を持つ。TM: 権限の応答(イベント)" }, // 論理名: 権限の応答
    attributes: [
      // 個体指定子は request_id(R)だけ。関係線 response で表す。
      attr("behavior", "PermissionBehavior"), // TM: 決着種別
      attr("updated_input", "Option<serde_json::Value>"), // 許可のとき。TM: 更新後の入力
      attr("deny_message", "Option<String>"), // 拒否のとき
      // PermissionSuggestion と同じ形(SDK の PermissionUpdate 型)の列。TM: 更新後の権限
      attr("updated_permissions", "Option<serde_json::Value>"),
      attr("responded_at", "u64"), // TM: 応答日時
    ],
    position: { x: 830, y: 2650 },
    // updated_permissions と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "PermissionBehavior", logical: "PermissionBehavior", description: "権限の問い合わせの決着種別。Allow: 許可 / Deny: 拒否 / Cancelled: 取り消し(中断による control_cancel_request)。TM: 決着種別" }, // 論理名: 決着種別
    stereotype: "enumeration",
    attributes: ["Allow", "Deny", "Cancelled"].map(label),
    position: { x: 1330, y: 2650 },
    size: { w: 200, h: 0 },
  },
  {
    name: { physical: "PermissionSuggestion", logical: "PermissionSuggestion", description: "permission_suggestions の1件(レポート §2.1)。setMode / addRules / addDirectories などの種別と、適用先(session / localSettings など)を持つ。SDK の PermissionUpdate 型そのもので、許可応答の更新後の権限に入れ返すと「今後も許可」になる。TM: 権限の問い合わせ．提案(多値)" }, // 論理名: 権限の問い合わせ．提案
    attributes: [
      // 個体指定子は request_id(R)だけで、1件ごとには一意でない。関係線 suggestions で表す。
      attr("suggestion_type", "String"), // 提案種別
      attr("suggestion_destination", "String"), // 適用先
      attr("suggestion_content", "serde_json::Value"), // 内容(種別ごとに形が違う)
    ],
    position: { x: 400, y: 3050 },
    size: { w: 350, h: 0 },
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
  // 会話ファイル1..* + サブエージェント0件以上、ファイルは必ず1つの会話に属する。
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
  rel("composition", "SessionFile", "Session", "conversation_files", 100, 260, {
    key: "conversation_files",
    fromMultiplicity: "1..*",
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
  // TM: 実行中セッションのサブセット(×起動元。属性構成が異なる相違のサブセット)。継承で描く。
  // 線は「サブクラス → 親」の向き。RunningSession の下辺を左右に分けて受ける
  // (外部起動が左 = 20、app 起動が右 = 340。線どうしが交差しない順)。
  rel("inheritance", "RunningSessionExternal", "RunningSession", undefined, "top", 20),
  rel("inheritance", "RunningSessionByApp", "RunningSession", undefined, "top", 340),
  // プロセス状態(TM: RunningSessionByApp の属性の区分コード)。値として持つ enum なのでコンポジション。
  rel("composition", "ProcessState", "RunningSessionByApp", "process_state", "left", "right"),
  // TM: app が起動した実行中セッション 1 : 権限の問い合わせ 0..*(E-E。問い合わせが実行中セッションの
  // 値を (R) で継承する)。RunningSessionByApp が所有するのでコンポジション。線は「部分 → 全体」の
  // 向きで、問い合わせを ByApp の真下に置き、問い合わせの上辺から ByApp の下辺へ縦につなぐ。
  rel("composition", "PermissionRequest", "RunningSessionByApp", "permission_requests", "top", "bottom", {
    fromMultiplicity: "0..*",
  }),
  // TM: 権限の問い合わせ 1 : 権限の応答 0..1(E-E。中断で取り消されると応答が無い。request_id(R))。
  // 問い合わせが所有するのでコンポジション。応答は問い合わせの右に置き、問い合わせの右辺の
  // 上寄り(250°)で受ける(下寄り 290° は問い合わせ種別の線に使う)。
  rel("composition", "PermissionResponse", "PermissionRequest", "response", "left", 250, {
    fromMultiplicity: "0..1",
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

// 実装済みなのは 13クラス(Pc・User(第1弾)・GitRepository・GitBranch・GitWorktree(第2〜3弾)・
// Session(第4弾)・SessionFile(第5弾)・LogLine・UserLogLine・AssistantLogLine・
// SystemLogLine・AttachmentLogLine(第6弾)・Profile(classes-native-prototype.ts から昇格))で、
// filePath を持つ。Phase 1 の11クラス(RunningSession・RunningSessionByApp・
// RunningSessionExternal・ProcessState・ProcessTrigger・PermissionRequest・
// PermissionRequestKind・PermissionResponse・PermissionBehavior・PermissionSuggestion・
// ProgressEvent。issue #388)は設計のみで、まだ実装されていないため filePath を持たない。
export const DOMAIN_CLASS_FILE_PATHS: ClassFilePaths = filePaths;
export const DOMAIN_CLASS_LAYERS: ClassLayers = layers;
