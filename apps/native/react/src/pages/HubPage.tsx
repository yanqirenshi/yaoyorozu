import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import D3Network, { Rectum } from "@yanqirenshi/d3.network";
import type { NodeDatum } from "@yanqirenshi/d3.network";
import {
  focusWindow,
  getSettings,
  isAppError,
  listSessions,
  listWindowStates,
  onSessionChanged,
  onSettingsUpdated,
  onWindowsChanged,
  openProfileWindow,
} from "../api";
import type { ProfileSummaryDto, SessionSummaryDto, WindowStateDto } from "../api";
import { usePageDockItems } from "../DockItemsContext";
import { RELOAD_ICON } from "../icons";

// 伝統色パレット(App.css の :root と同じ値。issue #84)。
const COLOR_PEARL = "#fbfbf8"; // 真珠
const COLOR_KYO_MURASAKI = "#9d5b8b"; // 京紫
const COLOR_SUMI = "#373737"; // 墨
const COLOR_BORDER = "#a1a1aa";
const COLOR_MUTED = "#737373";

const COL_X = { pc: 90, profile: 400, session: 700 };
const ROW_HEIGHT = 76;
const ROW_START_Y = 70;

// プロファイル1件あたりに表示するセッションノードの上限(issue #100)。
// 対象フォルダによってはセッションが数十件あり、全表示するとグラフが
// 破綻するため。超過分は集約ノード1個(「+n件」)にまとめる。
const MAX_SESSIONS_PER_PROFILE = 10;

// クリック時にどう振る舞うかを判定するための、ノードの元データ(`_core`)。
// PC → profile → session の階層(issue #84。Windowノードは廃止し、開いている
// プロファイルは直接PCの下に並べる)。`windowLabel` があればそのウィンドウを
// 前面化、無ければ `profileId` のウィンドウを新規に開く(issue #100で
// session-more アグリゲートノードにも同じ判定を適用できるよう統一した)。
type HubNodeCore = {
  kind: "pc" | "profile" | "session" | "profile-unopened" | "session-more";
  windowLabel?: string;
  profileId?: string;
};

// セッションの取得元フォルダを保持する(issue #100。未オープンのプロファイル
// のセッションノードをクリックした際、将来的に対象フォルダ付きで
// ビューアを開けるようにする余地を残すため)。
type ProfileSession = SessionSummaryDto & { folder: string };

// プロファイルごとの全セッション一覧(新しい順)。ウィンドウの開閉に関係なく
// ディスク上の実体(`selected_project_folders` の各フォルダ)から取得する
// (issue #100)。
type SessionsByProfile = Record<string, ProfileSession[]>;

// `session:changed` で再取得すべきプロファイルを判定するための、
// プロファイルごとの対象フォルダ一覧。
type ProfileFolders = Record<string, string[]>;

