/**
 * `~/.claude/projects/` 配下に記録される Claude Code のセッションログ(`.jsonl`)の
 * データモデル(TM)。
 *
 * スキーマ根拠: reports/claude-session-jsonl-format.md(実測 146ファイル / 60,941行)
 * 記法: 佐藤正美/SDI「モデル作成の手続き」(TM / T字形ER)の規則に従う。
 *
 * 【TM の規則のうち、本モデルで効いているもの】
 * - モノ ≡ 個体指定子が付与されている対象。ユーザ言語に存在しない ID・連番を持ち込まない。
 * - イベント ≡ 出来事・行為・取引の(過去)日付が帰属するモノ。それ以外はリソース。
 * - 左側は個体指定子(継承したものは `(R)` を付ける)、右側はそれ以外の語彙。
 * - 導出できる値には `(D)` を付ける。
 * - サブセットは区分コードによる切断。部分集合は区分コードを持つ。
 *
 * 【実行環境(PC / ユーザー / Gitリポジトリ)】
 * セッションログの中身だけでなく、それを生んだ環境も同じ図に置く。
 *
 * CLAUDE.md / settings.json / settings.local.json は**イベント**として立てている。
 * TM には「ネジは部品か製品か」という観点があり、同じモノでもドメインでの扱いが変わる。
 * 部品として扱うならリソースだが、製品として扱うならその手配(組立・購入)が業務に
 * なりイベントになる。このアプリはこれらの設定ファイルを**作成・編集すること自体が
 * 機能**(infra の claude_md_store / project_settings_store)なので、製品として扱う。
 * したがって `作成日` / `更新日` は「データ登録日・更新日」ではなく、手配という行為の
 * 日付にあたる。
 *
 * セッションログの `.jsonl` は逆で、アプリは読むだけで作らない。こちらは部品として
 * 扱い、`セッションファイル(jsonl)` というリソースのままにしている。同じ「ファイル」
 * でも扱いが違うため、1つのエンティティにまとめない。
 *
 * 未決の課題を2つ残している(いずれも現時点では対応不要と判断済み)。
 *  1. `作成日` と `更新日` を1つの箱に同居させている。手配が業務なら「作成」と「編集」は
 *     別の行為なので、本来は **イベントの相違サブセット**(作成 / 更新)に分けるか、
 *     DTL(変更履歴)で持つ。詳細を詰める段になったら分割する。
 *  2. 同じ基準だと `.claude/rules/*.md`(rules_store)と
 *     `.claude/skills/<name>/SKILL.md`(skills_store)、`~/.claude/settings.json`
 *     (claude_settings_store)もイベントになる。rules / skills は1リポジトリに複数
 *     あるため多値(MO)になる見込み。追って追加する。
 *
 * 【第1弾のスコープ】セッションと行の骨格まで。
 * メッセージ本体(コンテンツブロック・ツール・トークン使用量)、`system` 4種 /
 * `attachment` 23種の詳細、`pr-link` と GitHub の関係は次段以降で追加する。
 * ファイルは本来サブエージェント(第3弾)の語彙と一緒に立てる予定だったが、セッションIDが
 * ファイルを識別しないことが判明したためモノとして先に立てた。ファイル種別によるサブ
 * セットへの展開、エージェントID、meta.json(agentType / name / toolUseId)は第3弾で扱う。
 *
 * 【関係の検証(モノ × モノ の網羅性)】
 * 25エンティティの全300ペアを確認した。関係があるのは28ペア(29本)。
 * 残る272ペアのうち、以下5ペアは「語彙は存在するが今は関係を構成していない」ものであり、
 * 見落としではなく判断の記録として残す。
 *
 * - ログ行 × 入力キュー / 入力キュー × ユーザー行
 *   queue-operation は直後の user 行に対応するはずだが、queue-operation 側は
 *   operation / timestamp / sessionId / content しか持たず、uuid も promptId も無い
 *   (報告書 §4.3)。個体指定子で結べないため関係を構成しない。
 * - AI応答行 × システム行 / AI応答行 × 付帯情報行
 *   stop_hook_summary と hook_additional_context が持つ toolUseID は tool_use ブロックを
 *   指す(報告書 §4.10、§5)。第2弾で「ツール呼び出し」をモノにした時点で、そちらに
 *   対する関係として立つ。その際、現在 sourceToolAssistantUUID で直接張っている
 *   ユーザー行 × AI応答行 の関係も、ツール呼び出し経由に組み替わる可能性がある。
 * - ログ行 × Gitブランチ
 *   ログ行は gitBranch(ブランチ名)を右側の属性として持つが、関係では結ばない。
 *   ログに記録されるのは名前だけで新設した GitブランチID は無く、行が持つのは cwd で
 *   リポジトリパスではないため(cwd は node_modules 配下も含む)、どのリポジトリの
 *   どのブランチかを個体指定子で決められない。
 *
 * 他の267ペアは直接の関係を構成しないのが正しい。内訳は、サブセットが親(ログ行)から
 * 行UUIDを継承しており親で張った関係がそのまま効くもの16ペア、対照表・対応表を経由する
 * もの7ペア(PC × ユーザー / PC × Gitリポジトリ / ユーザー × セッション / Gitブランチ
 * × ワーキングツリー / 作業ディレクトリ × セッションファイル / 作業ディレクトリ ×
 * セッション / セッションファイル × セッション)、対応する語彙がそもそも存在しない
 * もの244ペア。
 *
 * 【オブジェクトモデル(/class-diagram)との違い】
 * Classes は `.jsonl` の「型の構造」(serde でどうデシリアライズするか)を描く。
 * 本ファイルは「何を個体指定子として、何と何が関係するか」を描く。
 * そのため両者でモノの切り方が変わる。例えば `custom-title` / `mode` などのメタ行は
 * Classes では SessionLine の独立したバリアントだが、TM では個体指定子を持たないため
 * モノにならず、セッションという1つのモノの属性に落ちる。
 */

import type { TerData, TerEntityType } from "@yanqirenshi/d3.ter";

