// サイトマップの手調整(ノードのドラッグ移動・インスペクタでの数値指定)の
// 退避先。web.md §2 により localStorage に置いてよいのは表示補助情報だけで、
// 調整が安定したら値を sitemap.ts へ戻す。
const STORAGE_KEY = "yaoyorozu:sitemap:layout";

// 保存する座標系のバージョン。version 1 は children の位置を絶対座標のまま
// 保存しており、読み戻すと d3.sitemap の fitting() が親の絶対座標を再度
// 加算して二重にずれた(相対座標で保存する version 2 で修正)。保存値だけ
// からは絶対・相対のどちらで書かれたか判別できず変換もできないため、
// 古い版は読み込み時に破棄する(手調整はリセットされる)。
const STORAGE_VERSION = 2;

export type NodeLayout = {
  // children の位置は「親からの相対座標」。SITEMAP_DATA と同じ座標系で持つ
  // (d3.sitemap の fitting() が描画時に親の絶対座標を加算するため)。
  position: { x: number; y: number };
  // サイズはインスペクタで指定したときだけ持つ。ドラッグでは変わらないうえ、
  // 描画データ上のサイズは fitting() が children を包含するよう拡張した後の
  // 値であり、保存してしまうと元データのサイズを上書きしてしまう。
  size?: { w: number; h: number };
};

export type LayoutOverrides = Record<number, NodeLayout>;

type StoredLayout = {
  version: number;
  nodes: LayoutOverrides;
};

export function loadLayoutOverrides(): LayoutOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const stored = JSON.parse(raw) as StoredLayout;
    if (stored?.version !== STORAGE_VERSION) return {};
    return stored.nodes ?? {};
  } catch {
    return {};
  }
}

export function saveLayoutOverrides(overrides: LayoutOverrides): void {
  if (typeof window === "undefined") return;
  const stored: StoredLayout = { version: STORAGE_VERSION, nodes: overrides };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

type SitemapNode = {
  id: number;
  position: { x: number; y: number };
  size: { w: number; h: number };
  children?: SitemapNode[];
};

export function applyLayoutOverrides<T extends SitemapNode>(
  nodes: T[],
  overrides: LayoutOverrides,
): T[] {
  return nodes.map((node) => {
    const override = overrides[node.id];
    return {
      ...node,
      position: override?.position ?? node.position,
      size: override?.size ?? node.size,
      children: node.children
        ? applyLayoutOverrides(node.children as T[], overrides)
        : node.children,
    };
  });
}

/**
 * ノードIDから親ノードIDを引くマップを作る。
 *
 * 描画データ(`<g class="node">` の `__data__`)の位置は children も絶対座標に
 * なっているため、保存時に親の絶対座標を引いて相対座標へ戻すのに使う。
 * ルートノードはマップに含めない(相対化の必要がない)。
 */
export function buildParentIdMap<T extends SitemapNode>(
  nodes: T[],
): Map<number, number> {
  const map = new Map<number, number>();
  const walk = (children: SitemapNode[], parentId: number) => {
    for (const child of children) {
      map.set(child.id, parentId);
      if (child.children) walk(child.children, child.id);
    }
  };
  for (const node of nodes) {
    if (node.children) walk(node.children, node.id);
  }
  return map;
}
