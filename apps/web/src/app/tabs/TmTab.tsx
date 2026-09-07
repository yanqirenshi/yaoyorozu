"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import D3Ter, { Rectum } from "@yanqirenshi/d3.ter";
import { TM_DATA, TM_ENTITY_KEY_BY_ID } from "@/data/tm";
import {
  applyLayoutOverrides,
  loadLayoutOverrides,
  saveLayoutOverrides,
  type LayoutOverrides,
} from "@/data/tmLayoutStorage";

// d3.ter はエンティティのドラッグ移動をライブラリ内部で完結させており、移動を
// 知らせるコールバックが無い(Painters/Entities.js の dragEnd は `_drag` を消す
// だけ)。ドラッグ中は Entity インスタンスの `position` が直接書き換えられるため、
// d3 の data-join で各 <g class="entity"> に紐づく `__data__`(d3 標準の挙動)を
// ドラッグ終了時に読み取ってオーバーライドとして保存する。
// SitemapTab と同じ方式。
type TerEntityDatum = {
  _id: number;
  position: { x: number; y: number };
};

export default function TmTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 初期値は state で受ける(レンダー中に ref を読まないため)。以降の書き込みは
  // イベントハンドラ内だけなので、作業コピーは ref で持つ。
  const [initialOverrides] = useState<LayoutOverrides>(loadLayoutOverrides);
  const overridesRef = useRef<LayoutOverrides>(initialOverrides);

  const rectum = useMemo(() => {
    const instance = new Rectum({ callbacks: {} });
    instance.data({
      ...TM_DATA,
      entities: applyLayoutOverrides(
        TM_DATA.entities,
        TM_ENTITY_KEY_BY_ID,
        initialOverrides,
      ),
    });
    return instance;
  }, [initialOverrides]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ドラッグ開始時点の全エンティティ位置を控えておき、終了時と比較することで
    // 実際に動いたものだけを検出する(未変更まで上書き保存しないため)。
    let before: Map<number, NodePositionSnapshot> | null = null;

    const snapshotPositions = () => {
      const map = new Map<number, NodePositionSnapshot>();
      container.querySelectorAll<SVGGElement>("g.entity").forEach((el) => {
        const datum = (el as unknown as { __data__?: TerEntityDatum }).__data__;
        if (datum) map.set(datum._id, { ...datum.position });
      });
      return map;
    };

    // d3-drag(v7)は mousedown/mousemove/mouseup で実装されており、確定時に
    // stopImmediatePropagation を呼ぶため bubble フェーズでは届かない。
    // window の capture フェーズで拾う。
    const handleMouseDown = (event: MouseEvent) => {
      before = (event.target as Element).closest?.("g.entity")
        ? snapshotPositions()
        : null;
    };

    const handleMouseUp = () => {
      if (!before) return;
      const beforePositions = before;
      before = null;

      const next: LayoutOverrides = { ...overridesRef.current };
      let changed = false;

      snapshotPositions().forEach((position, id) => {
        const prev = beforePositions.get(id);
        if (!prev || (prev.x === position.x && prev.y === position.y)) return;

        const key = TM_ENTITY_KEY_BY_ID[id];
        if (!key) return;

        next[key] = { x: position.x, y: position.y };
        changed = true;
      });

      if (!changed) return;
      overridesRef.current = next;
      saveLayoutOverrides(next);
    };

    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, {
        capture: true,
      });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
    };
  }, []);

  return (
    <div ref={containerRef} className="flex min-h-0 w-full flex-1">
      <D3Ter id="d3-ter-graph" rectum={rectum} />
    </div>
  );
}

type NodePositionSnapshot = { x: number; y: number };
