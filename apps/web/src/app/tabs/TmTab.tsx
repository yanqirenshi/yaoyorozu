"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import D3Ter, { Rectum } from "@yanqirenshi/d3.ter";
import TmInspector, {
  type TmInspectorPort,
  type TmInspectorTarget,
} from "./tm/TmInspector";
import {
  TM_DATA,
  TM_ENTITY_KEY_BY_ID,
  TM_RELATIONSHIP_KEY_BY_ID,
} from "@/data/tm";
import {
  applyLayoutOverrides,
  applyPortOverrides,
  buildLayoutFile,
  loadLayoutOverrides,
  loadPortOverrides,
  migrateLegacyLayoutIfNeeded,
  portOverrideKey,
  type LayoutOverrides,
  type PortOverrides,
} from "@/data/tmLayoutStorage";
import {
  useLayoutSaveStatus,
  LayoutSaveStatusSnackbar,
} from "./layout/LayoutSaveStatus";

// d3.ter はエンティティのドラッグ移動をライブラリ内部で完結させており、移動を
// 知らせるコールバックが無い(Painters/Entities.js の dragEnd は `_drag` を消す
// だけ)。ドラッグ中は Entity インスタンスの `position` が直接書き換えられるため、
// d3 の data-join で各 <g class="entity"> に紐づく `__data__`(d3 標準の挙動)を
// ドラッグ終了時に読み取ってオーバーライドとして保存する。SitemapTab と同じ方式。
type TerEntityDatum = {
  _id: number;
  position: { x: number; y: number };
};

type Position = { x: number; y: number };

/** インスペクタの幅(px)。マウスで伸縮できる。 */
const INSPECTOR_WIDTH = { initial: 444, min: 222, max: 888 } as const;

function clampWidth(value: number) {
  return Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, value));
}

/**
 * 指定エンティティに繋がる結線を、そのエンティティ側の端点として並べる。
 * 相手側の角度はここには出さない(相手を選べばそちらから編集できる)。
 */
function buildPorts(
  entityId: number,
  overrides: PortOverrides,
): TmInspectorPort[] {
  const ports: TmInspectorPort[] = [];

  for (const relationship of TM_DATA.relationships) {
    const relationshipKey = TM_RELATIONSHIP_KEY_BY_ID[relationship.id];
    if (!relationshipKey) continue;

    const ends: ("from" | "to")[] = [];
    if (relationship.from.entity === entityId) ends.push("from");
    if (relationship.to.entity === entityId) ends.push("to");

    for (const end of ends) {
      const counterpartId =
        end === "from" ? relationship.to.entity : relationship.from.entity;
      const key = portOverrideKey(relationshipKey, end);
      const base =
        end === "from"
          ? relationship.from.position
          : relationship.to.position;

      ports.push({
        key,
        counterpart:
          TM_DATA.entities.find((entity) => entity.id === counterpartId)?.name ??
          "",
        label: relationship.label,
        outgoing: end === "from",
        angle: overrides[key] ?? base,
      });
    }
  }

  return ports;
}

