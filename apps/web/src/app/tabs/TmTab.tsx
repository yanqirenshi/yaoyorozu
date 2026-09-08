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
  loadCameraTransform,
  loadLayoutOverrides,
  loadPortOverrides,
  migrateLegacyLayoutIfNeeded,
  portOverrideKey,
  type CameraTransform,
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

// --- 視点(パン/ズーム)の保存 ---
// d3.svg の zoom は g.layer の transform 属性を書き換えるだけで、変更を知らせる
// コールバックが配線されていない(D3Svg.zoomed は _callbacks.zoom を呼ばない)。
// そのため transform 属性の変化を MutationObserver で監視して保存する。
// また svg が作り直されるたび(初回マウント・インスペクタ「適用」での再構築)に
// ライブラリが transform を初期値へ戻すため、「直近に svg 上のユーザー入力が
// あったか」でユーザー操作とライブラリ初期化を見分け、後者は保存済みの視点へ戻す。

/** この時間内に svg 上の入力があった transform 変化だけをユーザー操作とみなす。 */
const CAMERA_INPUT_WINDOW_MS = 500;
/** 視点は連続的に変わるため、落ち着いてから保存する。 */
const CAMERA_SAVE_DEBOUNCE_MS = 800;

/** d3-zoom が書く "translate(x,y) scale(k)" を読み取る。 */
function parseLayerTransform(el: Element): CameraTransform | null {
  const attr = el.getAttribute("transform");
  if (!attr) return null;
  const m = attr.match(
    /translate\(([-\d.eE+]+)[,\s]+([-\d.eE+]+)\)\s*scale\(([-\d.eE+]+)/,
  );
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
}

function sameCamera(a: CameraTransform, b: CameraTransform): boolean {
  return (
    Math.abs(a.k - b.k) < 1e-6 &&
    Math.abs(a.x - b.x) < 1e-6 &&
    Math.abs(a.y - b.y) < 1e-6
  );
}

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
  // 視点(パン/ズーム)の現在値。描画はライブラリ側が持つので state にはしない。
  const cameraRef = useRef<CameraTransform>(
    loadCameraTransform() ?? { k: 1, x: 0, y: 0 },
  );
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
      // 同じ tm.json にポート角度・視点も入るため、保存済みの値を必ず一緒に書く
      // (エンティティ位置だけを書くと他が消える)。
      save(buildLayoutFile(next, portOverridesRef.current, cameraRef.current));
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

  // 視点(パン/ズーム)の監視と保存・復元。冒頭のコメント(CAMERA_* 定数)を参照。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 「svg 上の入力があったか」の判定材料。ズーム(ホイール)とパン
    // (svg 上でのドラッグ)だけを数え、インスペクタ等の操作は含めない。
    let lastInputAt = 0;
    const noteInputIfOnSvg = (event: Event) => {
      if ((event.target as Element).closest?.("svg")) lastInputAt = Date.now();
    };
    const handleMouseMove = (event: MouseEvent) => {
      // パン中(左ボタン押下でのドラッグ)だけ延長する。
      if (event.buttons & 1) noteInputIfOnSvg(event);
    };

    let saveTimer: number | null = null;
    const scheduleSave = () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        save(
          buildLayoutFile(
            overridesRef.current,
            portOverridesRef.current,
            cameraRef.current,
          ),
        );
      }, CAMERA_SAVE_DEBOUNCE_MS);
    };

    // 保存済みの視点をライブラリの管理下ごと書き戻す。属性だけ変えると次の
    // ズーム操作が初期値から始まってしまうため、d3-zoom が svg 要素に持たせて
    // いる現在値(__zoom)も差し替える。ZoomTransform クラスは export されて
    // いないので、既存インスタンスの constructor から作り直す。
    const applyCamera = (svg: SVGSVGElement) => {
      const camera = cameraRef.current;
      const holder = svg as unknown as { __zoom?: object };
      if (holder.__zoom) {
        const Ctor = holder.__zoom.constructor as new (
          k: number,
          x: number,
          y: number,
        ) => object;
        holder.__zoom = new Ctor(camera.k, camera.x, camera.y);
      }
      svg.querySelectorAll("g.layer").forEach((layer) => {
        layer.setAttribute(
          "transform",
          `translate(${camera.x},${camera.y}) scale(${camera.k})`,
        );
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target;
        if (!(target instanceof SVGGElement) || !target.matches("g.layer"))
          continue;

        const parsed = parseLayerTransform(target);
        if (!parsed || sameCamera(parsed, cameraRef.current)) continue;

        if (Date.now() - lastInputAt < CAMERA_INPUT_WINDOW_MS) {
          cameraRef.current = parsed;
          scheduleSave();
        } else if (target.ownerSVGElement) {
          // ライブラリによる初期化(svg 作り直し等)。保存済みの視点へ戻す。
          // この書き戻しも mutation を起こすが、次回は parsed が一致して
          // 素通りするためループしない。
          applyCamera(target.ownerSVGElement);
        }
        // 複数レイヤは同時に同じ値へ動くので、1バッチにつき先頭だけ見ればよい。
        break;
      }
    });
    observer.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ["transform"],
    });

    container.addEventListener("wheel", noteInputIfOnSvg, { capture: true });
    container.addEventListener("mousedown", noteInputIfOnSvg, {
      capture: true,
    });
    container.addEventListener("mousemove", handleMouseMove, { capture: true });
    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", noteInputIfOnSvg, {
        capture: true,
      });
      container.removeEventListener("mousedown", noteInputIfOnSvg, {
        capture: true,
      });
      container.removeEventListener("mousemove", handleMouseMove, {
        capture: true,
      });
      if (saveTimer !== null) {
        // 保存待ちのままアンマウントしない(最後の視点を書き切る)。
        window.clearTimeout(saveTimer);
        save(
          buildLayoutFile(
            overridesRef.current,
            portOverridesRef.current,
            cameraRef.current,
          ),
        );
      }
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
      // 位置・角度・視点は同じ tm.json に入るので、1回の保存でまとめて書く。
      save(buildLayoutFile(nextLayout, nextPorts, cameraRef.current));
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
