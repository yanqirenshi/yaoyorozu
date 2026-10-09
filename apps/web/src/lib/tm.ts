import type { TerData, TerEntityType } from "@yanqirenshi/d3.ter";

/**
 * `{リポジトリ}/yyz/spec/tm.json` の形と、そこから d3.ter に渡すデータを組み立てる処理
 * (#543 の最終段。#590)。
 *
 * もとは `apps/web/src/data/tm.ts` が定義と組み立てを兼ねていた。移行で次のように分けた。
 *
 * - `yyz/spec/tm.json` … 資料に書いてあること(語彙・箱・線)だけを物理名で持つ
 * - `yyz/spec/tm.md`  … なぜそう決めたかの記録(横断する判断)
 * - このファイル      … JSON から d3.ter 用のデータを組み立て、検証する
 *
 * **JSON に ID を持たせない。** 数値 ID(エンティティ・結線・語彙インスタンス)と、
 * レイアウト保存に使う安定キーは、すべてここで配列順から機械的に決める。JSON に
 * 書くと手で採番することになり、並べ替えでずれる(移行前も同じ理由で機械採番だった)。
 *
 * **検証は例外を投げずに結果で返す。** 移行前はビルド時に `throw` していたが、JSON を
 * 実行時に読む形になったため、投げるとページが白くなる。`buildTmModel` が
 * `{ ok: false, message }` を返し、呼び出し側がエラーとして表示する。
 */

/* ------------------------------------------------------------------ *
 *  yyz/spec/tm.json の形
 * ------------------------------------------------------------------ */

/** 語彙(個体指定子・属性)の1件。`description` はその語彙についての覚え書き。 */
export type TmVocabularySpec = {
  physical: string;
  logical: string;
  description?: string;
};

/**
 * サブセットを切る区分コード。結線からは `subset: "<code>"` と名前で参照する。
 * 同じ code を与えた結線は d3.ter が1本の木にまとめて描く。
 */
export type TmSubsetCodeSpec = {
  code: string;
  kind: "same" | "different";
  description: string;
};

export type TmEntitySpec = {
  physical: string;
  logical: string;
  type: TmEntityType;
  description: string;
  position: { x: number; y: number };
  /** 左側。自分の個体指定子と、他のモノから継承したもの(`(R)` を付ける)。 */
  identifiers: string[];
  /** 右側。個体指定子以外の語彙。 */
  attributes: string[];
};

export type TmPortSpec = {
  /** 相手のエンティティの物理名。 */
  entity: string;
  position: number;
  cardinality: 1 | 3;
  optionality: 0 | 1;
};

export type TmRelationshipSpec = {
  from: TmPortSpec;
  to: TmPortSpec;
  label?: string;
  /** 区分コードの名前(`subsetCodes` の `code`)。 */
  subset?: string;
  /** 中点からぶら下げる対照表・対応表の物理名。 */
  mapping?: string;
  description?: string;
};

export type TmSpec = {
  identifiers: TmVocabularySpec[];
  attributes: TmVocabularySpec[];
  subsetCodes: TmSubsetCodeSpec[];
  entities: TmEntitySpec[];
  relationships: TmRelationshipSpec[];
};

/* ------------------------------------------------------------------ *
 *  d3.ter に渡すデータの型
 *
 *  0.1.22 から型定義が同梱されたため、原則そちら(Ter*)に合わせる。
 *  `TmDataCheck` で TerData への代入可能性をコンパイル時に検証している。
 *
 *  0.1.22 では同梱の型と実装が3点食い違っており実装側に合わせていたが、
 *  0.1.24 でいずれも解消した。
 *   1. エンティティの `name` が `string | TerName` になった。ただし本ファイルは
 *      論理名の文字列を渡し、物理名は JSON 側に保持する方式を続ける。
 *   2. 識別子・属性インスタンスの `name`(マスタ名の上書き)が宣言された。
 *      TM の `(R)` 表記をマスタを重複させずに実現するために使っている。
 *   3. `optionality` の説明が実装どおり(0=任意 / 1=必須)に修正された。
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
  /** 図に出す名前。同梱の型が `string` 宣言のため論理名だけを渡す(物理名は JSON 側に残す)。 */
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
  /**
   * 対照表・対応表の垂下(0.1.24 で追加)。この結線の中点に○を置き、そこから
   * 指定した表へ線でぶら下げる(PDF §2「対応表(onto-mapping)」の書き方)。
   * 指定できるのは COMPARATIVE / CORRESPONDENCE のみ。
   */
  mapping?: { entity: number };
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
 *  組み立て
 * ------------------------------------------------------------------ */

