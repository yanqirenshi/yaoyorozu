"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import D3Sitemap, { Rectum } from "@yanqirenshi/d3.sitemap";
import Colonoscope from "@yanqirenshi/colonoscope";
import Box from "@mui/material/Box";
import { SITEMAP_DATA } from "@/data/sitemap";
import {
  applyLayoutOverrides,
  applyPortOverrides,
  buildLayoutFile,
  buildParentIdMap,
  loadCameraTransform,
  loadLayoutOverrides,
  loadPortOverrides,
  migrateLegacyLayoutIfNeeded,
  type LayoutOverrides,
  type PortOverrides,
} from "@/data/sitemapLayoutStorage";
import {
  useLayoutSaveStatus,
  LayoutSaveStatusSnackbar,
} from "./layout/LayoutSaveStatus";
import { useCameraPersistence } from "./layout/useCameraPersistence";
import SiteLink, { siteHref } from "./sitemap/SiteLink";
import { toRenderNodes } from "./sitemap/renderNodes";
// 文字の大きさ・太さは基本デザインのテキストスタイルから引く(規約 §4)。
import { textStyle } from "./UiDesign/tokens";
import {
  buildInspectorTabs,
  buildInspectorTarget,
  hasBasicValues,
  readChangedPorts,
  type SitemapInspectorTarget,
} from "./sitemap/sitemapInspector";

