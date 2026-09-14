"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClassDiagram, type RelationshipInput } from "@yanqirenshi/d3.classes";
import { CLASS_DIAGRAM_DATA } from "@/data/classes";
import {
  applyLayoutOverrides,
  applyPortOverrides,
  buildLayoutFile,
  loadLayoutOverrides,
  loadPortOverrides,
  migrateLegacyLayoutIfNeeded,
  portOverrideKey,
  toAngle,
  type LayoutOverrides,
  type PortOverrides,
} from "@/data/classesLayoutStorage";
import ClassesInspector, {
  type ClassesInspectorPort,
  type ClassesInspectorTarget,
} from "./classes/ClassesInspector";
import {
  useLayoutSaveStatus,
  LayoutSaveStatusSnackbar,
} from "./layout/LayoutSaveStatus";

/** インスペクタの幅(px)。マウスで伸縮できる。TM(TmTab)と同じ値に揃える。 */
const INSPECTOR_WIDTH = { initial: 444, min: 222, max: 888 } as const;

function clampWidth(value: number) {
  return Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, value));
}

/** 保存キー(`<関係線 id>:<from|to>`)から関係線 id を取り出す。 */
function relationshipIdOf(portKey: string) {
  return portKey.slice(0, portKey.lastIndexOf(":"));
}

/**
 * 選択中クラスに繋がる関係線の端点を集める。起点・終点の両方を見るので、
 * 同じクラスどうしの関係線(自己参照)は2行になる。
 */
function buildPorts(
  physical: string,
  relationships: RelationshipInput[],
): ClassesInspectorPort[] {
  const ports: ClassesInspectorPort[] = [];
  for (const rel of relationships) {
    if (!rel.id) continue;
    for (const end of ["from", "to"] as const) {
      const self = rel[end];
      const other = end === "from" ? rel.to : rel.from;
      if (!("classId" in self) || self.classId !== physical) continue;
      ports.push({
        key: portOverrideKey(rel.id, end),
        counterpart: "classId" in other ? other.classId : "(座標)",
        label: rel.label,
        outgoing: end === "from",
        // 辺のキーワードで書いた端点も、その辺の中央に当たる角度に読み替えて見せる。
        angle: toAngle(self.point),
      });
    }
  }
  return ports;
}

export default function ClassesTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const diagramRef = useRef<ClassDiagram | null>(null);
  const overridesRef = useRef<LayoutOverrides>(loadLayoutOverrides());
  const portOverridesRef = useRef<PortOverrides>(loadPortOverrides());
  // 描画中の関係線(接続辺の手調整を反映済み)。インスペクタの結線一覧はここから作る。
  const relationshipsRef = useRef<RelationshipInput[]>([]);
  const [selected, setSelected] = useState<ClassesInspectorTarget | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState<number>(
    INSPECTOR_WIDTH.initial,
  );
  const [resizing, setResizing] = useState(false);
  const { state: saveState, save, close: closeSaveStatus } =
    useLayoutSaveStatus("classes");

  // 旧方式(localStorage)からの一時的な自己移行。全環境の移行が済んだら削除してよい。
  useEffect(() => {
    migrateLegacyLayoutIfNeeded();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const classes = applyLayoutOverrides(
      CLASS_DIAGRAM_DATA.classes,
      overridesRef.current,
    );
    const relationships = applyPortOverrides(
      CLASS_DIAGRAM_DATA.relationships,
      portOverridesRef.current,
    );
    relationshipsRef.current = relationships;

    // クラスの id は物理名(classDiagram.ts の defineDiagram で付与)。DOM の data-id もこれになる。
    const classById = new Map(classes.map((c) => [c.name.physical, c]));

    const diagram = new ClassDiagram(container);
    diagramRef.current = diagram;
    diagram.loadFromData({ classes, relationships }).render();

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
        if (!dataId || !match || !classById.has(dataId)) return;

        map.set(dataId, { x: parseFloat(match[1]), y: parseFloat(match[2]) });
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
      save(buildLayoutFile(next, portOverridesRef.current));
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

      const cls = classById.get(dataId);
      if (!cls) return;

      setSelected({
        physical: cls.name.physical,
        description: cls.name.description,
        stereotype: cls.stereotype ?? "",
        position: { ...cls.position },
        ports: buildPorts(cls.name.physical, relationshipsRef.current),
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };

    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    container.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown, { capture: true });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("click", handleClick);
      diagram.clear();
      container.innerHTML = "";
      diagramRef.current = null;
    };
  }, [save]);

  // インスペクタ幅の伸縮。ハンドルを掴んでいるあいだ window で追う。
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      // パネルは右端に貼り付くので、図の右端からの距離がそのまま幅になる。
      const right = container.getBoundingClientRect().right;
      setInspectorWidth(clampWidth(right - event.clientX));
    };
    const stop = () => setResizing(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [resizing]);

  const handleApply = useCallback(
    (values: {
      position: { x: number; y: number };
      ports: Record<string, number>;
    }) => {
      if (!selected) return;
      const diagram = diagramRef.current;

      // 位置は変えたときだけ上書きに加える(接続辺だけ変えたときに、同じ座標の
      // 行を classes.json に増やさないため)。ドラッグで保存済みの分を落とさないよう、
      // 常に ref を土台にする。
      let nextLayout = overridesRef.current;
      const { x, y } = values.position;
      if (x !== selected.position.x || y !== selected.position.y) {
        diagram?.getClass(selected.physical)?.moveTo(x, y);
        nextLayout = { ...nextLayout, [selected.physical]: { x, y } };
      }

      const nextPorts: PortOverrides = {
        ...portOverridesRef.current,
        ...values.ports,
      };
      const nextRelationships = applyPortOverrides(
        CLASS_DIAGRAM_DATA.relationships,
        nextPorts,
      );
      // 接続辺を変えた関係線だけ付け替える(setConnection はその場で描き直す)。
      const changedIds = new Set(Object.keys(values.ports).map(relationshipIdOf));
      for (const rel of nextRelationships) {
        if (rel.id && changedIds.has(rel.id)) {
          diagram?.getRelationship(rel.id)?.setConnection(rel.from, rel.to);
        }
      }

      overridesRef.current = nextLayout;
      portOverridesRef.current = nextPorts;
      relationshipsRef.current = nextRelationships;
      // 位置と接続辺は同じ classes.json に入るので、1回の保存でまとめて書く。
      save(buildLayoutFile(nextLayout, nextPorts));
      setSelected(null);
    },
    [selected, save],
  );

  return (
    <div
      className="relative flex min-h-0 w-full flex-1"
      style={{
        // 伸縮中はテキスト選択で掴んだ感触が濁るため止める。
        userSelect: resizing ? "none" : undefined,
      }}
    >
      <div ref={containerRef} className="min-h-0 w-full flex-1" />

      {selected && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="インスペクタの幅を変更"
          onMouseDown={(event) => {
            event.preventDefault();
            setResizing(true);
          }}
          className="absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize hover:bg-[var(--border-default)]"
          style={{ right: inspectorWidth - 3 }}
        />
      )}

      {selected && (
        <ClassesInspector
          target={selected}
          width={inspectorWidth}
          onApply={handleApply}
          onClose={() => setSelected(null)}
        />
      )}

      <LayoutSaveStatusSnackbar state={saveState} onClose={closeSaveStatus} />
    </div>
  );
}
