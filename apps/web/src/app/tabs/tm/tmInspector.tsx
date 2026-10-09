import type {
  ColonoscopeField,
  ColonoscopeTab,
  ColonoscopeValues,
} from "@yanqirenshi/colonoscope";
import type { TmModel } from "@/lib/tm";
import { portOverrideKey, type PortOverrides } from "@/data/tmLayoutStorage";

/**
 * TM のインスペクタ(Colonoscope)に渡す対象。
 *
 * エンティティを右クリックしたときに1回だけ作り、state に持つこと。Colonoscope は
 * 対象のオブジェクトが替わると入力欄を作り直すため、描画のたびに作ると入力途中の
 * 値が消える。
 */
export type TmInspectorTarget = {
  id: number;
  /** 物理名。レイアウト保存のキーでもある。見せるだけで編集はしない。 */
  key: string;
  name: string;
  type: string;
  description: string;
  position: { x: number; y: number };
  /** 角度の目安。Colonoscope の readonly 項目は対象から値を読むため、ここに置く。 */
  angleGuide: string;
  /** このエンティティに繋がる結線の、こちら側の端点。 */
  ports: TmInspectorPort[];
};

/**
 * 結線1本のこちら側の端点。相手側の角度は出さない(相手を選べばそちらから編集できる)。
 *
 * path には添字を使う(`ports.0.angle`)。保存キーは `Session->ChainLine:from` や
 * `ChainLine->ChainLineRecursion#子:to` のように記号・日本語を含むため、ドット区切りの
 * path に埋めると Colonoscope の getByPath(`path.split(".")`)が辿れなくなる。
 */
export type TmInspectorPort = {
  /** 保存キー(`<リレーションシップキー>:<from|to>`)。 */
  key: string;
  /** 項目名。`→ 相手`(こちらが起点)/ `← 相手`(こちらが終点)。 */
  label: string;
  angle: number;
};

/** d3.ter の角度は 0=下 / 90=左 / 180=上 / 270=右(中間の角度もそのまま使える)。 */
const ANGLE_GUIDE = "0=下 / 90=左 / 180=上 / 270=右";

const PORT_PATH_PREFIX = "ports.";
const PORT_PATH_SUFFIX = ".angle";

const BASIC_FIELDS: ColonoscopeField[] = [
  { path: "key", label: "物理名", type: "readonly" },
  { path: "position.x", label: "X", type: "number" },
  { path: "position.y", label: "Y", type: "number" },
];

/**
 * 指定エンティティに繋がる結線を、そのエンティティ側の端点として並べる。
 *
 * モデルは引数で受け取る。移行前は `tm.ts` を import してモジュールの読み込み時に
 * 対応表を作っていたが、定義が実行時に読む JSON になったため(#590)、組み立て済みの
 * モデルを渡してもらう形にした。
 */
function portsOf(
  model: TmModel,
  entityId: number,
  overrides: PortOverrides,
): TmInspectorPort[] {
  const nameById = new Map(
    model.data.entities.map((entity) => [entity.id, entity.name]),
  );
  const ports: TmInspectorPort[] = [];

  for (const relationship of model.data.relationships) {
    const relationshipKey = model.relationshipKeyById[relationship.id];
    if (!relationshipKey) continue;

    const ends: ("from" | "to")[] = [];
    if (relationship.from.entity === entityId) ends.push("from");
    if (relationship.to.entity === entityId) ends.push("to");

    for (const end of ends) {
      const outgoing = end === "from";
      const counterpartId = outgoing
        ? relationship.to.entity
        : relationship.from.entity;
      const key = portOverrideKey(relationshipKey, end);
      const base = outgoing
        ? relationship.from.position
        : relationship.to.position;
      const counterpart = nameById.get(counterpartId) ?? "";
      const note = relationship.label ? `(${relationship.label})` : "";

      ports.push({
        key,
        label: `${outgoing ? "→" : "←"} ${counterpart}${note}`,
        angle: overrides[key] ?? base,
      });
    }
  }

  return ports;
}

