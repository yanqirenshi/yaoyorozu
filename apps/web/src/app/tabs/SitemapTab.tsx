"use client";

import { useMemo, useState } from "react";
import D3Sitemap, { Rectum } from "@yanqirenshi/d3.sitemap";
import Colonoscope from "@yanqirenshi/colonoscope";
import { SITEMAP_DATA } from "@/data/sitemap";
import {
  applyLayoutOverrides,
  loadLayoutOverrides,
  saveLayoutOverrides,
  type LayoutOverrides,
} from "@/data/sitemapLayoutStorage";

type SitemapNodeCore = {
  id: number;
  label: { contents: string };
  position: { x: number; y: number };
  size: { w: number; h: number };
};

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export default function SitemapTab() {
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<SitemapNodeCore | null>(null);
  const [overrides, setOverrides] = useState<LayoutOverrides>(() =>
    loadLayoutOverrides(),
  );

  const rectum = useMemo(() => {
    const instance = new Rectum({
      callbacks: {
        node: {
          click: (core: SitemapNodeCore) => setSelected(core),
        },
      },
    });
    instance.data({
      nodes: applyLayoutOverrides(SITEMAP_DATA.nodes, overrides),
      edges: SITEMAP_DATA.edges,
    });
    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, version]);

  const handleApply = (values: Record<string, string>) => {
    if (!selected) return;

    const next: LayoutOverrides = {
      ...overrides,
      [selected.id]: {
        position: {
          x: toNumber(values["position.x"], selected.position.x),
          y: toNumber(values["position.y"], selected.position.y),
        },
        size: {
          w: toNumber(values["size.w"], selected.size.w),
          h: toNumber(values["size.h"], selected.size.h),
        },
      },
    };

    setOverrides(next);
    saveLayoutOverrides(next);
    setSelected(null);
    setVersion((v) => v + 1);
  };

  return (
    <div className="relative flex min-h-0 w-full flex-1">
      <D3Sitemap key={version} rectum={rectum} />

      <Colonoscope
        target={selected}
        title={(t: SitemapNodeCore) => t.label?.contents}
        fields={[
          { path: "position.x", label: "X", type: "number" },
          { path: "position.y", label: "Y", type: "number" },
          { path: "size.w", label: "幅", type: "number" },
          { path: "size.h", label: "高さ", type: "number" },
        ]}
        onApply={handleApply}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