export default function TmTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 図の再構築に使う値。ドラッグでは更新せず(DOM 側が既に正しいため)、
  // インスペクタの「適用」でのみ更新して version と一緒に作り直す。
  const [overrides, setOverrides] = useState<LayoutOverrides>(loadLayoutOverrides);
  // 常に最新の手調整。ドラッグ保存はこちらだけを更新する。
  const overridesRef = useRef<LayoutOverrides>(overrides);
  // ポート角度はドラッグで変わらないので state だけで足りる。
  const [portOverrides, setPortOverrides] =
    useState<PortOverrides>(loadPortOverrides);
  // 右クリックのハンドラは deps 空の effect の中にあり state を読めないため、
  // 開いた時点の値を渡せるよう ref に写しておく。
  const portOverridesRef = useRef<PortOverrides>(portOverrides);
  useEffect(() => {
    portOverridesRef.current = portOverrides;
  }, [portOverrides]);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<TmInspectorTarget | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState<number>(
    INSPECTOR_WIDTH.initial,
  );
  const [resizing, setResizing] = useState(false);
  const { state: saveState, save, close: closeSaveStatus } =
    useLayoutSaveStatus("tm");

  // 旧方式(localStorage)からの一時的な自己移行。全環境の移行が済んだら削除してよい。
  useEffect(() => {
    migrateLegacyLayoutIfNeeded();
  }, []);

  const rectum = useMemo(() => {
    const instance = new Rectum({ callbacks: {} });
    instance.data({
      ...TM_DATA,
      entities: applyLayoutOverrides(
        TM_DATA.entities,
        TM_ENTITY_KEY_BY_ID,
        overrides,
      ),
      relationships: applyPortOverrides(
        TM_DATA.relationships,
        TM_RELATIONSHIP_KEY_BY_ID,
        portOverrides,
      ),
    });
    return instance;
  }, [overrides, portOverrides]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const readPositions = () => {
      const map = new Map<number, Position>();
      container.querySelectorAll<SVGGElement>("g.entity").forEach((el) => {
        const datum = (el as unknown as { __data__?: TerEntityDatum }).__data__;
        if (datum) map.set(datum._id, { ...datum.position });
      });
      return map;
    };

    // ドラッグ開始時点の位置を控え、終了時と比較して実際に動いたものだけ保存する。
    let before: Map<number, Position> | null = null;

    // d3-drag(v7)は mousedown/mousemove/mouseup で実装されており、確定時に
    // stopImmediatePropagation を呼ぶため bubble フェーズでは届かない。
    // window の capture フェーズで拾う。
    const handleMouseDown = (event: MouseEvent) => {
      before = (event.target as Element).closest?.("g.entity")
        ? readPositions()
        : null;
    };

    const handleMouseUp = () => {
      if (!before) return;
      const beforePositions = before;
      before = null;

      const next: LayoutOverrides = { ...overridesRef.current };
      let changed = false;

      readPositions().forEach((position, id) => {
        const prev = beforePositions.get(id);
        if (!prev || (prev.x === position.x && prev.y === position.y)) return;

        const key = TM_ENTITY_KEY_BY_ID[id];
        if (!key) return;

        next[key] = { x: position.x, y: position.y };
        changed = true;
      });

      if (!changed) return;
      overridesRef.current = next;
      // 同じ tm.json にポート角度も入るため、保存済みの角度を必ず一緒に書く
      // (エンティティ位置だけを書くと角度が消える)。
      save(buildLayoutFile(next, portOverridesRef.current));
    };

    // 右クリックでインスペクタを開く(issue #109 と同じ流儀)。d3.ter に
    // contextmenu のコールバックが無いため、コンテナへの委譲で拾う。
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();

      const target = (event.target as Element).closest?.("g.entity");
      const datum = target
        ? (target as unknown as { __data__?: TerEntityDatum }).__data__
        : undefined;
      if (!datum) {
        // 空白部の右クリックは閉じる操作にあてる。
        setSelected(null);
        return;
      }

      const core = TM_DATA.entities.find((entity) => entity.id === datum._id);
      if (!core) return;

      setSelected({
        id: datum._id,
        key: TM_ENTITY_KEY_BY_ID[datum._id] ?? "",
        name: core.name,
        type: core.type,
        description: core.description,
        // ドラッグ後の実値を見せる(TM_DATA の初期値ではない)。
        position: { ...datum.position },
        ports: buildPorts(datum._id, portOverridesRef.current),
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };

    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    container.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, {
        capture: true,
      });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [save]);

  // インスペクタ幅の伸縮。ハンドルを掴んでいるあいだ window で追う。
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      // パネルは右端に貼り付くので、コンテナ右端からの距離がそのまま幅になる。
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

      // ドラッグで保存済みの分を落とさないよう、常に ref を土台にする。
      const nextLayout: LayoutOverrides = {
        ...overridesRef.current,
        [selected.key]: { x: values.position.x, y: values.position.y },
      };
      const nextPorts: PortOverrides = {
        ...portOverridesRef.current,
        ...values.ports,
      };

      overridesRef.current = nextLayout;
      portOverridesRef.current = nextPorts;
      // 位置と角度は同じ tm.json に入るので、1回の保存でまとめて書く。
      save(buildLayoutFile(nextLayout, nextPorts));
      setOverrides(nextLayout);
      setPortOverrides(nextPorts);

      // rectum を作り直しただけでは再描画されないため、D3Ter を貼り替える。
      setVersion((v) => v + 1);
      setSelected(null);
    },
    [selected, save],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 w-full flex-1"
      style={{
        // 伸縮中はテキスト選択で掴んだ感触が濁るため止める。
        userSelect: resizing ? "none" : undefined,
      }}
    >
      <D3Ter key={version} id="d3-ter-graph" rectum={rectum} />

      {selected && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="インスペクタの幅を変更"
          onMouseDown={(event) => {
            event.preventDefault();
            setResizing(true);
          }}
          className="absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize hover:bg-zinc-300"
          style={{ right: inspectorWidth - 3 }}
        />
      )}

      {selected && (
        <TmInspector
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
