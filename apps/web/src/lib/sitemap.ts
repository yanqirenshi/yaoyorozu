import { COLOR_PALETTE } from "@/data/uiDesign";
import type { WbsSource } from "./wbs";

/**
 * `{リポジトリ}/yyz/spec/sitemap.json` の形(#588)。計算を含まない素の値だけを持つ。
 *
 * 箱の寸法・入れ子の余白・線の色は「見せ方の決まり」なので JSON には入れず、
 * このファイルの定数として持つ(判断の記録は `yyz/spec/sitemap.md`)。
 */
export type SitemapSpec = {
  nodes: SpecNode[];
  edges: SpecEdge[];
};

export type SpecNode = {
  id: number;
  label: string;
  /** 画面のパス。アプリやタブのように、固有のパスを持たないものは持たない。 */
  path?: string;
  /** 画面の説明。 */
  description?: string;
  /** 関連する WBS の ID(`yyz/spec/wbs.json`)。 */
  wbsIds?: number[];
  /**
   * 配下のパスがブラウザで開ける URL であることの印。アプリのノードに付ける。
   * ネイティブアプリの画面のパス(`/settings` など)はアプリ内部の経路で、
   * ブラウザでは開けないため付けない。
   */
  browsable?: boolean;
  /** トップのノードは図の中の絶対座標、`children` は親の左上からの相対座標。 */
  position: { x: number; y: number };
  /** ページの中のタブ。別ページへの遷移ではないので、結線ではなく入れ子で表す。 */
  children?: SpecNode[];
};

export type SpecEdge = {
  id: number;
  /** 角度は 0=下 / 90=左 / 180=上 / 270=右(中間の角度もそのまま使える)。 */
  from: { id: number; angle: number };
  to: { id: number; angle: number };
};

// ============ 見せ方の決まり(寸法・余白・色) ============

/** パスを添えない箱(ルート・アプリ)。 */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;

/**
 * パスを添える箱(ページ)の幅。パスは箱の上に添えるため、いちばん長いパス表示が
 * 収まる幅を**全ページ共通の1つの値**として持つ(#588。以前は URL ごとに幅を
 * 分岐させていた。経緯は `yyz/spec/sitemap.md`)。
 * 収まっているかは `npm run web:check-diagram -- sitemap` のはみ出し 0 件で担保する。
 */
const PAGE_WIDTH = 300;

/** ページの中のタブ。いちばん長いタブ名が収まる幅。 */
const TAB_WIDTH = 200;
const TAB_HEIGHT = 60;

/** 入れ子を持つ箱の内側の余白(d3.sitemap 0.6.0 の padding)。 */
const CONTAINER_PADDING = 30;

const EDGE_COLOR = COLOR_PALETTE.find((c) => c.name === "墨")!.hex;
const EDGE_WIDTH = 1.5;

// ============ 描画データ(d3.sitemap に渡す形) ============

export type SitemapNode = {
  type: "NODE";
  id: number;
  label: { contents: string; position: { x: number; y: number } };
  size: { w: number; h: number };
  position: { x: number; y: number };
  padding?: number;
  children: SitemapNode[];
};

export type SitemapEdge = {
  id: number;
  from: { id: number; position: number };
  to: { id: number; position: number };
  stroke: { color: string; width: number };
};

/** 箱の中のノード名の位置(箱の左上から)。 */
const LABEL_OFFSET = { x: 20, y: 20 };

function toSitemapNode(node: SpecNode, isChild: boolean): SitemapNode {
  const children = (node.children ?? []).map((child) =>
    toSitemapNode(child, true),
  );
  // 入れ子(タブ)は一律の大きさ。ページはパスを添えるため幅を揃える。
  const size = isChild
    ? { w: TAB_WIDTH, h: TAB_HEIGHT }
    : { w: node.path ? PAGE_WIDTH : NODE_WIDTH, h: NODE_HEIGHT };

  return {
    type: "NODE",
    id: node.id,
    label: { contents: node.label, position: { ...LABEL_OFFSET } },
    size,
    position: { ...node.position },
    ...(children.length > 0 ? { padding: CONTAINER_PADDING } : {}),
    children,
  };
}

// ============ 詳細ページ・インスペクタが使う形 ============

/**
 * サイトマップ上の1サイト(アプリ・ページ・タブのノード)。
 * 位置づけ(上位・下位・親ページ・タブ)は JSON の入れ子と結線から導く。
 */
export type SitemapSite = {
  id: number;
  label: string;
  /** このノードを入れ子に持つノード(タブなら、それを含むページ)。 */
  parentId: number | null;
  /** 入れ子(ページ内のタブ)。 */
  childIds: number[];
  /** 結線でこのノードへ入ってくる元。 */
  fromIds: number[];
  /** このノードから結線で出ていく先。 */
  toIds: number[];
  /** 属するアプリのノード名(ルート自身は null)。 */
  appLabel: string | null;
  /** このサイトのパスをブラウザで開けるか(アプリの `browsable` を受け継ぐ)。 */
  browsable: boolean;
  /** 画面のパス(固有のパスを持たないアプリ・タブは null)。 */
  path: string | null;
  /** 画面の説明。 */
  description: string | null;
  /** 関連する WBS の ID。項目名は `resolveWbsNames` で引く。 */
  wbsIds: number[];
};