const IDENTIFIER_BASE_ID = 1;
const ATTRIBUTE_BASE_ID = 101;
const ENTITY_BASE_ID = 201;
const RELATIONSHIP_BASE_ID = 501;
// 個体指定子インスタンス / 属性インスタンスの ID。エンティティをまたいで一意にする。
const IDENTIFIER_INSTANCE_BASE_ID = 1001;
const ATTRIBUTE_INSTANCE_BASE_ID = 2001;

/**
 * 語彙の参照。`"sessionId(R)"` のように末尾に `(R)` を書くと、プールのマスタを
 * 参照したまま表示名だけ `セッションID(R)` に差し替える。
 * TM の「継承した個体指定子には (R) を付ける」表記を、マスタを重複させずに実現する。
 */
const RELATION_SUFFIX = "(R)";

function parseRef(ref: string): { physical: string; relation: boolean } {
  return ref.endsWith(RELATION_SUFFIX)
    ? { physical: ref.slice(0, -RELATION_SUFFIX.length), relation: true }
    : { physical: ref, relation: false };
}

export type TmModel = {
  data: TmData;
  /**
   * エンティティ ID → 物理名。レイアウトの手調整を保存するときのキーに使う。
   * 図から読み取れるのは `_id`(配列順で採番)だけだが、順序を入れ替えると値が
   * ずれるため、保存キーには並べ替えに強い物理名を使う(Classes と同じ流儀)。
   */
  entityKeyById: Record<number, string>;
  /**
   * リレーションシップ ID → 安定キー。ポート角度の手調整を保存するキーに使う。
   *
   * エンティティと同じく `_id` は配列順の採番なので保存キーには使えない。
   * 端点の物理名の組(`Session->ChainLine`)を基本とし、同じ組が複数ある場合だけ
   * ラベルで区別する(ログ行 × 再帰表 が親・子の2本あるため)。
   * それでも重複するならモデル側で区別が付いていないということなので、エラーにする。
   */
  relationshipKeyById: Record<number, string>;
};

export type TmModelResult =
  | { ok: true; model: TmModel }
  | { ok: false; message: string };

/**
 * `tm.json` から d3.ter に渡すデータと、レイアウト保存に使う安定キーを組み立てる。
 *
 * 検証するのは次の4つ。いずれも見つけたらその場で `{ ok: false }` を返す。
 *  1. エンティティが参照する語彙がプールに無い
 *  2. 結線・垂下が参照するエンティティが無い
 *  3. 結線が参照する区分コードが `subsetCodes` に無い
 *  4. 結線の安定キーが重複する(端点の組もラベルも同じ結線が2本ある)
 */
