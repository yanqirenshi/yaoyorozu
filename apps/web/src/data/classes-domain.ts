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
 * (第5弾)、ログ行(第6弾。行種別のサブセット4種と、親子のつながりを含む)。設定ファイル類、
 * セッションまわりの残り(入力キュー・実行中セッション)、システム行・付帯情報行の細分
 * (TM でサブセットに分ける段階)は次段以降。既存のクラスとそれらの関係も、相手のクラスを
 * 書く段階で足す。
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
 *   会話ファイル(`conversation_file`、1件)とサブエージェントのファイル(`subagent_files`、
 *   0件以上)を別の役割で持ち、どちらに入っているかで種別が決まるため。1件の枠を分ける
 *   ことで、ファイルが0件のセッション(TM の 1..* に反する)を型で作れなくもしている。
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
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import {
  attr,
  defineDiagram,
  method,
  type ClassDef,
  type ClassFilePaths,
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
      // parsed は読み込み済みのパース結果(1セッション分。具体的な型は実装側
      // (issue #208)が決める)。ファイルI/O・jsonl のパース自体はこのメソッドの
      // 責務ではない(port が担う。「メソッドを書く基準」を参照)。組み立てるのは
      // Session とその配下の SessionFile まで。LogLine は遅延読み込みのため、
      // ここでは組み立てない(セッションを開いたときに別途構築する。issue #207)。
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
  },
  {
    name: { physical: "AttachmentLogLine", logical: "AttachmentLogLine", description: "実行環境が会話に注入した情報の行(type = attachment)。TM: 付帯情報行(イベントのサブセット)" }, // 論理名: 付帯情報行
    attributes: [
      // TM: 付帯情報種別(23種)。SystemLogLine の subtype と同じく、TM で分けた段階でサブクラスにする。
      attr("attachment_type", "String"),
    ],
    position: { x: 1317, y: 1248 },
  },
];

const { classes, rel, filePaths } = defineDiagram(DEFS);

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
  // 会話ファイル1件 + サブエージェント0件以上、ファイルは必ず1つの会話に属する。
  // Session が SessionFile を所有するのでコンポジションにし、役割(会話ファイル /
  // サブエージェントのファイル)ごとに線を分ける。1つのファイルはどちらか一方にだけ入る。
  // 線は「部分 → 全体」の向き(◆が Session 側に付く)。SessionFile を Session の右に置き、
  // SessionFile の左辺から Session の右辺へ、2本を上下に並べてつなぐ。conversation_file は
  // 上寄り(左辺 100° → 右辺 260°)、subagent_files は下寄り(左辺 80° → 右辺 280°)で、
  // 2本は交差しない。
  rel("composition", "SessionFile", "Session", "conversation_file", 100, 260, {
    key: "conversation_file",
    fromMultiplicity: "1",
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
];

export const DOMAIN_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};

// 実装済みなのは Pc・User(第1弾)・GitRepository・GitBranch・GitWorktree(第2〜3弾)・
// Session(第4弾)の6クラス。SessionFile・LogLine・UserLogLine・AssistantLogLine・
// SystemLogLine・AttachmentLogLine(第5〜6弾。未着手)はまだ実装されていないため、
// filePath を持たない。
export const DOMAIN_CLASS_FILE_PATHS: ClassFilePaths = filePaths;
