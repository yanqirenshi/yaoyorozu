import type {
  ColonoscopeField,
  ColonoscopeTab,
  ColonoscopeValues,
} from "@yanqirenshi/colonoscope";
import {
  SITEMAP_DATA,
  findSitemapSite,
  parentPaddingOf,
} from "@/data/sitemap";
import {
  portOverrideKey,
  type PortOverrides,
} from "@/data/sitemapLayoutStorage";

/**
 * サイトマップのインスペクタ(Colonoscope)に渡す対象。
 *
 * ノードをクリックしたときに1回だけ作り、state に持つこと。Colonoscope は対象の
 * オブジェクトが替わると入力欄を作り直すため、描画のたびに作ると入力途中の値が消える。
 */
export type SitemapInspectorTarget = {
  id: number;
  label: { contents: string };
  /** children は親からの相対座標(SITEMAP_DATA と同じ座標系)。 */
  position: { x: number; y: number };
  size: { w: number; h: number };
  /**
   * このノードに繋がる結線の、このノード側の端点の角度(保存キー → 角度)。
   * 相手側の端点は相手のノードを選んで編集する(TM のインスペクタと同じ考え方)。
   */
  ports: Record<string, number>;
  /** 角度の目安。Colonoscope の readonly 項目は対象から値を読むため、ここに置く。 */
  angleGuide: string;
  /**
   * 画面のパス(sitemap.ts の SITE_DETAILS)。固有のパスを持たないアプリ・タブは空。
   * 角度の目安と同じく、readonly 項目に見せるため対象に持たせる。
   */
  sitePath: string;
};

type NodeCore = {
  id: number;
  label: { contents: string };
  position: { x: number; y: number };
  size: { w: number; h: number };
};

/** d3.sitemap の角度は 0=下 / 90=左 / 180=上 / 270=右(中間の角度もそのまま使える)。 */
const ANGLE_GUIDE = "0=下 / 90=左 / 180=上 / 270=右";

const PORT_PATH_PREFIX = "ports.";

const BASIC_FIELDS: ColonoscopeField[] = [
  { path: "position.x", label: "X", type: "number" },
  { path: "position.y", label: "Y", type: "number" },
  { path: "size.w", label: "幅", type: "number" },
  { path: "size.h", label: "高さ", type: "number" },
];

type SitemapNodeTree = {
  id: number;
  label: { contents: string };
  children: SitemapNodeTree[];
};

// 結線の相手を名前で見せるため、children を含む全ノードの表示名を引けるようにする。
const NODE_LABEL_BY_ID = new Map<number, string>();
(function collect(nodes: SitemapNodeTree[]) {
  for (const node of nodes) {
    NODE_LABEL_BY_ID.set(node.id, node.label.contents);
    collect(node.children);
  }
})(SITEMAP_DATA.nodes);

type PortEntry = {
  /** 保存キー(`<結線 id>:<from|to>`)。 */
  key: string;
  /** 項目名。`→ 相手`(このノードが起点)/ `← 相手`(このノードが終点)。 */
  label: string;
  /** sitemap.ts に書かれた角度。 */
  base: number;
};

function portEntries(nodeId: number): PortEntry[] {
  const entries: PortEntry[] = [];
  for (const edge of SITEMAP_DATA.edges) {
    if (edge.from.id === nodeId) {
      entries.push({
        key: portOverrideKey(edge.id, "from"),
        label: `→ ${NODE_LABEL_BY_ID.get(edge.to.id) ?? edge.to.id}`,
        base: edge.from.position,
      });
    }
    if (edge.to.id === nodeId) {
      entries.push({
        key: portOverrideKey(edge.id, "to"),
        label: `← ${NODE_LABEL_BY_ID.get(edge.from.id) ?? edge.from.id}`,
        base: edge.to.position,
      });
    }
  }
  return entries;
}

export function buildInspectorTarget(
  core: NodeCore,
  portOverrides: PortOverrides,
): SitemapInspectorTarget {
  // core は描画用に整えた値(renderNodes.ts の toRenderNodes)。名前には別タブの
  // 印(↗)が付き、children の位置は親の余白の内側が起点になっているため、名前は
  // サイトの情報から引き、位置は保存値と同じ「親の左上」起点へ戻して見せる。
  const padding = parentPaddingOf(core.id);
  return {
    id: core.id,
    label: { contents: findSitemapSite(core.id)?.label ?? core.label.contents },
    position: { x: core.position.x + padding, y: core.position.y + padding },
    size: { ...core.size },
    ports: Object.fromEntries(
      portEntries(core.id).map((entry) => [
        entry.key,
        portOverrides[entry.key] ?? entry.base,
      ]),
    ),
    angleGuide: ANGLE_GUIDE,
    sitePath: findSitemapSite(core.id)?.path ?? "",
  };
}

/** 画面のパス。表示だけ(編集はしない)。 */
const PATH_FIELD: ColonoscopeField = {
  path: "sitePath",
  label: "パス",
  type: "readonly",
};

/**
 * 「基本」(パス・位置・サイズ)と「結線」(このノード側の端点の角度)の2タブ。
 * パスは固有のパスを持つ画面のときだけ「基本」の先頭に出す(アプリ・ページ内の
 * タブには出さない)。結線の無いノード(ページ内のタブを表す子ノード等)には
 * 「結線」タブを出さない。
 */
export function buildInspectorTabs(
  nodeId: number,
): ColonoscopeTab<SitemapInspectorTarget>[] {
  const hasPath = Boolean(findSitemapSite(nodeId)?.path);
  const tabs: ColonoscopeTab<SitemapInspectorTarget>[] = [
    {
      key: "basic",
      label: "基本",
      fields: hasPath ? [PATH_FIELD, ...BASIC_FIELDS] : BASIC_FIELDS,
    },
  ];

  const entries = portEntries(nodeId);
  if (entries.length > 0) {
    tabs.push({
      key: "ports",
      label: "結線",
      fields: [
        {
          path: "angleGuide",
          label: "このノード側の端点の角度",
          type: "readonly",
        },
        ...entries.map(
          (entry): ColonoscopeField => ({
            path: `${PORT_PATH_PREFIX}${entry.key}`,
            label: entry.label,
            type: "number",
          }),
        ),
      ],
    });
  }

  return tabs;
}

/** 基本タブの「適用」か。Colonoscope のタブモードは表示中のタブの値だけを通知する。 */
export function hasBasicValues(values: ColonoscopeValues): boolean {
  return BASIC_FIELDS.every((field) => field.path in values);
}

/** d3.sitemap は角度を `% 360` で扱う。負値も含めて 0-359 の整数に揃える。 */
function normalizeAngle(value: number) {
  return ((Math.round(value) % 360) + 360) % 360;
}

/** 結線タブの「適用」で、角度が変わった端点だけを返す(保存キー → 角度)。 */
export function readChangedPorts(
  values: ColonoscopeValues,
  target: SitemapInspectorTarget,
): PortOverrides {
  const changed: PortOverrides = {};
  for (const [path, raw] of Object.entries(values)) {
    if (!path.startsWith(PORT_PATH_PREFIX)) continue;
    const key = path.slice(PORT_PATH_PREFIX.length);
    const current = target.ports[key];
    if (current === undefined) continue;

    const parsed = Number(raw);
    if (raw.trim() === "" || Number.isNaN(parsed)) continue;
    const next = normalizeAngle(parsed);
    if (next !== current) changed[key] = next;
  }
  return changed;
}