/* ------------------------------------------------------------------ *
 *  d3.ter に渡すデータの型
 *
 *  0.1.22 から型定義が同梱されたため、原則そちら(Ter*)に合わせる。
 *  `TmDataCheck` で TerData への代入可能性をコンパイル時に検証している。
 *  ただし同梱の型と実装で食い違う点が3つあり、いずれも実装側に合わせている
 *  (Foolsgolds/Assholes へ別途起票する)。
 *   1. エンティティの `name` は `string` 宣言。実装(utils/Name.js の set)は
 *      `{ physical, logical }` も受け付けるが、宣言に従って論理名の文字列を渡し、
 *      物理名は ENTITY_DEFS 側に保持する。
 *   2. 識別子・属性インスタンスの `name`(マスタ名の上書き)が宣言されていないが、
 *      実装は `data.name ? data.name : master.name` で受け付ける。
 *      TM の `(R)` 表記をマスタを重複させずに実現するために使う。
 *   3. `optionality` の説明が「0=必須, 1=任意」と書かれているが、実装は逆。
 *      (Port.js の positionOptionality が 0 で丸、1 で横棒を描く)
 * ------------------------------------------------------------------ */

/** 物理名(JSON のフィールド名)と論理名(日本語)。図には論理名が表示される。 */
export type TmName = { physical: string; logical: string };

/**
 * エンティティの種別。d3.ter が解釈できる値のみ(未知の値は例外で落ちる)。
 * `COMPARATIVE` が対照表(TS)、`CORRESPONDENCE` が対応表(TO)、
 * `MANY-VALUED-OR` / `MANY-VALUED-AND` が多値(MO / MA)にあたる。
 * 0.1.22 で多値と `CLASS` が追加された(Foolsgolds/Assholes#14、#17)。
 */
export type TmEntityType = TerEntityType;

export type TmIdentifier = { id: number; name: TmName };
export type TmAttribute = { id: number; name: TmName };

export type TmEntity = {
  id: number;
  type: TmEntityType;
  /** 図に出す名前。同梱の型が `string` 宣言のため論理名だけを渡す(物理名は ENTITY_DEFS 側に残す)。 */
  name: string;
  /** 図には描画されないが、モデルの根拠を残すために持たせる(d3.ter は保持のみ)。 */
  description: string;
  position: { x: number; y: number; z: number };
  /** `{ w: 0, h: 0 }` を渡すと d3.ter が内容から実寸を算出する。 */
  size: { w: number; h: number };
  /** `name` を与えるとプールのマスタ名を上書きして表示できる(`(R)` 表記に使う)。 */
  identifiers: { id: number; identifier: number; name?: TmName }[];
  attributes: { id: number; attribute: number; name?: TmName }[];
};

/**
 * リレーションシップの端点。
 * - `position`: エンティティ矩形のどこから線を出すかの角度。d3.ter の Geometry は
 *   基準ベクトルを (0, +対角長) から回すため **0=下 / 90=左 / 180=上 / 270=右**
 *   (SVG座標なので y は下向き)。
 * - `cardinality`: 1=単一(横棒) / 3=複数(鳥足)。
 * - `optionality`: **1=必須(横棒) / 0=任意(丸)**。
 *   同梱の型定義のコメントは「0=必須, 1=任意」と逆に書かれているが、実装
 *   (Port.js の positionOptionality)は 0 で丸、1 で横棒を描く。実装に合わせる。
 *
 * TM の4つの結線(1対1 / 1対複数 / 1対「1または値なし」/ 1対「複数または値なし」)は
 * この2つの組み合わせで表す。
 */
export type TmPort = {
  entity: number;
  position: number;
  cardinality: 1 | 3;
  optionality: 0 | 1;
};

/** サブセット結線の区分コード表記(0.1.22 で追加。Foolsgolds/Assholes#15)。 */
export type TmSubset = { kind: "same" | "different"; code: string };

export type TmRelationship = {
  id: number;
  from: TmPort;
  to: TmPort;
  /** 結線の中点に出すラベル(0.1.22 で追加。Foolsgolds/Assholes#16)。 */
  label?: string;
  /** サブセットへの結線に `=区分コード` / `×区分コード` を出す。label より優先される。 */
  subset?: TmSubset;
};

export type TmData = {
  identifiers: TmIdentifier[];
  attributes: TmAttribute[];
  entities: TmEntity[];
  relationships: TmRelationship[];
};

/** `TmData` が d3.ter の受け取る構造と矛盾していないことをコンパイル時に確かめる。 */
type AssertAssignable<T extends TerData> = T;
export type TmDataCheck = AssertAssignable<TmData & TerData>;

/* ------------------------------------------------------------------ *
 *  個体指定子と属性のプール
 *
 *  d3.ter は個体指定子・属性をトップレベルのプールに置き、エンティティ側は数値 ID で
 *  参照する(同じ語彙が複数のエンティティに現れることを表現できる)。
 *  ID を手で採番すると壊れやすいので、物理名をキーにした定義から機械的に採番する。
 * ------------------------------------------------------------------ */

const IDENTIFIER_DEFS: TmName[] = [
  // OS 由来の実在値を使う(勝手に採番しない)。systemUuid は Windows の
  // MachineGuid のようなマシン固有の値、userId は OS のユーザー名。
  { physical: "systemUuid", logical: "システムUUID" },
  { physical: "userId", logical: "ユーザーID" },
  { physical: "repositoryPath", logical: "リポジトリパス" },
  // git はブランチにもワーキングツリーにも ID を持たない(ブランチの実体は
  // refs/heads/<名前> にコミットハッシュが1行あるだけ)。現状分析としては
  // 「管理対象と認識されていない」という結論だが、業務改善として管理対象に
  // するため ID を新設する。
  { physical: "branchId", logical: "GitブランチID" },
  { physical: "worktreeId", logical: "ワーキングツリーID" },
  { physical: "cwd", logical: "作業ディレクトリパス" },
  { physical: "filePath", logical: "ファイルパス" },
  { physical: "sessionId", logical: "セッションID" },
  { physical: "uuid", logical: "行UUID" },
  // 再帰表が継承する行UUID。0.1.22 で結線にラベルを出せるようになったため
  // (Foolsgolds/Assholes#16)、親子の別は線のラベルで示し、箱の中は TM の
  // 部品表の例と同じく両方とも `行UUID(R)` と書く。
  { physical: "parentUuid", logical: "行UUID(R)" },
  { physical: "childUuid", logical: "行UUID(R)" },
  // ツール実行結果の行が、その tool_use を発行した AI応答行を指す(E-E の先行・後続)。
  // 役割は結線のラベルで示すため、箱の中は `行UUID(R)` と書く。
  { physical: "sourceToolAssistantUUID", logical: "行UUID(R)" },
];

