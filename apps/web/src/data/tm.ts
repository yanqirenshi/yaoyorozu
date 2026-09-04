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
 * 【第1弾のスコープ】セッションと行の骨格まで。
 * メッセージ本体(コンテンツブロック・ツール・トークン使用量)、サブエージェント、
 * `system` 4種 / `attachment` 23種の詳細、`pr-link` と GitHub の関係は次段以降で追加する。
 *
 * 【オブジェクトモデル(/class-diagram)との違い】
 * Classes は `.jsonl` の「型の構造」(serde でどうデシリアライズするか)を描く。
 * 本ファイルは「何を個体指定子として、何と何が関係するか」を描く。
 * そのため両者でモノの切り方が変わる。例えば `custom-title` / `mode` などのメタ行は
 * Classes では SessionLine の独立したバリアントだが、TM では個体指定子を持たないため
 * モノにならず、セッションという1つのモノの属性に落ちる。
 */

/* ------------------------------------------------------------------ *
 *  d3.ter に渡すデータの型
 * ------------------------------------------------------------------ */

/** 物理名(JSON のフィールド名)と論理名(日本語)。図には論理名が表示される。 */
export type TmName = { physical: string; logical: string };

/**
 * エンティティの種別。d3.ter の Entity が解釈できる値のみ(未知の値は例外で落ちる)。
 * `COMPARATIVE` が対照表(TS)、`CORRESPONDENCE` が対応表(TO)にあたる。
 * TM の多値(MO / MA)に対応する種別は d3.ter に無い(§ SessionInputQueue のコメント)。
 */
export type TmEntityType =
  | "RESOURCE"
  | "RESOURCE-SUBSET"
  | "EVENT"
  | "EVENT-SUBSET"
  | "COMPARATIVE"
  | "CORRESPONDENCE"
  | "RECURSION";

export type TmIdentifier = { id: number; name: TmName };
export type TmAttribute = { id: number; name: TmName };