export type SitemapModel = {
  /** d3.sitemap に渡す箱(寸法・余白を付けたもの)。 */
  nodes: SitemapNode[];
  /** d3.sitemap に渡す線(色を付けたもの)。 */
  edges: SitemapEdge[];
  sites: SitemapSite[];
  siteById: Map<number, SitemapSite>;
  /** 子ノード id → 親の内側の余白。描画と保存で座標の起点が違うため使う。 */
  paddingByChildId: Map<number, number>;
  /** 子ノード id → 親ノード id。 */
  parentIdByChildId: Map<number, number>;
};

/**
 * 仕様データ(JSON)から、描画・詳細ページ・インスペクタが使う形を一度に作る。
 * 実行時に読む(#543)ため、モジュールの先頭で作らず、読み込んだ画面が呼ぶ。
 */
export function buildSitemapModel(spec: SitemapSpec): SitemapModel {
  const specById = new Map<number, SpecNode>();
  const parentIdByChildId = new Map<number, number>();
  const paddingByChildId = new Map<number, number>();

  (function collect(nodes: SpecNode[], parent: SpecNode | null) {
    for (const node of nodes) {
      specById.set(node.id, node);
      if (parent) {
        parentIdByChildId.set(node.id, parent.id);
        paddingByChildId.set(node.id, CONTAINER_PADDING);
      }
      collect(node.children ?? [], node);
    }
  })(spec.nodes, null);

  // 上位のノード(入れ子の親、または結線で入ってくる元)。属するアプリを決めるのに使う。
  const upperById = new Map(parentIdByChildId);
  for (const edge of spec.edges) upperById.set(edge.to.id, edge.from.id);

  /** ルート(上位を持たないノード)の直下にあるノードを「アプリ」とみなす。 */
  function appOf(id: number): SpecNode | null {
    const seen = new Set<number>();
    let current: number | undefined = id;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const upper = upperById.get(current);
      if (upper === undefined) return null; // ルート自身まで辿り着いた
      if (upperById.get(upper) === undefined) return specById.get(current) ?? null;
      current = upper;
    }
    return null;
  }

  const sites: SitemapSite[] = [];
  (function flatten(nodes: SpecNode[], parentId: number | null) {
    for (const node of nodes) {
      const app = appOf(node.id);
      sites.push({
        id: node.id,
        label: node.label,
        parentId,
        childIds: (node.children ?? []).map((child) => child.id),
        fromIds: spec.edges.filter((e) => e.to.id === node.id).map((e) => e.from.id),
        toIds: spec.edges.filter((e) => e.from.id === node.id).map((e) => e.to.id),
        appLabel: app?.label ?? null,
        browsable: app?.browsable ?? false,
        path: node.path ?? null,
        description: node.description ?? null,
        wbsIds: node.wbsIds ?? [],
      });
      flatten(node.children ?? [], node.id);
    }
  })(spec.nodes, null);

  return {
    nodes: spec.nodes.map((node) => toSitemapNode(node, false)),
    edges: spec.edges.map((edge) => ({
      id: edge.id,
      from: { id: edge.from.id, position: edge.from.angle },
      to: { id: edge.to.id, position: edge.to.angle },
      stroke: { color: EDGE_COLOR, width: EDGE_WIDTH },
    })),
    sites,
    siteById: new Map(sites.map((site) => [site.id, site])),
    paddingByChildId,
    parentIdByChildId,
  };
}

/** このサイトのパスを、ブラウザで開けるか(引数を含むパスは開けない)。 */
export function isOpenable(site: SitemapSite): boolean {
  return site.browsable && site.path !== null && !site.path.includes(":");
}

/** サイトの詳細ページ(`/{リポジトリ名}/sitemap/sites/{id}`)のパス。 */
export function siteHref(repo: string, id: number): string {
  return `/${encodeURIComponent(repo)}/sitemap/sites/${id}`;
}

/** サイトマップの図(`/{リポジトリ名}/sitemap`)のパス。 */
export function sitemapHref(repo: string): string {
  return `/${encodeURIComponent(repo)}/sitemap`;
}

/**
 * 関連する WBS の項目名を、上位から並べて返す(例: ["画面", "サイトマップ"])。
 * 以前は `src/data/wbs.ts` を静的 import していたが、#588 で実行時の
 * `yyz/spec/wbs.json` から引く形にした。見つからない ID は落とす。
 */
export function resolveWbsNames(
  wbs: WbsSource,
  ids: number[],
): { id: number; names: string[] }[] {
  const nameById = new Map(wbs.wbs.map((w) => [w._id, w.name]));
  const parentById = new Map(
    wbs.edges
      .filter((e) => e.from_class === "WBS" && e.to_class === "WBS")
      .map((e) => [e.to_id, e.from_id]),
  );

  return ids
    .map((id) => {
      const names: string[] = [];
      const seen = new Set<number>();
      let current: number | undefined = id;
      while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        const name = nameById.get(current);
        if (name === undefined) break;
        names.unshift(name);
        current = parentById.get(current);
      }
      return { id, names };
    })
    .filter((w) => w.names.length > 0);
}