const ATTRIBUTE_DEFS: TmName[] = [
  { physical: "pcName", logical: "PC名" },
  // PC と Gitリポジトリ で同じ語彙を共有する。
  { physical: "description", logical: "説明" },
  { physical: "userName", logical: "ユーザー名" },
  { physical: "homeDirectory", logical: "ホームディレクトリ" },
  { physical: "repositoryName", logical: "リポジトリ名" },
  { physical: "branchName", logical: "ブランチ名" },
  { physical: "worktreeName", logical: "ワーキングツリー名" },
  // ワーキングツリーは2つのパスを持つ。実物のディレクトリ(Claude Code が
  // .claude/worktrees/ 配下に作る)と、その直下の .git ファイル(66バイトで、
  // git 側の台帳 .git/worktrees/<名前> を指す)。
  { physical: "worktreeFolderPath", logical: "フォルダパス(Claude)" },
  { physical: "worktreeGitFilePath", logical: "ファイルパス(git)" },
  { physical: "createdAtTime", logical: "作成日時" },
  { physical: "deletedAtTime", logical: "削除日時" },
  // アプリが管理する設定ファイルの手配イベントで使う。ファイルパスは
  // リポジトリ(またはホーム)からの位置が決まっているため右側に置く。
  { physical: "filePathFull", logical: "ファイルパス" },
  { physical: "createdAt", logical: "作成日" },
  { physical: "updatedAt", logical: "更新日" },
  // フォルダ名は作業ディレクトリパスから機械的に導出される(英数字以外を1文字ずつ `-`
  // に置換)。置換は不可逆でフォルダ名からパスは復元できないため、個体指定子はパスの側。
  { physical: "folderName", logical: "フォルダ名(D)" },
  // ファイルを切る区分コード。第3弾でサブセットに展開する。
  { physical: "fileKind", logical: "ファイル種別" },
  { physical: "customTitle", logical: "会話タイトル" },
  { physical: "aiTitle", logical: "AI生成タイトル" },
  { physical: "mode", logical: "モード" },
  { physical: "slug", logical: "セッション別名" },
  // last-prompt 行は直近のユーザー入力の複製(表示用キャッシュ)であり、ログ行から
  // 導出できる。アトリビュート・リストの段で実装要否を判断する候補。
  { physical: "lastPrompt", logical: "直近入力テキスト(D)" },
  { physical: "timestamp", logical: "記録日時" },
  // ログ行のサブセットを切る区分コード。
  { physical: "type", logical: "行種別" },
  { physical: "entrypoint", logical: "入口" },
  { physical: "version", logical: "バージョン" },
  { physical: "gitBranch", logical: "gitブランチ" },
  { physical: "isSidechain", logical: "サブエージェント区分" },
  { physical: "userType", logical: "ユーザー種別" },
  { physical: "promptId", logical: "入力ID" },
  { physical: "permissionMode", logical: "権限モード" },
  { physical: "requestId", logical: "APIリクエストID" },
  { physical: "messageId", logical: "APIメッセージID" },
  { physical: "model", logical: "モデルID" },
  { physical: "stopReason", logical: "停止理由" },
  { physical: "subtype", logical: "システム副種別" },
  { physical: "level", logical: "重要度" },
  { physical: "attachmentType", logical: "付帯情報種別" },
  { physical: "linkKind", logical: "チェーン種別" },
  { physical: "enqueuedAt", logical: "投入日時" },
  { physical: "content", logical: "入力テキスト" },
];

const IDENTIFIER_BASE_ID = 1;
const ATTRIBUTE_BASE_ID = 101;
const ENTITY_BASE_ID = 201;
const RELATIONSHIP_BASE_ID = 501;
// 個体指定子インスタンス / 属性インスタンスの ID。エンティティをまたいで一意にする。
const IDENTIFIER_INSTANCE_BASE_ID = 1001;
const ATTRIBUTE_INSTANCE_BASE_ID = 2001;

const IDENTIFIERS: TmIdentifier[] = IDENTIFIER_DEFS.map((name, i) => ({
  id: IDENTIFIER_BASE_ID + i,
  name,
}));

const ATTRIBUTES: TmAttribute[] = ATTRIBUTE_DEFS.map((name, i) => ({
  id: ATTRIBUTE_BASE_ID + i,
  name,
}));

/**
 * エンティティ定義で使う語彙の参照。`"sessionId(R)"` のように末尾に `(R)` を書くと、
 * プールのマスタを参照したまま表示名だけ `セッションID(R)` に差し替える。
 * TM の「継承した個体指定子には (R) を付ける」表記を、マスタを重複させずに実現する。
 */
const RELATION_SUFFIX = "(R)";

function parseRef(ref: string): { physical: string; relation: boolean } {
  return ref.endsWith(RELATION_SUFFIX)
    ? { physical: ref.slice(0, -RELATION_SUFFIX.length), relation: true }
    : { physical: ref, relation: false };
}

function findName(defs: TmName[], physical: string, kind: string): TmName {
  const found = defs.find((n) => n.physical === physical);
  if (!found) throw new Error(`unknown ${kind}: ${physical}`);
  return found;
}