export type TmEntity = {
  id: number;
  type: TmEntityType;
  name: TmName;
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
 * - `optionality`: 1=必須(横棒) / 0=任意(丸)。
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

export type TmRelationship = { id: number; from: TmPort; to: TmPort };

export type TmData = {
  identifiers: TmIdentifier[];
  attributes: TmAttribute[];
  entities: TmEntity[];
  relationships: TmRelationship[];
};

/* ------------------------------------------------------------------ *
 *  個体指定子と属性のプール
 *
 *  d3.ter は個体指定子・属性をトップレベルのプールに置き、エンティティ側は数値 ID で
 *  参照する(同じ語彙が複数のエンティティに現れることを表現できる)。
 *  ID を手で採番すると壊れやすいので、物理名をキーにした定義から機械的に採番する。
 * ------------------------------------------------------------------ */

const IDENTIFIER_DEFS: TmName[] = [
  { physical: "cwd", logical: "作業ディレクトリパス" },
  { physical: "sessionId", logical: "セッションID" },
  { physical: "uuid", logical: "行UUID" },
  // 再帰表が継承する行UUID。TM の部品表の例と同じく、親子の役割を名前で区別する
  // (T字形の中だけでは親子の別が読めないため)。
  { physical: "parentUuid", logical: "親-行UUID(R)" },
  { physical: "childUuid", logical: "子-行UUID(R)" },
  // ツール実行結果の行が、その tool_use を発行した AI応答行を指す(E-E の先行・後続)。
  { physical: "sourceToolAssistantUUID", logical: "ツール発行元-行UUID(R)" },
];

const ATTRIBUTE_DEFS: TmName[] = [
  // フォルダ名は作業ディレクトリパスから機械的に導出される(英数字以外を1文字ずつ `-`
  // に置換)。置換は不可逆でフォルダ名からパスは復元できないため、個体指定子はパスの側。
  { physical: "folderName", logical: "フォルダ名(D)" },
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
  // ============ リソース ============
  {
    name: { physical: "ProjectFolder", logical: "作業ディレクトリ" },
    type: "RESOURCE",
    description:
      "Claude Code を起動した作業ディレクトリ。~/.claude/projects/<フォルダ名>/ のフォルダ名は、この絶対パスの英数字以外を1文字ずつ - に置換したもの(報告書 §1)。日付が帰属しないためリソース。",
    position: { x: 0, y: 0 },
    identifiers: ["cwd"],
    attributes: ["folderName"],
  },
  {
    name: { physical: "Session", logical: "セッション" },
    type: "RESOURCE",
    description:
      "1会話 = 1つの .jsonl ファイル。セッションIDは会話開始時に発番される UUID v4 でファイル名にもなる。ログにセッション開始日時という語彙は無く(あるのは行ごとの timestamp)、日付が帰属しないためリソース。会話タイトル・モード等は custom-title / ai-title / mode 行として追記されるが、これらは個体指定子を持たないためモノにはならず、セッションの属性になる。",
    position: { x: 0, y: 220 },
    identifiers: ["sessionId", "cwd(R)"],
    attributes: ["customTitle", "aiTitle", "mode", "slug", "lastPrompt"],
  },

  // ============ イベント ============
  {
    name: { physical: "ChainLine", logical: "ログ行" },
    type: "EVENT",
    description:
      "uuid / parentUuid で親子チェーンを構成する行(user / assistant / system / attachment)。記録日時という過去の出来事の日付が帰属するためイベント。cwd を作業ディレクトリへの (R) として左側に置いているのは、これが行単位のメタデータで、ファイルの置き場所(セッションが属するフォルダ)と一致しないことがあるため(報告書 §2.3)。",
    position: { x: 500, y: 120 },
    identifiers: ["uuid", "sessionId(R)", "cwd(R)"],
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
    position: { x: 380, y: 640 },
    identifiers: ["uuid", "sourceToolAssistantUUID"],
    attributes: ["type", "promptId", "permissionMode"],
  },
  {
    name: { physical: "AssistantLine", logical: "AI応答行" },
    type: "EVENT-SUBSET",
    description:
      "行種別による相違のサブセット(×行種別)。type = assistant。1回のAPI応答が複数ブロックを含む場合はブロックごとに別行となり、同じ messageId を共有する(報告書 §4.2)。messageId は「1回のAPI応答」の個体指定子とみなせるため、第2弾でモノとして切り出す候補。",
    position: { x: 760, y: 640 },
    identifiers: ["uuid"],
    attributes: ["type", "requestId", "messageId", "model", "stopReason"],
  },
  {
    name: { physical: "SystemLine", logical: "システム行" },
    type: "EVENT-SUBSET",
    description:
      "行種別による相違のサブセット(×行種別)。type = system。subtype で stop_hook_summary / api_error / compact_boundary / informational の4種にさらに切れる(報告書 §4.9)。第4弾で扱う。",
    position: { x: 1060, y: 640 },
    identifiers: ["uuid"],
    attributes: ["type", "subtype", "level"],
  },
  {
    name: { physical: "AttachmentLine", logical: "付帯情報行" },
    type: "EVENT-SUBSET",
    description:
      "行種別による相違のサブセット(×行種別)。type = attachment。実行環境が会話に注入した情報で、attachment.type で23種にさらに切れる(報告書 §4.10)。第4弾で扱う。",
    position: { x: 1360, y: 640 },
    identifiers: ["uuid"],
    attributes: ["type", "attachmentType"],
  },
  {
    name: { physical: "SessionInputQueue", logical: "セッション．入力キュー" },
    type: "EVENT",
    // web.md「規約を逸脱する場合は理由をコメントに残す」に従う。
    // TM 上これは多値のOR(MO)であり、個体指定子は セッションID(R) だけで行ごとに
    // 一意ではない。d3.ter に MO / MA の種別が無いため EVENT で代用している
    // (投入日時という過去の行為の日付が帰属するのでイベントとしても成立する)。
    description:
      "queue-operation 行。ユーザーが入力を送信した瞬間の記録で、user 行より先に書かれる(報告書 §4.3)。1セッションに複数あるためセッションの多値(MO)。d3.ter に多値の種別が無いため EVENT で代用している。",
    position: { x: 0, y: 540 },
    identifiers: ["sessionId(R)"],
    attributes: ["enqueuedAt", "content"],
  },

  // ============ 再帰 ============
  {
    name: { physical: "ChainLineRecursion", logical: "ログ行．ログ行．再帰表" },
    type: "RECURSION",
    description:
      "ログ行どうしの親子関係。物理チェーン(parentUuid)と論理チェーン(logicalParentUuid)の2種があり、後者は compact_boundary で parentUuid が null に戻った際に圧縮前の末尾を指す(報告書 §4.9)。チェーン種別で区別する。",
    position: { x: 990, y: 120 },
    identifiers: ["parentUuid", "childUuid"],
    attributes: ["linkKind"],
  },
];

let identifierInstanceSeq = IDENTIFIER_INSTANCE_BASE_ID;
let attributeInstanceSeq = ATTRIBUTE_INSTANCE_BASE_ID;

const ENTITIES: TmEntity[] = ENTITY_DEFS.map((def, i) => ({
  id: ENTITY_BASE_ID + i,
  type: def.type,
  name: def.name,
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

type RelationshipDef = { from: RelationshipPortDef; to: RelationshipPortDef };

const RELATIONSHIP_DEFS: RelationshipDef[] = [
  // 作業ディレクトリ 1 : セッション 複数(1以上)。
  // R-R だが「複数対複数」ではなく、ファイルがどのフォルダに置かれるかという
  // 1対複数の包含関係のため、対照表は作らずセッション側に (R) を持たせている。
  {
    from: { entity: "ProjectFolder", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "Session", position: 180, cardinality: 3, optionality: 1 },
  },
  // 作業ディレクトリ 1 : ログ行 複数(1以上)。E-R。
  // 上のセッション経由の関係とは別に張る。行の cwd はファイルの置き場所と
  // 一致しないことがあり(報告書 §2.3)、別個の事実だからである。
  {
    from: { entity: "ProjectFolder", position: 270, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLine", position: 105, cardinality: 3, optionality: 1 },
  },
  // セッション 1 : ログ行 複数(1以上)。E-R。
  {
    from: { entity: "Session", position: 270, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLine", position: 75, cardinality: 3, optionality: 1 },
  },
  // セッション 1 : 入力キュー 複数または値なし。
  // queue-operation は 49/146ファイルにしかないため任意。
  {
    from: { entity: "Session", position: 0, cardinality: 1, optionality: 1 },
    to: { entity: "SessionInputQueue", position: 180, cardinality: 3, optionality: 0 },
  },

  // ログ行のサブセット(区分コードは行種別、相違のサブセット)。1対「1または値なし」。
  // ログ行の下辺から角度をずらして出す。0=下 を基準に、30 → 330 の順で
  // 下辺の左から右へ接続点が移動する。
  {
    from: { entity: "ChainLine", position: 30, cardinality: 1, optionality: 1 },
    to: { entity: "UserLine", position: 180, cardinality: 1, optionality: 0 },
  },
  {
    from: { entity: "ChainLine", position: 10, cardinality: 1, optionality: 1 },
    to: { entity: "AssistantLine", position: 180, cardinality: 1, optionality: 0 },
  },
  {
    from: { entity: "ChainLine", position: 350, cardinality: 1, optionality: 1 },
    to: { entity: "SystemLine", position: 180, cardinality: 1, optionality: 0 },
  },
  {
    from: { entity: "ChainLine", position: 330, cardinality: 1, optionality: 1 },
    to: { entity: "AttachmentLine", position: 180, cardinality: 1, optionality: 0 },
  },

  // 再帰(親側): チェーン1件には親行が必ず1件。1つの行を親とするチェーンは
  // 複数または値なし(--fork-session で分岐しうる。葉の行は子を持たない)。
  {
    from: { entity: "ChainLine", position: 255, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLineRecursion", position: 105, cardinality: 3, optionality: 0 },
  },
  // 再帰(子側): チェーン1件には子行が必ず1件。1つの行を子とするチェーンは
  // 1件または値なし(親は1つだけ。チェーンの起点行は親を持たない)。
  {
    from: { entity: "ChainLine", position: 285, cardinality: 1, optionality: 1 },
    to: { entity: "ChainLineRecursion", position: 75, cardinality: 1, optionality: 0 },
  },

  // E-E(先行・後続): tool_use を発行した AI応答行 → その結果を記録したユーザー行。
  // どちらの側も「1件または値なし」。
  {
    from: { entity: "AssistantLine", position: 90, cardinality: 1, optionality: 0 },
    to: { entity: "UserLine", position: 270, cardinality: 1, optionality: 0 },
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
}));

export const TM_DATA: TmData = {
  identifiers: IDENTIFIERS,
  attributes: ATTRIBUTES,
  entities: ENTITIES,
  relationships: RELATIONSHIPS,
};
