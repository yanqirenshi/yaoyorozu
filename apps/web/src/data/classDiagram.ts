/**
 * Classes 図(`/class-diagram`)のデータを書くための共通の道具。
 *
 * 図ごとのデータファイル(`classes-*.ts`)はこれでクラスと関係線を定義し、
 * `classes.ts` で1枚の図に重ねる。
 *
 * クラスの id は物理名から機械的に付ける(d3.classes 0.6.0 以降は明示 id を受け付ける)。
 * 関係線の classId、DOM の data-id、レイアウト保存のキーがすべて物理名で揃うため、
 * 配列の並べ替えで参照がずれることがない。
 */
import type {
  AttributeInput,
  ClassInput,
  ConnectionPoint,
  DiagramInput,
  RelationshipInput,
} from "@yanqirenshi/d3.classes";

/** クラス定義。id は物理名から付けるので書かない。 */
export type ClassDef = Omit<ClassInput, "id">;

/**
 * 端点の取り付け位置。辺のキーワード(`"top"` など。その辺の中央)か、取り付け角度
 * (度。ボックス中心から 0=真下・時計回りに 90=左、180=真上、270=右)。
 */
export type Point = ConnectionPoint;

/**
 * 多重度(起点側・終点側それぞれの端に表示される。例: `"1..*"`)と、同じ組に複数の
 * 関係線を張るときの識別子 `key`。
 */
export type RelationshipOptions = Pick<
  RelationshipInput,
  "fromMultiplicity" | "toMultiplicity"
> & { key?: string };

// フィールド。名前と型を分けて渡す。名前に `+ ` を書くと、ライブラリが補う
// 可視性記号と二重になる。
export const attr = (physical: string, type: string): AttributeInput => ({
  name: { physical, logical: physical, description: "" },
  type,
  visibility: "public",
});

// 列挙のバリアント(serde の tag 値など)。可視性も型も持たないため名前だけを描く。
export const label = (physical: string): AttributeInput => ({
  name: { physical, logical: physical, description: "" },
  kind: "label",
});

/**
 * クラス定義に id を付け、それを参照する関係線の作り方を返す。
 * 関係線の id は `<起点>-><終点>`。接続辺の手調整(layout/classes.json)のキーに使う。
 * 同じ組に2本以上張るときは `options.key` を渡し、`<起点>-><終点>#<key>` にする。
 * 渡し忘れると id が重複し、d3.classes が例外を出す(黙って上書きしない)。
 */
export function defineDiagram(defs: ClassDef[]) {
  const classes: ClassInput[] = defs.map((c) => ({ ...c, id: c.name.physical }));

  // 綴り違いはここで落とす。
  const ref = (physical: string): string => {
    if (!defs.some((c) => c.name.physical === physical)) {
      throw new Error(`unknown class: ${physical}`);
    }
    return physical;
  };

  const rel = (
    type: RelationshipInput["type"],
    from: string,
    to: string,
    label?: string,
    fromPoint: Point = "bottom",
    toPoint: Point = "top",
    { key, ...multiplicity }: RelationshipOptions = {},
  ): RelationshipInput => ({
    id: key ? `${from}->${to}#${key}` : `${from}->${to}`,
    type,
    from: { classId: ref(from), point: fromPoint },
    to: { classId: ref(to), point: toPoint },
    ...(label ? { label } : {}),
    ...multiplicity,
  });

  return { classes, rel };
}

/**
 * 複数の図を1枚に重ねる。クラスの id(物理名)が重なると d3.classes が例外を出すが、
 * どの図どうしがぶつかったか分かるよう、ここで先に名前を出して落とす。
 */
export function mergeDiagrams(...diagrams: DiagramInput[]): DiagramInput {
  const classes = diagrams.flatMap((d) => d.classes);
  const seen = new Set<string>();
  for (const c of classes) {
    const id = c.id ?? c.name.physical;
    if (seen.has(id)) throw new Error(`duplicate class: ${id}`);
    seen.add(id);
  }
  return { classes, relationships: diagrams.flatMap((d) => d.relationships) };
}
