import { useCallback, useEffect, useMemo, useState } from "react";
import D3Network, { Rectum } from "@yanqirenshi/d3.network";
import type { NodeDatum } from "@yanqirenshi/d3.network";
import {
  focusWindow,
  getSettings,
  isAppError,
  listWindowStates,
  onSettingsUpdated,
  onWindowsChanged,
  openProfileWindow,
} from "../api";
import type { ProfileSummaryDto, WindowStateDto } from "../api";
import { usePageDockItems } from "../DockItemsContext";
import { RELOAD_ICON } from "../icons";

// 伝統色パレット(App.css の :root と同じ値。issue #84)。
const COLOR_PEARL = "#fbfbf8"; // 真珠
const COLOR_KYO_MURASAKI = "#9d5b8b"; // 京紫
const COLOR_SUMI = "#373737"; // 墨
const COLOR_BORDER = "#a1a1aa";
const COLOR_MUTED = "#737373";

const COL_X = { pc: 90, window: 320, profile: 560, session: 800 };
const ROW_HEIGHT = 76;
const ROW_START_Y = 70;

// クリック時にどう振る舞うかを判定するための、ノードの元データ(`_core`)。
// PC → Window → profile → session の階層(issue #84)。
type HubNodeCore = {
  kind: "pc" | "window" | "profile" | "session" | "profile-unopened";
  windowLabel?: string;
  profileId?: string;
};

function windowNode(label: string, index: number, y: number) {
  return {
    id: `window:${label}`,
    x: COL_X.window,
    y,
    move: "freeze",
    label: { text: `ウィンドウ ${index + 1}`, fill: COLOR_SUMI, font: { size: 14 } },
    circle: { r: 30, fill: COLOR_PEARL, stroke: { color: COLOR_KYO_MURASAKI, width: 3 } },
    kind: "window",
    windowLabel: label,
  } satisfies { id: string; x: number; y: number } & HubNodeCore & Record<string, unknown>;
}

// このマシン上で開いているウィンドウ・プロファイル・セッションの状態から、
// PC → Window → profile → session の階層グラフ(d3.network 用ノード・エッジ)
// を組み立てる。座標は左→右の4列固定レイアウトで自前計算する(issue #84。
// d3.network はノードに x/y が必須で、`move: "freeze"` を指定することで
// forceシミュレーションによる位置ずれを止め、この座標に固定表示する)。
function buildGraphData(windowStates: WindowStateDto[], profiles: ProfileSummaryDto[]) {
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  let edgeSeq = 0;
  let row = 0;

  const pcId = "pc";
  nodes.push({
    id: pcId,
    x: COL_X.pc,
    y: ROW_START_Y,
    move: "freeze",
    label: { text: "このPC", fill: COLOR_SUMI, font: { size: 16 } },
    circle: { r: 34, fill: COLOR_PEARL, stroke: { color: COLOR_SUMI, width: 3 } },
    kind: "pc",
  });

  const openedProfileIds = new Set<string>();

  windowStates.forEach((w, wi) => {
    const windowStartRow = row;
    const windowId = `window:${w.label}`;

    w.tabs.forEach((tab, ti) => {
      openedProfileIds.add(tab.profile_id);
      const y = ROW_START_Y + row * ROW_HEIGHT;
      const profileNodeId = `profile:${w.label}:${ti}`;
      const profileName = profiles.find((p) => p.id === tab.profile_id)?.name ?? tab.profile_id;
      const isActive = ti === w.active_tab_index;

      nodes.push({
        id: profileNodeId,
        x: COL_X.profile,
        y,
        move: "freeze",
        label: { text: profileName, fill: COLOR_SUMI, font: { size: 13 } },
        circle: {
          r: 26,
          fill: isActive ? COLOR_KYO_MURASAKI : COLOR_PEARL,
          stroke: { color: COLOR_KYO_MURASAKI, width: 2 },
        },
        kind: "profile",
        windowLabel: w.label,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: windowId,
        target: profileNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });

      if (tab.session_id) {
        const sessionNodeId = `session:${w.label}:${ti}`;
        nodes.push({
          id: sessionNodeId,
          x: COL_X.session,
          y,
          move: "freeze",
          label: {
            text: (tab.session_title ?? tab.session_id).slice(0, 24),
            fill: COLOR_MUTED,
            font: { size: 12 },
          },
          circle: { r: 20, fill: COLOR_PEARL, stroke: { color: COLOR_BORDER, width: 2 } },
          kind: "session",
          windowLabel: w.label,
        });
        edges.push({
          id: `e${edgeSeq++}`,
          source: profileNodeId,
          target: sessionNodeId,
          line: { width: 2, color: COLOR_BORDER },
        });
      }

      row += 1;
    });

    // タブが1つも無いウィンドウ(理論上は起きないが安全側)でも1行は使う。
    const windowRowCount = Math.max(row - windowStartRow, 1);
    const windowY = ROW_START_Y + (windowStartRow + (windowRowCount - 1) / 2) * ROW_HEIGHT;
    nodes.push(windowNode(w.label, wi, windowY));
    edges.push({
      id: `e${edgeSeq++}`,
      source: pcId,
      target: windowId,
      line: { width: 2, color: COLOR_BORDER },
    });
    row = windowStartRow + windowRowCount;
  });

  // 未オープンのプロファイル(どのウィンドウでも開いていない)は、PC直下に
  // 薄い配色で表示する(issue #84)。
  profiles
    .filter((p) => !openedProfileIds.has(p.id))
    .forEach((p) => {
      const nodeId = `profile-unopened:${p.id}`;
      nodes.push({
        id: nodeId,
        x: COL_X.profile,
        y: ROW_START_Y + row * ROW_HEIGHT,
        move: "freeze",
        label: { text: p.name, fill: COLOR_MUTED, font: { size: 13 } },
        circle: { r: 22, fill: COLOR_PEARL, stroke: { color: COLOR_BORDER, width: 2 } },
        kind: "profile-unopened",
        profileId: p.id,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: pcId,
        target: nodeId,
        line: { width: 1, color: COLOR_BORDER },
      });
      row += 1;
    });

  return { nodes, edges };
}

