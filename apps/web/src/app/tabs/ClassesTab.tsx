"use client";

import { useEffect, useRef } from "react";
import { ClassDiagram } from "@yanqirenshi/d3.classes";
import { SESSION_LINE_CLASS_DATA } from "@/data/classes-session-line";
import {
  applyLayoutOverrides,
  loadLayoutOverrides,
  saveLayoutOverrides,
  type LayoutOverrides,
} from "@/data/classesLayoutStorage";

export default function ClassesTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const overridesRef = { current: loadLayoutOverrides() };
    const classes = applyLayoutOverrides(
      SESSION_LINE_CLASS_DATA.classes,
      overridesRef.current,
    );

    const diagram = new ClassDiagram(container);
    diagram
      .loadFromData({ classes, relationships: SESSION_LINE_CLASS_DATA.relationships })
      .render();

    // d3.classes の ClassBox はドラッグ移動をライブラリ内部で完結させており、
    // 通知コールバック(dragend相当)が無い。SitemapTab と同じ方式で、
    // ドラッグ終了時にレンダー結果のDOM(data-id + transform)を読み取って保存する。
    // d3-drag が mousedown/mouseup で stopImmediatePropagation するため、
    // bubbleフェーズでは拾えず window の capture フェーズで拾う。
    let before: Map<string, { x: number; y: number }> | null = null;

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
    };

    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });

    return () => {
      window.removeEventListener("mousedown", handleMouseDown, { capture: true });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
      diagram.clear();
      container.innerHTML = "";
    };
  }, []);

  return <div ref={containerRef} className="min-h-0 w-full flex-1" />;
}