export function buildTmModel(spec: TmSpec): TmModelResult {
  const identifierIndex = new Map(spec.identifiers.map((n, i) => [n.physical, i]));
  const attributeIndex = new Map(spec.attributes.map((n, i) => [n.physical, i]));
  const entityIndex = new Map(spec.entities.map((e, i) => [e.physical, i]));
  const subsetByCode = new Map(spec.subsetCodes.map((s) => [s.code, s]));

  const identifiers: TmIdentifier[] = spec.identifiers.map((n, i) => ({
    id: IDENTIFIER_BASE_ID + i,
    name: { physical: n.physical, logical: n.logical },
  }));
  const attributes: TmAttribute[] = spec.attributes.map((n, i) => ({
    id: ATTRIBUTE_BASE_ID + i,
    name: { physical: n.physical, logical: n.logical },
  }));

  let identifierInstanceSeq = IDENTIFIER_INSTANCE_BASE_ID;
  let attributeInstanceSeq = ATTRIBUTE_INSTANCE_BASE_ID;

  const entities: TmEntity[] = [];
  for (const [i, def] of spec.entities.entries()) {
    const entityIdentifiers: TmEntity["identifiers"] = [];
    for (const ref of def.identifiers) {
      const { physical, relation } = parseRef(ref);
      const index = identifierIndex.get(physical);
      if (index === undefined) {
        return {
          ok: false,
          message: `${def.physical} が参照する個体指定子 ${physical} が identifiers にありません`,
        };
      }
      const master = spec.identifiers[index];
      entityIdentifiers.push({
        id: identifierInstanceSeq++,
        identifier: IDENTIFIER_BASE_ID + index,
        ...(relation
          ? {
              name: {
                physical: master.physical,
                logical: `${master.logical}${RELATION_SUFFIX}`,
              },
            }
          : {}),
      });
    }

    const entityAttributes: TmEntity["attributes"] = [];
    for (const ref of def.attributes) {
      const { physical } = parseRef(ref);
      const index = attributeIndex.get(physical);
      if (index === undefined) {
        return {
          ok: false,
          message: `${def.physical} が参照する属性 ${physical} が attributes にありません`,
        };
      }
      entityAttributes.push({
        id: attributeInstanceSeq++,
        attribute: ATTRIBUTE_BASE_ID + index,
      });
    }

    entities.push({
      id: ENTITY_BASE_ID + i,
      type: def.type,
      name: def.logical,
      description: def.description,
      position: { x: def.position.x, y: def.position.y, z: 0 },
      // d3.ter が内容から実寸を算出するため 0 を渡す。
      size: { w: 0, h: 0 },
      identifiers: entityIdentifiers,
      attributes: entityAttributes,
    });
  }

  const idOf = (physical: string): number | null => {
    const i = entityIndex.get(physical);
    return i === undefined ? null : ENTITY_BASE_ID + i;
  };

  const relationships: TmRelationship[] = [];
  for (const [i, def] of spec.relationships.entries()) {
    const fromId = idOf(def.from.entity);
    const toId = idOf(def.to.entity);
    if (fromId === null) {
      return { ok: false, message: `結線が参照するエンティティ ${def.from.entity} がありません` };
    }
    if (toId === null) {
      return { ok: false, message: `結線が参照するエンティティ ${def.to.entity} がありません` };
    }

    let subset: TmSubset | undefined;
    if (def.subset !== undefined) {
      const found = subsetByCode.get(def.subset);
      if (!found) {
        return {
          ok: false,
          message: `結線が参照する区分コード ${def.subset} が subsetCodes にありません`,
        };
      }
      subset = { kind: found.kind, code: found.code };
    }

    let mapping: { entity: number } | undefined;
    if (def.mapping !== undefined) {
      const mappingId = idOf(def.mapping);
      if (mappingId === null) {
        return { ok: false, message: `垂下が参照するエンティティ ${def.mapping} がありません` };
      }
      mapping = { entity: mappingId };
    }

    relationships.push({
      id: RELATIONSHIP_BASE_ID + i,
      from: {
        entity: fromId,
        position: def.from.position,
        cardinality: def.from.cardinality,
        optionality: def.from.optionality,
      },
      to: {
        entity: toId,
        position: def.to.position,
        cardinality: def.to.cardinality,
        optionality: def.to.optionality,
      },
      ...(def.label ? { label: def.label } : {}),
      ...(subset ? { subset } : {}),
      ...(mapping ? { mapping } : {}),
    });
  }

  // 結線の安定キー。端点の組を基本とし、同じ組が複数あるときだけラベルで区別する。
  const pairCount = new Map<string, number>();
  for (const def of spec.relationships) {
    const pair = `${def.from.entity}->${def.to.entity}`;
    pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1);
  }
  const relationshipKeyById: Record<number, string> = {};
  const seen = new Set<string>();
  for (const [i, def] of spec.relationships.entries()) {
    const pair = `${def.from.entity}->${def.to.entity}`;
    const key = (pairCount.get(pair) ?? 0) > 1 ? `${pair}#${def.label ?? ""}` : pair;
    if (seen.has(key)) {
      return {
        ok: false,
        message: `結線の保存キーが重複しています: ${key}(ラベルで区別してください)`,
      };
    }
    seen.add(key);
    relationshipKeyById[RELATIONSHIP_BASE_ID + i] = key;
  }

  const entityKeyById: Record<number, string> = Object.fromEntries(
    spec.entities.map((e, i) => [ENTITY_BASE_ID + i, e.physical]),
  );

  return {
    ok: true,
    model: {
      data: { identifiers, attributes, entities, relationships },
      entityKeyById,
      relationshipKeyById,
    },
  };
}