function poolId(defs: TmName[], baseId: number, physical: string): number {
  const i = defs.findIndex((n) => n.physical === physical);
  return baseId + i;
}

/* ------------------------------------------------------------------ *
 *  エンティティ
 * ------------------------------------------------------------------ */

type EntityDef = {
  name: TmName;
  type: TmEntityType;
  description: string;
  position: { x: number; y: number };
  /** 左側。自分の個体指定子と、他のモノから継承したもの(`(R)` を付ける)。 */
  identifiers: string[];
  /** 右側。個体指定子以外の語彙。 */
  attributes: string[];
};

const ENTITY_DEFS: EntityDef[] = [
  // ============ 実行環境(PC / ユーザー / Gitリポジトリ) ============
  {
    name: { physical: "Pc", logical: "PC" },
    type: "RESOURCE",
    description:
      "Claude Code を動かしているマシン。個体指定子は OS 由来のマシン固有値(Windows なら MachineGuid 等)を使い、アプリで勝手に採番しない。日付が帰属しないためリソース。",
    position: { x: 0, y: 0 },
    identifiers: ["systemUuid"],
    attributes: ["pcName", "description"],
  },
  {
    name: { physical: "User", logical: "ユーザー" },
    type: "RESOURCE",
    description:
      "マシンを使う人。個体指定子は OS のユーザー名。ホームディレクトリ配下(~/.claude/)に CLAUDE.md や settings.json を持つ。日付が帰属しないためリソース。",
    position: { x: 0, y: 400 },
    identifiers: ["userId"],
    attributes: ["userName", "homeDirectory"],
  },
  {
    name: { physical: "GitRepository", logical: "Gitリポジトリ" },
    type: "RESOURCE",
    description:
      "プロダクト開発の対象リポジトリ。個体指定子はリポジトリのパス。配下に CLAUDE.md / .claude/settings.json / .claude/settings.local.json を持つ。作業ディレクトリとは別のモノとして扱う(作業ディレクトリは行の cwd として現れた任意のパスの集合であり、リポジトリは管理対象として登録されたものだけ)。両者の対応が必要になった段階で対照表を立てる。",
    position: { x: 560, y: 400 },
    identifiers: ["repositoryPath"],
    attributes: ["repositoryName", "description"],
  },
  {
    name: { physical: "GitBranch", logical: "Gitブランチ" },
    type: "EVENT",
    description:
      "ブランチの作成・削除。git 自体はブランチに ID を持たず、実体は refs/heads/<名前> にコミットハッシュが1行あるだけで、改名すると前後を結ぶ情報が残らない。現状分析としては「管理対象と認識されていない」が、業務改善として管理対象にするため GitブランチID を新設する。アプリがブランチを作る・消すことが業務であるためイベント。",
    position: { x: 1150, y: 1400 },
    identifiers: ["branchId", "repositoryPath(R)"],
    attributes: ["branchName", "description", "createdAtTime", "deletedAtTime"],
  },
  {
    name: { physical: "GitWorktree", logical: "ワーキングツリー" },
    type: "EVENT",
    description:
      "ワーキングツリーの作成・削除。git はワーキングツリーにも ID を持たず、識別子は台帳(.git/worktrees/<名前>)のディレクトリ名だけで、これはパス由来である。ブランチと同じく業務改善として ワーキングツリーID を新設する。フォルダパス(Claude)は実物のディレクトリ、ファイルパス(git)はその直下の .git ファイル(66バイトで台帳を指す)。",
    position: { x: 1770, y: 1400 },
    identifiers: ["worktreeId", "repositoryPath(R)"],
    attributes: [
      "worktreeName",
      "description",
      "worktreeFolderPath",
      "worktreeGitFilePath",
      "createdAtTime",
      "deletedAtTime",
    ],
  },
  {
    name: { physical: "GitBranchWorktree", logical: "Gitブランチ．ワーキングツリー" },
    type: "CORRESPONDENCE",
    description:
      "どのブランチをどのワーキングツリーが開いているか。どちらもイベントのため E-E であり、対応表で構成する(リソースどうしなら対照表だが、ここは両方イベント)。同じブランチを同時に開けるワーキングツリーは1つだけで、detached HEAD のワーキングツリーはブランチを持たない。",
    position: { x: 2400, y: 1400 },
    identifiers: ["branchId(R)", "worktreeId(R)"],
    attributes: [],
  },
  {
    name: { physical: "PcUser", logical: "PC．ユーザー" },
    type: "COMPARATIVE",
    description:
      "どのユーザーがどのマシンを使うか。PC とユーザーはどちらもリソースであり、R-R の関係は多重度によらず対照表で構成する。",
    position: { x: 0, y: 190 },
    identifiers: ["systemUuid(R)", "userId(R)"],
    attributes: [],
  },
  {
    name: { physical: "PcGitRepository", logical: "PC．Gitリポジトリ" },
    type: "COMPARATIVE",
    description:
      "どのマシンにどのリポジトリが置かれているか。同じリポジトリを複数のマシンにクローンしうるため、R-R の対照表が要る。",
    position: { x: 560, y: 190 },
    identifiers: ["systemUuid(R)", "repositoryPath(R)"],
    attributes: [],
  },
  {
    name: { physical: "UserSession", logical: "ユーザー．セッション" },
    type: "COMPARATIVE",
    description:
      "どの会話が誰のものか。ユーザーとセッションはどちらもリソースのため対照表で構成する。",
    position: { x: 0, y: 660 },
    identifiers: ["userId(R)", "sessionId(R)"],
    attributes: [],
  },
  {
    name: { physical: "RepoClaudeMd", logical: "CLAUDE.md(リポジトリ)" },
    type: "EVENT",
    description:
      "リポジトリ直下の CLAUDE.md をアプリが作成・編集する行為(infra の claude_md_store)。このアプリにとって設定ファイルは「部品」ではなく「製品」であり、その手配(作成・編集)が業務そのものであるためイベントとして扱う。1リポジトリに1つなのでリポジトリパスで識別できる。",
    position: { x: 560, y: 660 },
    identifiers: ["repositoryPath(R)"],
    attributes: ["filePathFull", "createdAt", "updatedAt"],
  },
  {
    name: { physical: "RepoSettings", logical: "settings.json(リポジトリ)" },
    type: "EVENT",
    description:
      "リポジトリの .claude/settings.json をアプリが作成・編集する行為(infra の project_settings_store)。",
    position: { x: 560, y: 880 },
    identifiers: ["repositoryPath(R)"],
    attributes: ["filePathFull", "createdAt", "updatedAt"],
  },
  {
    name: { physical: "RepoSettingsLocal", logical: "settings.local.json(リポジトリ)" },
    type: "EVENT",
    description:
      "リポジトリの .claude/settings.local.json をアプリが作成・編集する行為(infra の project_settings_store)。settings.json と属性構成は同じだが、扱う値の性質(共有しないローカル設定)が違うため別のモノとして立てる。",
    position: { x: 560, y: 1100 },
    identifiers: ["repositoryPath(R)"],
    attributes: ["filePathFull", "createdAt", "updatedAt"],
  },
  {
    name: { physical: "UserClaudeMd", logical: "CLAUDE.md(ユーザー)" },
    type: "EVENT",
    description:
      "ホームディレクトリ配下(~/.claude/CLAUDE.md)をアプリが作成・編集する行為。現時点のアプリにこのファイル用の store は無く(ユーザー側で扱っているのは ~/.claude/settings.json)、これから機能化する対象として置いている。",
    position: { x: 0, y: 880 },
    identifiers: ["userId(R)"],
    attributes: ["filePathFull", "createdAt", "updatedAt"],
  },

  // ============ リソース ============
  {
    name: { physical: "ProjectFolder", logical: "作業ディレクトリ" },
    type: "RESOURCE",
    description:
      "作業ディレクトリの絶対パス。~/.claude/projects/<フォルダ名>/ のフォルダ名は、セッション開始時のこのパスの英数字以外を1文字ずつ - に置換したもの(報告書 §1)。日付が帰属しないためリソース。集合にはフォルダを決めたパスだけでなく、行の cwd として現れる全てのパス(サブディレクトリや node_modules 配下を含む)が入る。",
    position: { x: 1150, y: 0 },
    identifiers: ["cwd"],
    attributes: ["folderName"],
  },
  {
    name: { physical: "Session", logical: "セッション" },
    type: "RESOURCE",
    description:
      "1つの会話。セッションIDは会話開始時に発番される UUID v4 で、直下の .jsonl のファイル名にもなる。ただしセッションIDはファイルを識別しない: サブエージェントの会話は <セッションID>/subagents/agent-<ID>.jsonl に分離され、親と同じ sessionId を引き継ぐ(報告書 §7。実測でも87件すべてが親と同一)。ファイルをモノとして立てるのは第3弾(サブエージェント)の課題として残している。ログにセッション開始日時という語彙は無く(あるのは行ごとの timestamp)、日付が帰属しないためリソース。会話タイトル・モード等は custom-title / ai-title / mode 行として追記されるが、これらは個体指定子を持たないためモノにはならず、セッションの属性になる。",
    position: { x: 1150, y: 710 },
    identifiers: ["sessionId"],
    attributes: ["customTitle", "aiTitle", "mode", "slug", "lastPrompt"],
  },
  {
    name: { physical: "SessionFile", logical: "セッションファイル(jsonl)" },
    type: "RESOURCE",
    description:
      "セッションログの .jsonl ファイル1件。個体指定子はファイルパス。会話ファイルは <フォルダ名>/<セッションID>.jsonl、サブエージェントのファイルは <フォルダ名>/<セッションID>/subagents/agent-<エージェントID>.jsonl(報告書 §1、§7)。日付が帰属しないためリソース。ファイル種別によるサブセットへの展開と、エージェントID・meta.json の語彙は第3弾で扱う。",
    position: { x: 1150, y: 360 },
    identifiers: ["filePath"],
    attributes: ["fileKind"],
  },
  {
    name: { physical: "ProjectFolderFile", logical: "作業ディレクトリ．セッションファイル" },
    type: "COMPARATIVE",
    description:
      "どのファイルがどの作業ディレクトリのフォルダに置かれているか。作業ディレクトリとファイルはどちらもリソースであり、TM では R-R の関係は多重度によらず対照表で構成する。ファイルパスにはフォルダ名が含まれるが、エンコードが不可逆でそこから作業ディレクトリパスを復元できないため、この関係は導出では代替できない。ログ側に対応する語彙は無く、対になる事実だけを持つ mapping-list になる。",
    position: { x: 1150, y: 160 },
    identifiers: ["cwd(R)", "filePath(R)"],
    attributes: [],
  },
  {
    name: { physical: "SessionFileMap", logical: "セッション．セッションファイル" },
    type: "COMPARATIVE",
    description:
      "どのファイルがどの会話に属するか。セッションとファイルはどちらもリソースであり R-R のため対照表で構成する。1セッションに対しファイルは会話ファイル1件とサブエージェントのファイル0件以上。サブエージェントのファイルは親と同じ sessionId を引き継ぐため(実測で87件すべて)、セッションIDはファイルを識別しない。",
    position: { x: 1150, y: 520 },
    identifiers: ["sessionId(R)", "filePath(R)"],
    attributes: [],
  },

  // ============ イベント ============
  {
    name: { physical: "ChainLine", logical: "ログ行" },
    type: "EVENT",
    description:
      "uuid / parentUuid で親子チェーンを構成する行(user / assistant / system / attachment)。記録日時という過去の出来事の日付が帰属するためイベント。cwd を作業ディレクトリへの (R) として左側に置いているのは、これが行単位のメタデータで、ファイルの置き場所と一致しないことが実際にあるため(報告書 §2.3)。このPCの ~/.claude/projects/ 直下の .jsonl 54件を実測したところ、27件(50%)が1ファイル内に複数の cwd を持ち、同じ27件がフォルダ名にエンコードされないパスを含んでいた。最多の1件は14種類で、別プロジェクトのディレクトリまで含む。したがってセッション経由(対照表)の関係だけでは行の記録場所を表現できず、この関係は対照表と重複しない。",
    position: { x: 1770, y: 200 },
    identifiers: ["uuid", "filePath(R)", "sessionId(R)", "cwd(R)"],
    attributes: [
      "timestamp",
      "type",
      "entrypoint",
      "version",
      "gitBranch",
      "isSidechain",
      "userType",
    ],
  },
  {
    name: { physical: "UserLine", logical: "ユーザー行" },
    type: "EVENT-SUBSET",
    description:
      "行種別による相違のサブセット(×行種別)。type = user。人間の入力(content が文字列)とツール実行結果(content が配列)の両方を含み、実測では約9割がツール実行結果(報告書 §4.1)。ツール実行結果の行は sourceToolAssistantUUID で tool_use を発行した AI応答行を指す(E-E の先行・後続)。",
    position: { x: 1770, y: 760 },
    identifiers: ["uuid", "sourceToolAssistantUUID"],
    attributes: ["type", "promptId", "permissionMode"],
  },
  {
    name: { physical: "AssistantLine", logical: "AI応答行" },
    type: "EVENT-SUBSET",
    description:
      "行種別による相違のサブセット(×行種別)。type = assistant。1回のAPI応答が複数ブロックを含む場合はブロックごとに別行となり、同じ messageId を共有する(報告書 §4.2)。messageId は「1回のAPI応答」の個体指定子とみなせるため、第2弾でモノとして切り出す候補。",
    position: { x: 2150, y: 760 },
    identifiers: ["uuid"],
    attributes: ["type", "requestId", "messageId", "model", "stopReason"],
  },
  {
    name: { physical: "SystemLine", logical: "システム行" },
    type: "EVENT-SUBSET",
    description:
      "行種別による相違のサブセット(×行種別)。type = system。subtype で stop_hook_summary / api_error / compact_boundary / informational の4種にさらに切れる(報告書 §4.9)。第4弾で扱う。",
    position: { x: 2450, y: 760 },
    identifiers: ["uuid"],
    attributes: ["type", "subtype", "level"],
  },
  {
    name: { physical: "AttachmentLine", logical: "付帯情報行" },
    type: "EVENT-SUBSET",
    description:
      "行種別による相違のサブセット(×行種別)。type = attachment。実行環境が会話に注入した情報で、attachment.type で23種にさらに切れる(報告書 §4.10)。第4弾で扱う。",
    position: { x: 2750, y: 760 },
    identifiers: ["uuid"],
    attributes: ["type", "attachmentType"],
  },
  {
    name: { physical: "SessionInputQueue", logical: "セッション．入力キュー" },
    type: "MANY-VALUED-OR",
    description:
      "queue-operation 行。ユーザーが入力を送信した瞬間の記録で、user 行より先に書かれる(報告書 §4.3)。1セッションに複数あるためセッションの多値(MO)。個体指定子は セッションID(R) だけで、行ごとに一意ではない。投入日時が並べるための語彙にあたる。",
    position: { x: 1150, y: 980 },
    identifiers: ["sessionId(R)"],
    attributes: ["enqueuedAt", "content"],
  },

  // ============ 再帰 ============
  {
    name: { physical: "ChainLineRecursion", logical: "ログ行．ログ行" },
    type: "RECURSION",
    description:
      "ログ行どうしの親子関係。物理チェーン(parentUuid)と論理チェーン(logicalParentUuid)の2種があり、後者は compact_boundary で parentUuid が null に戻った際に圧縮前の末尾を指す(報告書 §4.9)。チェーン種別で区別する。",
    position: { x: 2260, y: 200 },
    identifiers: ["parentUuid", "childUuid"],
    attributes: ["linkKind"],
  },
];