// このマシン上で開いているウィンドウ・全プロファイル・そのセッション一覧から
// PC → profile → session の階層グラフ(d3.network 用ノード・エッジ)を
// 組み立てる。座標は左→右の3列固定レイアウトを初期位置として自前計算する
// (issue #84。d3.network はノードに x/y が必須)。「このPC」ノードは
// `move: "freeze"` で固定、profileノードは `move: "support"` で初期位置に
// 留めつつユーザーがドラッグで動かせるようにし、sessionノードは
// `move: "will"` でforceシミュレーションに委ねる。
function buildGraphData(
  windowStates: WindowStateDto[],
  profiles: ProfileSummaryDto[],
  sessionsByProfile: SessionsByProfile,
) {
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

  // 指定プロファイルのセッション枝(session ノード最大 `MAX_SESSIONS_PER_PROFILE`
  // 件 + 超過分の集約ノード)を `profileNodeId` の下に生やす。ウィンドウが
  // 開いているプロファイル(`windowLabel` あり)・未オープンのプロファイル
  // (`windowLabel` 無し)の両方から呼ぶ(issue #100でセッションの取得元を
  // ウィンドウレジストリからディスク上の実体に変えたため、両者の枝の作り方を
  // 共通化できる)。消費した行数を返す(呼び出し側の `row` 更新用)。
  function addSessionBranch(
    profileNodeId: string,
    profileId: string,
    windowLabel: string | undefined,
    selectedSessionId: string | undefined,
    startRow: number,
  ): number {
    const sessions = sessionsByProfile[profileId] ?? [];
    const visible = sessions.slice(0, MAX_SESSIONS_PER_PROFILE);
    const overflow = sessions.length - visible.length;

    visible.forEach((session, si) => {
      const sessionNodeId = `session:${profileId}:${session.id}`;
      const isSelected = session.id === selectedSessionId;
      nodes.push({
        id: sessionNodeId,
        x: COL_X.session,
        y: ROW_START_Y + (startRow + si) * ROW_HEIGHT,
        move: "will",
        label: {
          text: session.title.slice(0, 24),
          fill: isSelected ? COLOR_SUMI : COLOR_MUTED,
          font: { size: 12 },
        },
        circle: {
          r: 20,
          fill: isSelected ? COLOR_KYO_MURASAKI : COLOR_PEARL,
          stroke: { color: isSelected ? COLOR_KYO_MURASAKI : COLOR_BORDER, width: 2 },
        },
        kind: "session",
        windowLabel,
        profileId,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: profileNodeId,
        target: sessionNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });
    });

    if (overflow > 0) {
      const moreNodeId = `session-more:${profileId}`;
      nodes.push({
        id: moreNodeId,
        x: COL_X.session,
        y: ROW_START_Y + (startRow + visible.length) * ROW_HEIGHT,
        move: "will",
        label: { text: `+${overflow}件`, fill: COLOR_MUTED, font: { size: 12 } },
        circle: { r: 18, fill: COLOR_PEARL, stroke: { color: COLOR_BORDER, width: 2 } },
        kind: "session-more",
        windowLabel,
        profileId,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: profileNodeId,
        target: moreNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });
    }

    return Math.max(visible.length + (overflow > 0 ? 1 : 0), 1);
  }

  const openedProfileIds = new Set<string>();

  windowStates.forEach((w) => {
    w.tabs.forEach((tab, ti) => {
      openedProfileIds.add(tab.profile_id);
      const profileNodeId = `profile:${w.label}:${ti}`;
      const profileName = profiles.find((p) => p.id === tab.profile_id)?.name ?? tab.profile_id;
      const isActiveTab = ti === w.active_tab_index;

      const profileRow = row;
      const profileY = ROW_START_Y + profileRow * ROW_HEIGHT;
      nodes.push({
        id: profileNodeId,
        x: COL_X.profile,
        y: profileY,
        move: "support",
        label: { text: profileName, fill: COLOR_SUMI, font: { size: 13 } },
        circle: {
          r: 26,
          fill: isActiveTab ? COLOR_KYO_MURASAKI : COLOR_PEARL,
          stroke: { color: COLOR_KYO_MURASAKI, width: 2 },
        },
        kind: "profile",
        windowLabel: w.label,
        profileId: tab.profile_id,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: pcId,
        target: profileNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });

      row += addSessionBranch(profileNodeId, tab.profile_id, w.label, tab.session_id ?? undefined, profileRow);
    });
  });

  // 未オープンのプロファイル(どのウィンドウでも開いていない)は、PC直下に
  // 薄い配色で表示する(issue #84)。セッションの取得元がディスク上の実体に
  // なったため(issue #100)、ウィンドウが無くてもセッション枝を描ける。
  profiles
    .filter((p) => !openedProfileIds.has(p.id))
    .forEach((p) => {
      const nodeId = `profile-unopened:${p.id}`;
      const profileRow = row;
      nodes.push({
        id: nodeId,
        x: COL_X.profile,
        y: ROW_START_Y + profileRow * ROW_HEIGHT,
        move: "support",
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

      row += addSessionBranch(nodeId, p.id, undefined, undefined, profileRow);
    });

  return { nodes, edges };
}

// メインウィンドウの起点となる「俯瞰グラフ」画面(ハブ化 その2。issue #84)。
// list_window_states(レジストリ。issue #83)+ get_settings(全プロファイル)
// から PC → profile の階層を描く。profile → session の枝はウィンドウの
// 有無と無関係に、プロファイルごとの `selected_project_folders` を
// `list_sessions` で直接読んで描く(issue #100。コールドスタート(ウィンドウ
// 0)でも全プロファイルのセッションが最初から見える)。windows:changed /
// settings:updated / session:changed で再描画する。ノードのクリックで
// 該当ウィンドウを前面化(focus_window)、無ければ新規ウィンドウを起動する
// (open_profile_window。issue #76)。
function HubPage() {
  const [windowStates, setWindowStates] = useState<WindowStateDto[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [sessionsByProfile, setSessionsByProfile] = useState<SessionsByProfile>({});
  const [profileFolders, setProfileFolders] = useState<ProfileFolders>({});
  const [error, setError] = useState<string | null>(null);

  // `session:changed` ハンドラは購読を1回だけにしたい(プロファイル一覧が
  // 変わるたびに listen/unlisten し直すと無駄なため)一方、判定には最新の
  // プロファイル→対象フォルダ対応表が要る。ref 経由で最新値を参照する。
  const profileFoldersRef = useRef<ProfileFolders>({});
  useEffect(() => {
    profileFoldersRef.current = profileFolders;
  }, [profileFolders]);

  // 指定プロファイルの対象フォルダ一覧を読み、各フォルダの `list_sessions`
  // (profile_id 明示。issue #76で導入済み)を呼んで新しい順にまとめる
  // (issue #100)。`list_sessions` はmtimeキャッシュ(issue #33)があるため、
  // 再取得のコストは低い。
  const loadSessionsForProfile = useCallback(
    (profileId: string): Promise<{ folders: string[]; sessions: ProfileSession[] }> => {
      return getSettings(profileId).then((settings) => {
        const folders = settings.selected_project_folders;
        return Promise.all(
          folders.map((folder) =>
            listSessions(folder).then((sessions) =>
              sessions.map((s): ProfileSession => ({ ...s, folder })),
            ),
          ),
        ).then((byFolder) => ({
          folders,
          sessions: byFolder.flat().sort((a, b) => b.modified_at - a.modified_at),
        }));
      });
    },
    [],
  );

  const loadAllProfileSessions = useCallback(
    (profileList: ProfileSummaryDto[]): Promise<void> => {
      return Promise.all(
        profileList.map((p) => loadSessionsForProfile(p.id).then((r) => [p.id, r] as const)),
      ).then((entries) => {
        setSessionsByProfile(Object.fromEntries(entries.map(([id, r]) => [id, r.sessions])));
        setProfileFolders(Object.fromEntries(entries.map(([id, r]) => [id, r.folders])));
      });
    },
    [loadSessionsForProfile],
  );

  const load = useCallback((): Promise<void> => {
    return Promise.all([listWindowStates(), getSettings()])
      .then(([states, settings]) => {
        setWindowStates(states);
        setProfiles(settings.profiles);
        setError(null);
        return loadAllProfileSessions(settings.profiles);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [loadAllProfileSessions]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unlistenPromises = [onWindowsChanged(load), onSettingsUpdated(load)];
    return () => {
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [load]);

  // 該当プロファイルのセッション枝だけを再取得する(全体の再読み込みより
  // 軽い。issue #100)。
  useEffect(() => {
    const unlistenPromise = onSessionChanged(({ project }) => {
      const affectedProfileIds = Object.entries(profileFoldersRef.current)
        .filter(([, folders]) => folders.includes(project))
        .map(([id]) => id);
      if (affectedProfileIds.length === 0) return;
      Promise.all(
        affectedProfileIds.map((id) => loadSessionsForProfile(id).then((r) => [id, r] as const)),
      )
        .then((entries) => {
          setSessionsByProfile((prev) => ({
            ...prev,
            ...Object.fromEntries(entries.map(([id, r]) => [id, r.sessions])),
          }));
          setProfileFolders((prev) => ({
            ...prev,
            ...Object.fromEntries(entries.map(([id, r]) => [id, r.folders])),
          }));
        })
        .catch((e) => console.error(e));
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadSessionsForProfile]);

  // `windowLabel` があればそのウィンドウを前面化、無ければ `profileId` の
  // ウィンドウを新規に開く。session-more(集約)ノードも同じ判定でよい
  // (開いていれば前面化、未オープンなら新規起動。issue #100)。
  const handleNodeClick = useCallback((d: NodeDatum) => {
    const core = d._core as HubNodeCore;
    if (core.windowLabel) {
      focusWindow(core.windowLabel).catch((e) => console.error(e));
      return;
    }
    if (core.profileId) {
      openProfileWindow(core.profileId).catch((e) => console.error(e));
    }
  }, []);

  // Rectum(命令的API)は useMemo で生成する(apps/web の d3系タブと同じ
  // 流儀)。データが変わるたびに作り直す — d3.network はドラッグ以外の座標
  // 変更を追跡する仕組みを持たないため、再生成して確実に最新のグラフを
  // 描き直す(再生成のたびに、`move: "support"` のprofileノードは初期位置へ
  // 戻り、`move: "will"` のsessionノードはforceシミュレーションで再配置
  // されるため、ユーザーがドラッグした位置はリセットされる)。
  //
  // NOTE: 現状 @yanqirenshi/d3.network 側の既知の問題により、ノードの
  // `<g>` に無条件で付く d3.drag() がネイティブの click イベントを
  // 抑制してしまい、この node.click コールバックが呼ばれない
  // (issue #84 のPRコメント参照)。ライブラリ本体の修正・バージョンアップ
  // 待ち。ここは修正後にそのまま動くよう、素直な形にしてある。
  const dataKey = JSON.stringify({ windowStates, profiles, sessionsByProfile });
  const rectum = useMemo(() => {
    const instance = new Rectum({
      callbacks: { node: { click: handleNodeClick } },
    });
    instance.data(buildGraphData(windowStates, profiles, sessionsByProfile));
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
      {/* `D3Network`(Asshole)は初回マウント時にしか `rectum.selector()` を
          呼ばないため、`rectum` を作り直した(=データが変わった)ときは
          `key` も変えて強制的に作り直す(apps/web の d3系タブと同じ流儀。
          そうしないと新しいデータが描画に反映されない)。 */}
      <D3Network key={dataKey} rectum={rectum} />
    </div>
  );
}

export default HubPage;