/** 組み立て済みモデルの `data.entities` の要素のうち、インスペクタが使う分だけ。 */
type EntityCore = {
  id: number;
  name: string;
  type: string;
  description: string;
};

export function buildInspectorTarget(
  model: TmModel,
  core: EntityCore,
  /** 物理名(`model.entityKeyById`)。 */
  key: string,
  /** ドラッグ後の実値を見せる(定義の初期値ではない)。 */
  position: { x: number; y: number },
  portOverrides: PortOverrides,
): TmInspectorTarget {
  return {
    id: core.id,
    key,
    name: core.name,
    type: core.type,
    description: core.description,
    position: { ...position },
    angleGuide: ANGLE_GUIDE,
    ports: portsOf(model, core.id, portOverrides),
  };
}

/**
 * 「基本」(物理名・位置・結線の角度)と「説明」の2タブ。
 *
 * 位置と角度は同じタブに置く。1回の「適用」で両方を保存できる形を保つため
 * (サイトマップは「基本」と「結線」に分けているが、TM は元からひとまとめ)。
 * 結線の無いエンティティには角度の項目を出さない。
 */
export function buildInspectorTabs(
  target: TmInspectorTarget,
): ColonoscopeTab<TmInspectorTarget>[] {
  const portFields: ColonoscopeField[] =
    target.ports.length === 0
      ? []
      : [
          {
            path: "angleGuide",
            label: `結線(${target.ports.length}) — このエンティティ側の角度`,
            type: "readonly",
          },
          ...target.ports.map(
            (port, index): ColonoscopeField => ({
              path: `${PORT_PATH_PREFIX}${index}${PORT_PATH_SUFFIX}`,
              label: port.label,
              type: "number",
            }),
          ),
        ];

  return [
    { key: "basic", label: "基本", fields: [...BASIC_FIELDS, ...portFields] },
    {
      key: "description",
      label: "説明",
      // 編集する項目が無いタブなので、Colonoscope は「適用」のフッタを出さない。
      content: (target: TmInspectorTarget) => (
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {target.description || "(説明なし)"}
        </div>
      ),
    },
  ];
}

/** 基本タブの「適用」か。Colonoscope のタブモードは表示中のタブの値だけを通知する。 */
export function hasBasicValues(values: ColonoscopeValues): boolean {
  return BASIC_FIELDS.every((field) => field.path in values);
}

function toNumber(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** 基本タブの「適用」から位置を読む。 */
export function readPosition(
  values: ColonoscopeValues,
  target: TmInspectorTarget,
): { x: number; y: number } {
  return {
    x: toNumber(values["position.x"], target.position.x),
    y: toNumber(values["position.y"], target.position.y),
  };
}

/** d3.ter は角度を `% 360` で扱う。負値も含めて 0-359 の整数に揃える。 */
function normalizeAngle(value: number) {
  return ((Math.round(value) % 360) + 360) % 360;
}

/** 「適用」で、角度が変わった端点だけを返す(保存キー → 角度)。 */
export function readChangedPorts(
  values: ColonoscopeValues,
  target: TmInspectorTarget,
): PortOverrides {
  const changed: PortOverrides = {};
  for (const [path, raw] of Object.entries(values)) {
    if (!path.startsWith(PORT_PATH_PREFIX)) continue;
    if (!path.endsWith(PORT_PATH_SUFFIX)) continue;

    const index = Number(
      path.slice(PORT_PATH_PREFIX.length, -PORT_PATH_SUFFIX.length),
    );
    const port = target.ports[index];
    if (!port) continue;

    if (raw.trim() === "") continue;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) continue;

    const next = normalizeAngle(parsed);
    if (next !== port.angle) changed[port.key] = next;
  }
  return changed;
}