const PARENT_ID_BY_NODE_ID = buildParentIdMap(SITEMAP_DATA.nodes);

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
// 右クリックでインスペクタを開くときも、同じ __data__ の `_core`(入力データその
// もの。node.click コールバックに渡されるのと同じもの)を使う。
type SitemapDatum = {
  _id: number;
  position: { x: number; y: number };
  _core?: SitemapNodeCore;
};

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export default function SitemapTab() {
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<SitemapInspectorTarget | null>(
    null,
  );
  const [overrides, setOverrides] = useState<LayoutOverrides>(() =>
    loadLayoutOverrides(),
  );
  // 結線の端点の角度。ドラッグでは変わらず、インスペクタの「適用」でだけ変わる。
  const [portOverrides, setPortOverrides] =
    useState<PortOverrides>(loadPortOverrides);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overridesRef = useRef(overrides);
  // ドラッグ・視点の保存と右クリックでのインスペクタ表示は effect の中から
  // 呼ばれるため、最新の角度を ref でも持つ。
  const portOverridesRef = useRef(portOverrides);
  const { state: saveState, save, close: closeSaveStatus } =
    useLayoutSaveStatus("sitemap");
  // 視点(パン/ズーム)。変わるたびに、ノードの手調整・角度と一緒に sitemap.json へ
  // 保存する。d3.sitemap は d3.svg の zoom を使い、ズーム・パンで g.layer
  // (background / foreground)の transform を書き換える(TM と同じ)。図の再構築
  // (初回描画・インスペクタの「適用」)でライブラリが等倍・原点へ戻すと、フックが
  // 保存済みの視点へ戻す。
  // d3.svg には初期視点を渡す口(options.transform)もあるが、
  // zoomIdentity.scale(k).translate(x, y) の順で組み立てるため x・y が k 倍に
  // ずれる。使わずにフックの書き戻しに任せる。
  const { cameraRef } = useCameraPersistence({
    containerRef,
    layerSelector: "g.layer",
    initial: loadCameraTransform(),
    onSave: (camera) =>
      save(
        buildLayoutFile(overridesRef.current, portOverridesRef.current, camera),
      ),
  });

  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // 旧方式(localStorage)からの一時的な自己移行。全環境の移行が済んだら削除してよい。
  useEffect(() => {
    migrateLegacyLayoutIfNeeded();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ドラッグ開始時点の全ノード位置を控えておき、終了時と比較することで
    // 実際に動いたノードだけを検出する(未変更のノードまで上書き保存しないため)。
    let before: Map<number, { x: number; y: number }> | null = null;

    // d3.sitemap の fitting() は描画前に children の position を
    // 「親の絶対座標 + 相対座標」へ書き換えるため、`<g class="node">` の
    // __data__ が持つ位置は children も絶対座標である。一方 SITEMAP_DATA と
    // オーバーライドは children を相対座標で持つ(そのまま絶対座標で保存すると
    // 次回描画時に fitting() が親の座標を二重に加算してずれる)。そこで保存前に
    // 親の絶対座標を引いて相対座標へ戻す。
    // 副次的な効果として、親をドラッグしてサブツリーごと動いた場合は children の
    // 相対座標が変わらないため、子に不要なオーバーライドが書かれなくなる。
    const snapshotPositions = () => {
      const absolute = new Map<number, { x: number; y: number }>();
      container.querySelectorAll<SVGGElement>("g.node").forEach((el) => {
        const datum = (el as unknown as { __data__?: SitemapDatum })
          .__data__;
        if (datum) absolute.set(datum._id, { ...datum.position });
      });

      const relative = new Map<number, { x: number; y: number }>();
      absolute.forEach((position, id) => {
        const parentId = PARENT_ID_BY_NODE_ID.get(id);
        const parent =
          parentId === undefined ? undefined : absolute.get(parentId);
        relative.set(
          id,
          parent
            ? { x: position.x - parent.x, y: position.y - parent.y }
            : position,
        );
      });
      return relative;
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

      snapshotPositions().forEach((position, id) => {
        const prev = beforePositions.get(id);
        if (!prev || (prev.x === position.x && prev.y === position.y)) return;

        // サイズはドラッグでは変わらないため、インスペクタで指定済みの値だけを
        // 引き継ぐ(描画データ上のサイズは fitting() が children を包含するよう
        // 拡張した後の値であり、保存すると元データのサイズを上書きしてしまう)。
        next[id] = { position, size: current[id]?.size };
        changed = true;
      });

      if (!changed) return;
      // 視点の保存はこの ref を読むので、再描画を待たずに先に更新しておく。
      overridesRef.current = next;
      setOverrides(next);
      // 同じ sitemap.json に角度・視点も入るため、保存済みの値を必ず一緒に書く
      // (ノードの手調整だけを書くとほかが消える)。
      save(buildLayoutFile(next, portOverridesRef.current, cameraRef.current));
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
  }, [save, cameraRef]);

  // 右クリックでインスペクタを開く(TM・ハブと同じ流儀)。d3.sitemap には
  // contextmenu のコールバックが無いため、コンテナへの委譲で拾う。空白部の
  // 右クリックと Esc は閉じる操作にあてる。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();

      const target = (event.target as Element).closest?.("g.node");
      const core = target
        ? (target as unknown as { __data__?: SitemapDatum }).__data__?._core
        : undefined;
      setSelected(
        core ? buildInspectorTarget(core, portOverridesRef.current) : null,
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };

    container.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const rectum = useMemo(() => {
    // インスペクタは右クリックで開くので、node.click コールバックは渡さない。
    const instance = new Rectum({ callbacks: {} });
    instance.data({
      // 保存値は「親の左上」起点のまま重ね、d3.sitemap へ渡す直前に描画用へ整える
      // (親の余白の分を引く・ノード名とパスのリンク化。renderNodes.ts)。
      nodes: toRenderNodes(applyLayoutOverrides(SITEMAP_DATA.nodes, overrides)),
      edges: applyPortOverrides(SITEMAP_DATA.edges, portOverrides),
    });
    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, portOverrides, version]);

  const inspectorTabs = useMemo(
    () => (selected ? buildInspectorTabs(selected.id) : []),
    [selected],
  );

  const handleApply = (values: Record<string, string>) => {
    if (!selected) return;

    // Colonoscope のタブモードは表示中のタブの値だけを通知するので、
    // 基本タブの値が来たときだけノードの位置・サイズを書き換える
    // (結線タブの「適用」で、ノードに不要なオーバーライドを書かないため)。
    let nextNodes = overridesRef.current;
    if (hasBasicValues(values)) {
      nextNodes = {
        ...nextNodes,
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
    }
    const nextPorts: PortOverrides = {
      ...portOverridesRef.current,
      ...readChangedPorts(values, selected),
    };

    overridesRef.current = nextNodes;
    portOverridesRef.current = nextPorts;
    setOverrides(nextNodes);
    setPortOverrides(nextPorts);
    // ノードの手調整・角度・視点は同じ sitemap.json に入るので、1回の保存でまとめて書く。
    save(buildLayoutFile(nextNodes, nextPorts, cameraRef.current));
    setSelected(null);
    // rectum を作り直しただけでは再描画されないため、D3Sitemap を貼り替える。
    setVersion((v) => v + 1);
  };

  return (
    // 全体はパン/ズームで見る(TM と同じ)。以前は全ノードが収まる大きさを
    // コンテナに与えてブラウザのスクロールでも見られるようにしていたが、
    // d3.svg のズームと二重になり、視点(スクロール量 + パン)が一意に
    // 決まらないためやめた。
    <div ref={containerRef} className="relative flex min-h-0 w-full flex-1">
      <D3Sitemap key={version} rectum={rectum} />

      {/* 見出しの右に余白をとり、長い名前が詳細ページへのリンク(下)に潜らないようにする。
          Tailwind は [] の中の _ を空白として読むため、クラス名の __ は \_ で逃がす
          (逃がさないと `.colonoscope title` という別のセレクタになる)。JSX の属性の
          文字列ではバックスラッシュが特別な意味を持たないので、そのまま書ける。 */}
      <Colonoscope
        target={selected}
        title={(t: SitemapInspectorTarget) => t.label?.contents}
        tabs={inspectorTabs}
        onApply={handleApply}
        onClose={() => setSelected(null)}
        className="[&_.colonoscope\_\_title]:pr-10"
      />

      {/* サイトの詳細ページへのリンク。Colonoscope 0.4.0 の見出しには要素を置く口が
          無い(title / subtitle は文字列のみ)ため、同じコンテナの右上に重ねる。
          パネルは top:0 / right:0 に貼り付くので、右端からの距離で ✕ の左隣に
          揃えられる(パネルの幅をドラッグで変えてもずれない)。top・right・行の
          高さは Colonoscope の見出しの余白(上 14px・右 16px)と ✕(幅 約 21px・
          高さ 28px。実測)に合わせた値。見出しに差し込み口ができたらそちらへ移す。 */}
      {selected && (
        <Box
          className="absolute z-10"
          sx={{
            ...textStyle("UI-14M-100"),
            top: "14px",
            right: "48px",
            lineHeight: "28px",
          }}
        >
          <SiteLink
            href={siteHref(selected.id)}
            ariaLabel={`${selected.label.contents} の詳細ページを開く`}
          >
            詳細
          </SiteLink>
        </Box>
      )}

      <LayoutSaveStatusSnackbar state={saveState} onClose={closeSaveStatus} />
    </div>
  );
}