// メインウィンドウの起点となる「俯瞰グラフ」画面(ハブ化 その2。issue #84)。
// list_window_states(レジストリ。issue #83)+ get_settings(全プロファイル)
// から PC → Window → profile → session の階層を描き、windows:changed /
// settings:updated で再描画する。ノードのクリックで該当ウィンドウを前面化
// (focus_window)、未オープンのプロファイルは新規ウィンドウを起動する
// (open_profile_window。issue #76)。
function HubPage() {
  const [windowStates, setWindowStates] = useState<WindowStateDto[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): Promise<void> => {
    return Promise.all([listWindowStates(), getSettings()])
      .then(([states, settings]) => {
        setWindowStates(states);
        setProfiles(settings.profiles);
        setError(null);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unlistenPromises = [onWindowsChanged(load), onSettingsUpdated(load)];
    return () => {
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [load]);

  const handleNodeClick = useCallback((d: NodeDatum) => {
    const core = d._core as HubNodeCore;
    if (core.kind === "profile-unopened") {
      if (core.profileId) openProfileWindow(core.profileId).catch((e) => console.error(e));
      return;
    }
    if (core.windowLabel) {
      focusWindow(core.windowLabel).catch((e) => console.error(e));
    }
  }, []);

  // Rectum(命令的API)は useMemo で生成する(apps/web の d3系タブと同じ
  // 流儀)。データが変わるたびに作り直す — d3.network はドラッグ以外の座標
  // 変更を追跡する仕組みを持たないため、再生成して確実に最新のグラフを
  // 描き直す(全ノードを `move: "freeze"` で固定しているのでシミュレーション
  // の再スタート自体に見た目上の影響は無い)。
  const dataKey = JSON.stringify({ windowStates, profiles });
  const rectum = useMemo(() => {
    const instance = new Rectum({
      callbacks: { node: { click: handleNodeClick } },
    });
    instance.data(buildGraphData(windowStates, profiles));
    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, handleNodeClick]);

  const dockItems = useMemo(
    () => [
      {
        id: "hub-reload",
        label: RELOAD_ICON,
        title: "再読み込み",
        onClick: load,
      },
    ],
    [load],
  );
  usePageDockItems(dockItems);

  return (
    <div className="hub-page">
      {error && <p className="error">{error}</p>}
      <D3Network rectum={rectum} />
    </div>
  );
}

export default HubPage;
