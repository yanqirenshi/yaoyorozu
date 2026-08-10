"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// d3.sitemap の Rectum は要素のドラッグ移動をライブラリ内部で完結させており、
// 通知コールバックは node.click のみ(§5 命令的APIの原則どおり「描画は行わず通知のみ」)。
// ドラッグ完了位置をホスト側で保存するための move/dragend 相当のコールバックが無いため、
// d3 の data-join で各 <g class="node"> に紐づく __data__(d3 標準の挙動)を
// ドラッグ終了時に読み取ってオーバーライドとして保存する。
type SitemapDatum = {
  _id: number;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overridesRef = useRef(overrides);

  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ドラッグ開始時点の全ノード位置を控えておき、終了時と比較することで
    // 実際に動いたノードだけを検出する(未変更のノードまで上書き保存しないため)。
    let before: Map<number, { x: number; y: number }> | null = null;

    const snapshotPositions = () => {
      const map = new Map<number, { x: number; y: number }>();
      container.querySelectorAll<SVGGElement>("g.node").forEach((el) => {
        const datum = (el as unknown as { __data__?: SitemapDatum })
          .__data__;
        if (datum) map.set(datum._id, { ...datum.position });
      });
      return map;
    };

    // d3-drag(v7)自体が mousedown/mousemove/mouseup で実装されているため
    // (pointerdown/up ではない)、それに合わせて検知する。
    // d3-drag は drag確定時に mousedown/mouseup で event.stopImmediatePropagation()
    // を呼ぶため、bubbleフェーズでは届かない。window の capture フェーズで拾う。
    const handleMouseDown = (event: MouseEvent) => {
      before = (event.target as Element).closest?.("g.node")
        ? snapshotPositions()
        : null;
    };

    const handleMouseUp = () => {
      if (!before) return;
      const beforePositions = before;
      before = null;

      const current = overridesRef.current;
      const next: LayoutOverrides = { ...current };
      let changed = false;

      container.querySelectorAll<SVGGElement>("g.node").forEach((el) => {
        const datum = (el as unknown as { __data__?: SitemapDatum })
          .__data__;
        if (!datum) return;

        const prev = beforePositions.get(datum._id);
        if (
          !prev ||
          (prev.x === datum.position.x && prev.y === datum.position.y)
        ) {
          return;
        }

        next[datum._id] = {
          position: { x: datum.position.x, y: datum.position.y },
          size: current[datum._id]?.size ?? datum.size,
        };
        changed = true;
      });

      if (!changed) return;
      setOverrides(next);
      saveLayoutOverrides(next);
    };

    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, {
        capture: true,
      });
      window.removeEventListener("mouseup", handleMouseUp, {
        capture: true,
      });
    };
  }, []);

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
    <div ref={containerRef} className="relative flex min-h-0 w-full flex-1">
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