let identifierInstanceSeq = IDENTIFIER_INSTANCE_BASE_ID;
let attributeInstanceSeq = ATTRIBUTE_INSTANCE_BASE_ID;

const ENTITIES: TmEntity[] = ENTITY_DEFS.map((def, i) => ({
  id: ENTITY_BASE_ID + i,
  type: def.type,
  name: def.name.logical,
  description: def.description,
  position: { x: def.position.x, y: def.position.y, z: 0 },
  // d3.ter が内容から実寸を算出するため 0 を渡す。
  size: { w: 0, h: 0 },
  identifiers: def.identifiers.map((ref) => {
    const { physical, relation } = parseRef(ref);
    const master = findName(IDENTIFIER_DEFS, physical, "identifier");
    return {
      id: identifierInstanceSeq++,
      identifier: poolId(IDENTIFIER_DEFS, IDENTIFIER_BASE_ID, physical),
      ...(relation
        ? {
            name: {
              physical: master.physical,
              logical: `${master.logical}${RELATION_SUFFIX}`,
            },
          }
        : {}),
    };
  }),
  attributes: def.attributes.map((ref) => {
    const { physical } = parseRef(ref);
    findName(ATTRIBUTE_DEFS, physical, "attribute");
    return {
      id: attributeInstanceSeq++,
      attribute: poolId(ATTRIBUTE_DEFS, ATTRIBUTE_BASE_ID, physical),
    };
  }),
}));

