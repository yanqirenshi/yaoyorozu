const STORAGE_KEY = "yaoyorozu:sitemap:layout";

export type NodeLayout = {
  position: { x: number; y: number };
  size: { w: number; h: number };
};

export type LayoutOverrides = Record<number, NodeLayout>;

export function loadLayoutOverrides(): LayoutOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LayoutOverrides) : {};
  } catch {
    return {};
  }
}

export function saveLayoutOverrides(overrides: LayoutOverrides): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
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
