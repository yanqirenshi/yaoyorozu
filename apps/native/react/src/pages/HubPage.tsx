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

// 伝統色パレット(App.css の :root/tokens.css と同じ値。issue #84・#93)。
const COLOR_PEARL = "#fbfbf8"; // 真珠
const COLOR_KYO_MURASAKI = "#9d5b8b"; // 京紫(profile/session)
const COLOR_KINCHA = "#ce7a19"; // 金茶(作業ディレクトリ。issue #104)
const COLOR_KUSAIRO = "#7b8d41"; // 草色(ブランチ。issue #104)
const COLOR_SUMI = "#373737"; // 墨
const COLOR_BORDER = "#a1a1aa";
const COLOR_MUTED = "#737373";

// PC → profile → 作業ディレクトリ → ブランチ → セッション(issue #104)。
const COL_X = { pc: 70, profile: 260, cwd: 460, branch: 660, session: 880 };
const ROW_HEIGHT = 76;
const ROW_START_Y = 70;

// 作業ディレクトリ・ブランチが未記録(古いセッション等)のときのグループ
// キー/ラベル。実際のパス・ブランチ名と衝突しない固定文字列にする
// (issue #104)。
const UNKNOWN_CWD = "(不明)";
const UNKNOWN_BRANCH = "(不明)";
const DETACHED_BRANCH_LABEL = "(detached)";

// 作業ディレクトリのフルパスは長いため、末尾のフォルダ名だけを表示する
// (issue #104)。`\` 区切り(Windows)・`/` 区切りのどちらにも対応する。
function cwdTail(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 || idx === normalized.length - 1
    ? normalized
    : normalized.slice(idx + 1);
}

// `gitBranch` の表示用ラベル。`"HEAD"` はデタッチ状態、未記録は不明として
// 扱う(issue #104)。
function branchLabel(gitBranch: string | null): string {
  if (gitBranch === null) return UNKNOWN_BRANCH;
  return gitBranch === "HEAD" ? DETACHED_BRANCH_LABEL : gitBranch;
}

// プロファイル1件あたりに表示するセッションノードの上限(issue #100)。
// 対象フォルダによってはセッションが数十件あり、全表示するとグラフが
// 破綻するため。超過分は集約ノード1個(「+n件」)にまとめる。
const MAX_SESSIONS_PER_PROFILE = 10;

// クリック時にどう振る舞うかを判定するための、ノードの元データ(`_core`)。
// PC → profile → 作業ディレクトリ → ブランチ → session の階層(issue #84・
// #104。Windowノードは廃止し、開いているプロファイルは直接PCの下に並べる)。
// `windowLabel` があればそのウィンドウを前面化、無ければ `profileId` の
// ウィンドウを新規に開く(profile・cwd・branch・session・session-more の
// どのノードも同じ判定でよい。issue #100・#104)。
type HubNodeCore = {
  kind: "pc" | "profile" | "cwd" | "branch" | "session" | "profile-unopened" | "session-more";
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
// PC → profile → 作業ディレクトリ → ブランチ → session の階層グラフ
// (d3.network 用ノード・エッジ)を組み立てる。座標は左→右の5列固定レイアウト
// を初期位置として自前計算する(issue #84・#104。d3.network はノードに
// x/y が必須)。「このPC」ノードは `move: "freeze"` で固定、profile・作業
// ディレクトリ・ブランチのノードは `move: "support"` で初期位置に留めつつ
// ユーザーがドラッグで動かせるようにし、sessionノードは `move: "will"` で
// forceシミュレーションに委ねる。
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

  // 同じキーを持つセッションをグループにまとめる(出現順=新しい順を保つ)。
  // 作業ディレクトリ・ブランチのグループ化(issue #104)に使う汎用ヘルパー。
  function groupBy<T>(items: T[], keyOf: (item: T) => string): { key: string; items: T[] }[] {
    const groups: { key: string; items: T[] }[] = [];
    for (const item of items) {
      const key = keyOf(item);
      let group = groups.find((g) => g.key === key);
      if (!group) {
        group = { key, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }

  // 指定プロファイルのセッション枝を `profileNodeId` の下に生やす。セッションは
  // 最大 `MAX_SESSIONS_PER_PROFILE` 件(新しい順)まで、作業ディレクトリ→
  // ブランチの2段でグループ化して表示し、超過分は集約ノード1個にまとめる
  // (issue #104。上限・集約はプロファイル単位のまま。issue #100)。ウィンドウが
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

    let row = startRow;

    const cwdGroups = groupBy(visible, (s) => s.cwd ?? UNKNOWN_CWD);
    for (const cwdGroup of cwdGroups) {
      const cwdNodeId = `cwd:${profileId}:${cwdGroup.key}`;
      const cwdRowStart = row;

      const branchGroups = groupBy(cwdGroup.items, (s) => branchLabel(s.git_branch));
      for (const branchGroup of branchGroups) {
        const branchNodeId = `branch:${profileId}:${cwdGroup.key}:${branchGroup.key}`;
        const branchRowStart = row;

        branchGroup.items.forEach((session, si) => {
          const sessionNodeId = `session:${profileId}:${session.id}`;
          const isSelected = session.id === selectedSessionId;
          nodes.push({
            id: sessionNodeId,
            x: COL_X.session,
            y: ROW_START_Y + (branchRowStart + si) * ROW_HEIGHT,
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
            source: branchNodeId,
            target: sessionNodeId,
            line: { width: 2, color: COLOR_BORDER },
          });
        });
        row += branchGroup.items.length;

        nodes.push({
          id: branchNodeId,
          x: COL_X.branch,
          y: ROW_START_Y + branchRowStart * ROW_HEIGHT,
          move: "support",
          label: { text: branchGroup.key, fill: COLOR_SUMI, font: { size: 12 } },
          circle: { r: 20, fill: COLOR_PEARL, stroke: { color: COLOR_KUSAIRO, width: 2 } },
          kind: "branch",
          windowLabel,
          profileId,
        });
        edges.push({
          id: `e${edgeSeq++}`,
          source: cwdNodeId,
          target: branchNodeId,
          line: { width: 2, color: COLOR_BORDER },
        });
      }

      nodes.push({
        id: cwdNodeId,
        x: COL_X.cwd,
        y: ROW_START_Y + cwdRowStart * ROW_HEIGHT,
        move: "support",
        label: { text: cwdTail(cwdGroup.key), fill: COLOR_SUMI, font: { size: 12 } },
        circle: { r: 22, fill: COLOR_PEARL, stroke: { color: COLOR_KINCHA, width: 2 } },
        kind: "cwd",
        windowLabel,
        profileId,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: profileNodeId,
        target: cwdNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });
    }

    if (overflow > 0) {
      const moreNodeId = `session-more:${profileId}`;
      nodes.push({
        id: moreNodeId,
        x: COL_X.session,
        y: ROW_START_Y + row * ROW_HEIGHT,
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
      row += 1;
    }

    return Math.max(row - startRow, 1);
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
// から PC → profile の階層を描く。profile → 作業ディレクトリ → ブランチ →
// session の枝はウィンドウの有無と無関係に、プロファイルごとの
// `selected_project_folders` を `list_sessions` で直接読んで描く(issue #100・
// #104。コールドスタート(ウィンドウ0)でも全プロファイルのセッションが
// 最初から見える)。windows:changed / settings:updated / session:changed で
// 再描画する。ノードのクリックで該当ウィンドウを前面化(focus_window)、
// 無ければ新規ウィンドウを起動する(open_profile_window。issue #76)。
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