function entityId(physical: string): number {
  const i = ENTITY_DEFS.findIndex((d) => d.name.physical === physical);
  if (i < 0) throw new Error(`unknown entity: ${physical}`);
  return ENTITY_BASE_ID + i;
}

/* ------------------------------------------------------------------ *
 *  リレーションシップ
 * ------------------------------------------------------------------ */

type RelationshipPortDef = {
  entity: string;
  position: number;
  cardinality: 1 | 3;
  optionality: 0 | 1;
};

type RelationshipDef = {
  from: RelationshipPortDef;
  to: RelationshipPortDef;
  label?: string;
  subset?: TmSubset;
};

/**
 * ログ行のサブセットを切る区分コード(相違のサブセット)。
 * d3.ter は `親エンティティ + 区分コード` で結線をグルーピングし、幹 → バス →
 * 各サブセット という1本の分岐として描く。そのため4本に同じ区分コードを与えると、
 * 線は1本の木、ラベルも `×行種別` が1つだけになる(TM のサブセット表記どおり)。
 * カーディナリティ・オプショナリティの記号はサブセット結線には描かれない。
 */
const LINE_TYPE_SUBSET: TmSubset = { kind: "different", code: "行種別" };

const RELATIONSHIP_DEFS: RelationshipDef[] = [
  // ---- 実行環境(PC / ユーザー / Gitリポジトリ)----
  // PC 1 : 対照表 1以上(マシンには少なくとも1人のユーザーがいる)。
  {
    from: { entity: "Pc", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "PcUser", position: 180, cardinality: 3, optionality: 1 },
  },
  // ユーザー 1 : 対照表 1以上(同じユーザー名が複数マシンにありうる)。
  {
    from: { entity: "User", position: 180, cardinality: 1, optionality: 1 },
    to: { entity: "PcUser", position: 0, cardinality: 3, optionality: 1 },
  },
  // PC 1 : 対照表 複数または値なし(リポジトリが1つも無いマシンもある)。
  {
    from: { entity: "Pc", position: 300, cardinality: 1, optionality: 1 },
    to: { entity: "PcGitRepository", position: 180, cardinality: 3, optionality: 0 },
  },
  // Gitリポジトリ 1 : 対照表 1以上(どこかのマシンには置かれている)。
  {
    from: { entity: "GitRepository", position: 180, cardinality: 1, optionality: 1 },
    to: { entity: "PcGitRepository", position: 0, cardinality: 3, optionality: 1 },
  },
  // ユーザー 1 : 対照表 複数または値なし(会話をまだ始めていないこともある)。
  {
    from: { entity: "User", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "UserSession", position: 180, cardinality: 3, optionality: 0 },
  },
  // セッション 1 : 対照表 必ず1件(会話は必ず誰かのもの)。
  {
    from: { entity: "Session", position: 90, cardinality: 1, optionality: 1 },
    to: { entity: "UserSession", position: 270, cardinality: 1, optionality: 1 },
  },
  // Gitリポジトリ 1 : 設定ファイルの手配 各1件または値なし(まだ作っていない
  // リポジトリもある)。E-R。
  {
    from: { entity: "GitRepository", position: 350, cardinality: 1, optionality: 1 },
    to: { entity: "RepoClaudeMd", position: 180, cardinality: 1, optionality: 0 },
  },
  {
    from: { entity: "GitRepository", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "RepoSettings", position: 150, cardinality: 1, optionality: 0 },
  },
  {
    from: { entity: "GitRepository", position: 10, cardinality: 1, optionality: 1 },
    to: { entity: "RepoSettingsLocal", position: 130, cardinality: 1, optionality: 0 },
  },
  // Gitリポジトリ 1 : Gitブランチ 複数または値なし。E-R。
  {
    from: { entity: "GitRepository", position: 340, cardinality: 1, optionality: 1 },
    to: { entity: "GitBranch", position: 180, cardinality: 3, optionality: 0 },
  },
  // Gitリポジトリ 1 : ワーキングツリー 1以上(リポジトリ本体のディレクトリが
  // 常に1つ目のワーキングツリーであるため)。E-R。
  {
    from: { entity: "GitRepository", position: 320, cardinality: 1, optionality: 1 },
    to: { entity: "GitWorktree", position: 160, cardinality: 3, optionality: 1 },
  },
  // E-E は対応表で構成する。ブランチ 1 に対し、それを開いているワーキングツリーは
  // 1つまで(同じブランチを2箇所で開けない)。
  {
    from: { entity: "GitBranch", position: 270, cardinality: 1, optionality: 0 },
    to: { entity: "GitBranchWorktree", position: 90, cardinality: 1, optionality: 0 },
  },
  // ワーキングツリー 1 が開いているブランチも1つまで(detached HEAD なら 0)。
  {
    from: { entity: "GitWorktree", position: 270, cardinality: 1, optionality: 0 },
    to: { entity: "GitBranchWorktree", position: 100, cardinality: 1, optionality: 0 },
  },
  // ユーザー 1 : CLAUDE.md(ユーザー)の手配 1件または値なし。E-R。
  {
    from: { entity: "User", position: 20, cardinality: 1, optionality: 1 },
    to: { entity: "UserClaudeMd", position: 180, cardinality: 1, optionality: 0 },
  },

  // R-R(作業ディレクトリ × ファイル)は対照表で構成する。
  // 作業ディレクトリ 1 に対し対照表の行は 1以上。
  {
    from: { entity: "ProjectFolder", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "ProjectFolderFile", position: 180, cardinality: 3, optionality: 1 },
  },
  // ファイル 1 に対し対照表の行は必ず1件(置き場所は1つ)。
  {
    from: { entity: "SessionFile", position: 180, cardinality: 1, optionality: 1 },
    to: { entity: "ProjectFolderFile", position: 0, cardinality: 1, optionality: 1 },
  },
  // R-R(セッション × ファイル)も対照表で構成する。
  // ファイル 1 は必ず1つの会話に属する。
  {
    from: { entity: "SessionFile", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "SessionFileMap", position: 180, cardinality: 1, optionality: 1 },
  },
  // セッション 1 に対しファイルは会話ファイル1件 + サブエージェント0件以上なので 1以上。
  {
    from: { entity: "Session", position: 180, cardinality: 1, optionality: 1 },
    to: { entity: "SessionFileMap", position: 0, cardinality: 3, optionality: 1 },
  },
  // 作業ディレクトリ 1 : ログ行 複数(1以上)。E-R。
  // ファイル経由の関係とは別に張る。行の cwd はファイルの置き場所と一致しないことが
  // 実測で確認されており(54件中27件)、別個の事実だからである。
  {
    from: { entity: "ProjectFolder", position: 270, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLine", position: 110, cardinality: 3, optionality: 1 },
    label: "記録時の cwd",
  },
  // ファイル 1 : ログ行 複数(1以上)。E-R。
  // どのファイルに書かれた行かは、親の会話とサブエージェントの会話を区別する唯一の
  // 手がかりである(sessionId はサブエージェントでも親と同じ値になるため)。
  {
    from: { entity: "SessionFile", position: 270, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLine", position: 90, cardinality: 3, optionality: 1 },
    label: "書かれた先",
  },
  // セッション 1 : ログ行 複数(1以上)。E-R。
  // ファイル経由でも辿れるが、sessionId は全行に明示的に記録される語彙のため残す。
  {
    from: { entity: "Session", position: 270, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLine", position: 70, cardinality: 3, optionality: 1 },
    label: "所属",
  },
  // セッション 1 : 入力キュー 複数または値なし。
  // queue-operation は 49/146ファイルにしかないため任意。
  {
    from: { entity: "Session", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "SessionInputQueue", position: 180, cardinality: 3, optionality: 0 },
  },

  // ログ行のサブセット。属性構成が異なるので相違のサブセット(×行種別)。
  // 1対「1または値なし」。ログ行の下辺から角度をずらして出す。0=下 を基準に、
  // 30 → 330 の順で下辺の左から右へ接続点が移動する。
  {
    from: { entity: "ChainLine", position: 30, cardinality: 1, optionality: 1 },
    to: { entity: "UserLine", position: 180, cardinality: 1, optionality: 0 },
    subset: LINE_TYPE_SUBSET,
  },
  {
    from: { entity: "ChainLine", position: 10, cardinality: 1, optionality: 1 },
    to: { entity: "AssistantLine", position: 180, cardinality: 1, optionality: 0 },
    subset: LINE_TYPE_SUBSET,
  },
  {
    from: { entity: "ChainLine", position: 350, cardinality: 1, optionality: 1 },
    to: { entity: "SystemLine", position: 180, cardinality: 1, optionality: 0 },
    subset: LINE_TYPE_SUBSET,
  },
  {
    from: { entity: "ChainLine", position: 330, cardinality: 1, optionality: 1 },
    to: { entity: "AttachmentLine", position: 180, cardinality: 1, optionality: 0 },
    subset: LINE_TYPE_SUBSET,
  },

  // 再帰(親側): チェーン1件には親行が必ず1件。1つの行を親とするチェーンは
  // 複数または値なし(--fork-session で分岐しうる。葉の行は子を持たない)。
  {
    from: { entity: "ChainLine", position: 255, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLineRecursion", position: 105, cardinality: 3, optionality: 0 },
    label: "親",
  },
  // 再帰(子側): チェーン1件には子行が必ず1件。1つの行を子とするチェーンは
  // 1件または値なし(親は1つだけ。チェーンの起点行は親を持たない)。
  {
    from: { entity: "ChainLine", position: 285, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLineRecursion", position: 75, cardinality: 1, optionality: 0 },
    label: "子",
  },

  // E-E(先行・後続): tool_use を発行した AI応答行 → その結果を記録したユーザー行。
  // どちらの側も「1件または値なし」。
  {
    from: { entity: "AssistantLine", position: 90, cardinality: 1, optionality: 0 },
    to: { entity: "UserLine", position: 270, cardinality: 1, optionality: 0 },
    label: "ツール発行元",
  },
];

const RELATIONSHIPS: TmRelationship[] = RELATIONSHIP_DEFS.map((def, i) => ({
  id: RELATIONSHIP_BASE_ID + i,
  from: {
    entity: entityId(def.from.entity),
    position: def.from.position,
    cardinality: def.from.cardinality,
    optionality: def.from.optionality,
  },
  to: {
    entity: entityId(def.to.entity),
    position: def.to.position,
    cardinality: def.to.cardinality,
    optionality: def.to.optionality,
  },
  ...(def.label ? { label: def.label } : {}),
  ...(def.subset ? { subset: def.subset } : {}),
}));

/**
 * エンティティ ID → 物理名。レイアウトの手調整を保存するときのキーに使う。
 * 図から読み取れるのは `_id`(配列順で採番)だけだが、順序を入れ替えると値が
 * ずれるため、保存キーには並べ替えに強い物理名を使う(Classes と同じ流儀)。
 */
export const TM_ENTITY_KEY_BY_ID: Record<number, string> = Object.fromEntries(
  ENTITY_DEFS.map((def, i) => [ENTITY_BASE_ID + i, def.name.physical]),
);

/**
 * リレーションシップ ID → 安定キー。ポート角度の手調整を保存するキーに使う。
 *
 * エンティティと同じく `_id` は配列順の採番なので保存キーには使えない。
 * 端点の物理名の組(`Session->ChainLine`)を基本とし、同じ組が複数ある場合だけ
 * ラベルで区別する(ログ行 × 再帰表 が親・子の2本あるため)。
 * それでも重複するならモデル側で区別が付いていないということなので、例外にする。
 */
const RELATIONSHIP_KEYS: string[] = (() => {
  const pairCount = new Map<string, number>();
  for (const def of RELATIONSHIP_DEFS) {
    const pair = `${def.from.entity}->${def.to.entity}`;
    pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1);
  }

  const keys = RELATIONSHIP_DEFS.map((def) => {
    const pair = `${def.from.entity}->${def.to.entity}`;
    return (pairCount.get(pair) ?? 0) > 1 ? `${pair}#${def.label ?? ""}` : pair;
  });

  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(`duplicate relationship key: ${key}`);
    }
    seen.add(key);
  }
  return keys;
})();

export const TM_RELATIONSHIP_KEY_BY_ID: Record<number, string> =
  Object.fromEntries(
    RELATIONSHIP_KEYS.map((key, i) => [RELATIONSHIP_BASE_ID + i, key]),
  );

export const TM_DATA: TmData = {
  identifiers: IDENTIFIERS,
  attributes: ATTRIBUTES,
  entities: ENTITIES,
  relationships: RELATIONSHIPS,
};
