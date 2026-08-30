"use client";

import { useEffect, useRef, useState } from "react";
import { ClassDiagram } from "@yanqirenshi/d3.classes";
import Colonoscope from "@yanqirenshi/colonoscope";
import { SESSION_LINE_CLASS_DATA } from "@/data/classes-session-line";
import {
  applyLayoutOverrides,
  loadLayoutOverrides,
  saveLayoutOverrides,
  type LayoutOverrides,
} from "@/data/classesLayoutStorage";

type SelectedClass = {
  id: string; // ClassDiagram 内部の "class-N"(getClass で引くためだけに使う)
  physical: string;
  description: string;
  stereotype: string;
  position: { x: number; y: number };
};

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export default function ClassesTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const diagramRef = useRef<ClassDiagram | null>(null);
  const overridesRef = useRef<LayoutOverrides>(loadLayoutOverrides());
  const [selected, setSelected] = useState<SelectedClass | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const classes = applyLayoutOverrides(
      SESSION_LINE_CLASS_DATA.classes,
      overridesRef.current,
    );

    const diagram = new ClassDiagram(container);
    diagramRef.current = diagram;
    diagram
      .loadFromData({ classes, relationships: SESSION_LINE_CLASS_DATA.relationships })
      .render();

    // d3.classes の ClassBox はクリック/ドラッグ移動をライブラリ内部で完結させており、
    // 通知コールバック(click/dragend相当)が無い。SitemapTab と同じ方式で、
    // レンダー結果のDOM(data-id + transform)を読み取って対応する。
    let before: Map<string, { x: number; y: number }> | null = null;
    let suppressNextClick = false;

    const snapshotPositions = () => {
      const map = new Map<string, { x: number; y: number }>();
      container.querySelectorAll<SVGGElement>("g.class-box").forEach((el) => {
        const dataId = el.getAttribute("data-id");
        const transform = el.getAttribute("transform") || "";
        const match = transform.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
        if (!dataId || !match) return;

        const index = Number(dataId.replace("class-", "")) - 1;
        const physical = classes[index]?.name.physical;
        if (!physical) return;

        map.set(physical, { x: parseFloat(match[1]), y: parseFloat(match[2]) });
      });
      return map;
    };

    // d3-drag が mousedown/mouseup で stopImmediatePropagation するため、
    // bubbleフェーズでは拾えず window の capture フェーズで拾う。
    const handleMouseDown = (event: MouseEvent) => {
      before = (event.target as Element).closest?.("g.class-box")
        ? snapshotPositions()
        : null;
    };

    const handleMouseUp = () => {
      if (!before) return;
      const beforePositions = before;
      before = null;

      const next: LayoutOverrides = { ...overridesRef.current };
      let changed = false;

      snapshotPositions().forEach((pos, physical) => {
        const prev = beforePositions.get(physical);
        if (prev && prev.x === pos.x && prev.y === pos.y) return;
        next[physical] = pos;
        changed = true;
      });

      if (!changed) return;
      overridesRef.current = next;
      saveLayoutOverrides(next);
      // 移動を伴った操作の直後に発生する click でインスペクタが開かないようにする
      // (d3-sitemap の Rectum が「静止クリックだけ届ける」のと同じ意図)。
      suppressNextClick = true;
    };

    // click は mousedown とは別にブラウザが発火する素のイベントなので、
    // d3-drag の stopPropagation の影響を受けずコンテナの bubble で拾える。
    const handleClick = (event: MouseEvent) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }

      const target = (event.target as Element).closest?.("g.class-box");
      const dataId = target?.getAttribute("data-id");
      if (!dataId) return;

      const index = Number(dataId.replace("class-", "")) - 1;
      const cls = classes[index];
      if (!cls) return;

      setSelected({
        id: dataId,
        physical: cls.name.physical,
        description: cls.name.description,
        stereotype: cls.stereotype ?? "",
        position: { ...cls.position },
      });
    };

    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    container.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown, { capture: true });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
      container.removeEventListener("click", handleClick);
      diagram.clear();
      container.innerHTML = "";
      diagramRef.current = null;
    };
  }, []);

  const handleApply = (values: Record<string, string>) => {
    if (!selected) return;

    const x = toNumber(values["position.x"], selected.position.x);
    const y = toNumber(values["position.y"], selected.position.y);

    diagramRef.current?.getClass(selected.id)?.moveTo(x, y);

    const next: LayoutOverrides = {
      ...overridesRef.current,
      [selected.physical]: { x, y },
    };
    overridesRef.current = next;
    saveLayoutOverrides(next);
    setSelected(null);
  };

  return (
    <div className="relative flex min-h-0 w-full flex-1">
      <div ref={containerRef} className="min-h-0 w-full flex-1" />

      <Colonoscope
        target={selected}
        title={(t: SelectedClass) => t.physical}
        subtitle={(t: SelectedClass) => t.stereotype}
        fields={[
          { path: "description", label: "説明", type: "readonly" },
          { path: "position.x", label: "X", type: "number" },
          { path: "position.y", label: "Y", type: "number" },
        ]}
        onApply={handleApply}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
