import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import D3Network, { Rectum } from "@yanqirenshi/d3.network";
import type { NodeDatum } from "@yanqirenshi/d3.network";
import {
  focusWindow,
  getHubLayout,
  getSettings,
  isAppError,
  listSessions,
  listWindowStates,
  onSessionChanged,
  onSettingsUpdated,
  onWindowsChanged,
  openProfileWindow,
  saveHubLayout,
} from "../api";
import type {
  GithubProjectDto,
  NodePositionDto,
  ProfileSummaryDto,
  SessionSummaryDto,
  WindowStateDto,
} from "../api";
import { usePageDockItems } from "../DockItemsContext";
import { LAYOUT_RESET_ICON, RELOAD_ICON } from "../icons";
import { HUB_NODE_ICON_URIS } from "../hubNodeIcons";
import HubInspector from "../HubInspector";
import type { InspectorContent, InspectorField } from "../HubInspector";

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

// ノード種別アイコン(issue #119)導入にあたり、ラベル文字を円の下に逃がす
// (アイコンは円の中央にデフォルト位置で描くため、ラベルが重なる)。
// `d3.network` の label.y はテキストの上端基準で、実際の描画は
// `y = label.y + label.font.size`(ベースライン相当)になる(Nodes.js
// `drawCircleLabel` 参照)。
const LABEL_GAP_BELOW_CIRCLE = 6;
function labelYBelowCircle(circleR: number): number {
  return circleR + LABEL_GAP_BELOW_CIRCLE;
}

// インスペクタ(issue #109)の幅。マウスドラッグで変更できる。
const INSPECTOR_INITIAL_WIDTH = 444;
const INSPECTOR_MIN_WIDTH = 222;
const INSPECTOR_MAX_WIDTH = 888;

// ノード位置(ドラッグ固定)の保存(issue #121)のデバウンス間隔。ドラッグ中の
// 連続した dragEnded 呼び出し(同一ドラッグでは1回だが、短時間に複数ノードを
// 続けて動かした場合)をまとめて1回の保存にする。
const HUB_LAYOUT_SAVE_DEBOUNCE_MS = 500;

// クリック・右クリック時にどう振る舞うか/何を表示するかを判定するための、
// ノードの元データ(`_core`)。PC → profile → 作業ディレクトリ → ブランチ →
// session の階層(issue #84・#104。Windowノードは廃止し、開いている
// プロファイルは直接PCの下に並べる)。`windowLabel` があればそのウィンドウを
// 前面化、無ければ `profileId` のウィンドウを新規に開く(profile・cwd・
// branch・session のどのノードも同じ判定でよい。issue #100・#104)。
// それ以外のフィールドはインスペクタ(issue #109)の表示専用で、ノード種別に
// よってどれが埋まっているかが変わる。
type HubNodeCore = {
  kind: "pc" | "profile" | "cwd" | "branch" | "session" | "profile-unopened";
  windowLabel?: string;
  profileId?: string;
  // ドラッグ位置の永続化(issue #121)に使う安定キー。`id` はウィンドウ起動の
  // たびに変わるラベルを含む場合がある(profile系)ため別に持つ。`move:
  // "support"` のノード(profile・cwd・branch)にのみ設定する。
  positionKey?: string;
  // pc
  effectiveProjectsDir?: string;
  // profile / profile-unopened
  profileName?: string;
  repositoryPath?: string | null;
  githubProject?: GithubProjectDto | null;
  folders?: string[];
  selectedSessionTitle?: string | null;
  // cwd
  cwdPath?: string;
  folder?: string;
  // branch
  branchName?: string;
  sessionCount?: number;
  // session
  sessionId?: string;
  sessionTitle?: string;
  modifiedAt?: number;
  gitBranchRaw?: string | null;
};

// プロファイルの詳細(インスペクタ表示用。issue #109)。セッション一覧の
// 取得(`loadSessionsForProfile`)のついでに `getSettings` から得られる。
type ProfileDetail = {
  repositoryPath: string | null;
  githubProject: GithubProjectDto | null;
  folders: string[];
};
type ProfileDetails = Record<string, ProfileDetail>;

// セッションの取得元フォルダを保持する(issue #100。未オープンのプロファイル
// のセッションノードをクリックした際、将来的に対象フォルダ付きで
// ビューアを開けるようにする余地を残すため)。
type ProfileSession = SessionSummaryDto & { folder: string };

// プロファイルごとの全セッション一覧(新しい順)。ウィンドウの開閉に関係なく
// ディスク上の実体(`selected_project_folders` の各フォルダ)から取得する
// (issue #100)。
type SessionsByProfile = Record<string, ProfileSession[]>;

// 保存済み位置(issue #121)があればそれを使い、無ければ自前計算した初期
// レイアウト位置(fallback)を使う。`move: "support"` のノード(profile・
// 作業ディレクトリ・ブランチ)はD3の `.data()` 差分更新で `id` が一致する
// 既存ノードでも新しいデータオブジェクトの x/y でまるごと置き換わる仕様
// (`Nodes.js` の `drawGroup`)のため、ドラッグ位置は呼び出し側(このヘルパー)
// で明示的に引き継がないと再描画のたびに消える。
//
// NOTE(issue #121からの逸脱): issueの設計では保存位置のあるノードを
// `move: "freeze"` にする案だったが、`Simulation.js` の
// `makeDragAndDropCallbacks` を確認したところ `freeze` は
// dragStarted/dragged/dragEnded の全てを即 return させ、ドラッグ自体を
// 受け付けない(fx/fyの固定うんぬん以前にイベントが握れない)。これでは
// issue自身が要求する「保存済みノードを再度ドラッグした場合も再固定+保存」
// が満たせないため、既存の `move: "support"`(ドラッグ可能かつ
// dragEnded後もfx/fyを保持=事実上の固定)をそのまま使う。挙動としては
// 「保存位置があれば固定、無ければ自動配置、いつでも再ドラッグ可」という
// issueの意図を満たす。
function resolvePosition(
  positionKey: string,
  fallbackX: number,
  fallbackY: number,
  savedPositions: Record<string, NodePositionDto>,
): { x: number; y: number } {
  const saved = savedPositions[positionKey];
  return saved ? { x: saved.x, y: saved.y } : { x: fallbackX, y: fallbackY };
}

// このマシン上で開いているウィンドウ・全プロファイル・そのセッション一覧から
// PC → profile → 作業ディレクトリ → ブランチ → session の階層グラフ
// (d3.network 用ノード・エッジ)を組み立てる。座標は左→右の5列固定レイアウト
// を初期位置として自前計算する(issue #84・#104。d3.network はノードに
// x/y が必須)。「このPC」ノードは `move: "freeze"` で固定、profile・作業
// ディレクトリ・ブランチのノードは `move: "support"` で初期位置に留めつつ
// ユーザーがドラッグで動かせるようにし、sessionノードは `move: "will"` で
// forceシミュレーションに委ねる。`move: "support"` のノードはユーザーが
// ドラッグ固定した位置を `hub-layout.json` に永続化する(issue #121。
// sessionノードは force シミュレーションに委ねる性質上、対象外)。
function buildGraphData(
  windowStates: WindowStateDto[],
  profiles: ProfileSummaryDto[],
  sessionsByProfile: SessionsByProfile,
  profileDetails: ProfileDetails,
  effectiveProjectsDir: string,
  savedPositions: Record<string, NodePositionDto>,
) {
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  // 現在のグラフに実在する positionKey の集合(issue #121)。保存時、既に
  // 存在しないノードの位置情報をここで自然に除外する(呼び出し側が保存前に
  // この集合でフィルタする)。
  const positionKeys = new Set<string>();
  let edgeSeq = 0;
  let row = 0;

  const pcId = "pc";
  nodes.push({
    id: pcId,
    x: COL_X.pc,
    y: ROW_START_Y,
    move: "freeze",
    label: { text: "このPC", fill: COLOR_SUMI, font: { size: 16 }, y: labelYBelowCircle(34) },
    circle: { r: 34, fill: COLOR_PEARL, stroke: { color: COLOR_SUMI, width: 3 } },
    icon: { url: HUB_NODE_ICON_URIS.pc },
    kind: "pc",
    effectiveProjectsDir,
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

  // 指定プロファイルのセッション枝を `profileNodeId` の下に生やす。全セッション
  // (新しい順)を作業ディレクトリ→ブランチの2段でグループ化して表示する
  // (issue #104)。表示件数の上限は設けない(issue #100で導入した上限+
  // 集約ノードは、実運用でグラフより一覧性の高いビューアで確認したいという
  // 要望により撤廃した)。ウィンドウが開いているプロファイル(`windowLabel`
  // あり)・未オープンのプロファイル(`windowLabel` 無し)の両方から呼ぶ
  // (issue #100でセッションの取得元をウィンドウレジストリからディスク上の
  // 実体に変えたため、両者の枝の作り方を共通化できる)。消費した行数を返す
  // (呼び出し側の `row` 更新用)。
  function addSessionBranch(
    profileNodeId: string,
    profileId: string,
    windowLabel: string | undefined,
    selectedSessionId: string | undefined,
    startRow: number,
  ): number {
    const sessions = sessionsByProfile[profileId] ?? [];

    let row = startRow;

    const cwdGroups = groupBy(sessions, (s) => s.cwd ?? UNKNOWN_CWD);
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
              y: labelYBelowCircle(20),
            },
            circle: {
              r: 20,
              fill: isSelected ? COLOR_KYO_MURASAKI : COLOR_PEARL,
              stroke: { color: isSelected ? COLOR_KYO_MURASAKI : COLOR_BORDER, width: 2 },
            },
            icon: { url: HUB_NODE_ICON_URIS.session },
            kind: "session",
            windowLabel,
            profileId,
            sessionId: session.id,
            sessionTitle: session.title,
            modifiedAt: session.modified_at,
            cwdPath: session.cwd ?? undefined,
            gitBranchRaw: session.git_branch,
          });
          edges.push({
            id: `e${edgeSeq++}`,
            source: branchNodeId,
            target: sessionNodeId,
            line: { width: 2, color: COLOR_BORDER },
          });
        });
        row += branchGroup.items.length;

        const branchPositionKey = branchNodeId;
        positionKeys.add(branchPositionKey);
        const branchPosition = resolvePosition(
          branchPositionKey,
          COL_X.branch,
          ROW_START_Y + branchRowStart * ROW_HEIGHT,
          savedPositions,
        );
        nodes.push({
          id: branchNodeId,
          x: branchPosition.x,
          y: branchPosition.y,
          move: "support",
          label: { text: branchGroup.key, fill: COLOR_SUMI, font: { size: 12 }, y: labelYBelowCircle(20) },
          circle: { r: 20, fill: COLOR_PEARL, stroke: { color: COLOR_KUSAIRO, width: 2 } },
          icon: { url: HUB_NODE_ICON_URIS.branch },
          kind: "branch",
          windowLabel,
          profileId,
          positionKey: branchPositionKey,
          branchName: branchGroup.key,
          sessionCount: branchGroup.items.length,
        });
        edges.push({
          id: `e${edgeSeq++}`,
          source: cwdNodeId,
          target: branchNodeId,
          line: { width: 2, color: COLOR_BORDER },
        });
      }

      const cwdPositionKey = cwdNodeId;
      positionKeys.add(cwdPositionKey);
      const cwdPosition = resolvePosition(
        cwdPositionKey,
        COL_X.cwd,
        ROW_START_Y + cwdRowStart * ROW_HEIGHT,
        savedPositions,
      );
      nodes.push({
        id: cwdNodeId,
        x: cwdPosition.x,
        y: cwdPosition.y,
        move: "support",
        label: { text: cwdTail(cwdGroup.key), fill: COLOR_SUMI, font: { size: 12 }, y: labelYBelowCircle(22) },
        circle: { r: 22, fill: COLOR_PEARL, stroke: { color: COLOR_KINCHA, width: 2 } },
        icon: { url: HUB_NODE_ICON_URIS.cwd },
        kind: "cwd",
        windowLabel,
        profileId,
        positionKey: cwdPositionKey,
        cwdPath: cwdGroup.key,
        folder: cwdGroup.items[0]?.folder,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: profileNodeId,
        target: cwdNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });
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
      // `id`(profileNodeId)はウィンドウラベル+タブ番号を含み、ウィンドウの
      // 開閉のたびに変わり得るため、ドラッグ位置の永続化には使えない。
      // 代わりに `profileId` だけを使う安定キーを別に持つ(issue #121)。
      // 未オープン時(profile-unopened)も同じキーを使うことで、開閉に関係
      // なく同じ保存位置を引き継ぐ。
      const profilePositionKey = `profile:${tab.profile_id}`;
      positionKeys.add(profilePositionKey);
      const profilePosition = resolvePosition(
        profilePositionKey,
        COL_X.profile,
        profileY,
        savedPositions,
      );
      nodes.push({
        id: profileNodeId,
        x: profilePosition.x,
        y: profilePosition.y,
        move: "support",
        label: { text: profileName, fill: COLOR_SUMI, font: { size: 13 }, y: labelYBelowCircle(26) },
        circle: {
          r: 26,
          fill: isActiveTab ? COLOR_KYO_MURASAKI : COLOR_PEARL,
          stroke: { color: COLOR_KYO_MURASAKI, width: 2 },
        },
        icon: { url: HUB_NODE_ICON_URIS.profile },
        kind: "profile",
        windowLabel: w.label,
        profileId: tab.profile_id,
        positionKey: profilePositionKey,
        profileName,
        repositoryPath: profileDetails[tab.profile_id]?.repositoryPath ?? null,
        githubProject: profileDetails[tab.profile_id]?.githubProject ?? null,
        folders: profileDetails[tab.profile_id]?.folders ?? [],
        selectedSessionTitle: tab.session_title,
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
      const profilePositionKey = `profile:${p.id}`;
      positionKeys.add(profilePositionKey);
      const profilePosition = resolvePosition(
        profilePositionKey,
        COL_X.profile,
        ROW_START_Y + profileRow * ROW_HEIGHT,
        savedPositions,
      );
      nodes.push({
        id: nodeId,
        x: profilePosition.x,
        y: profilePosition.y,
        move: "support",
        label: { text: p.name, fill: COLOR_MUTED, font: { size: 13 }, y: labelYBelowCircle(22) },
        circle: { r: 22, fill: COLOR_PEARL, stroke: { color: COLOR_BORDER, width: 2 } },
        icon: { url: HUB_NODE_ICON_URIS.profile },
        kind: "profile-unopened",
        profileId: p.id,
        positionKey: profilePositionKey,
        profileName: p.name,
        repositoryPath: profileDetails[p.id]?.repositoryPath ?? null,
        githubProject: profileDetails[p.id]?.githubProject ?? null,
        folders: profileDetails[p.id]?.folders ?? [],
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: pcId,
        target: nodeId,
        line: { width: 1, color: COLOR_BORDER },
      });

      row += addSessionBranch(nodeId, p.id, undefined, undefined, profileRow);
    });

  return { nodes, edges, positionKeys };
}

function formatModifiedAt(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatGithubProject(project: GithubProjectDto | null | undefined): string {
  return project ? `${project.owner}#${project.number}` : "(未設定)";
}

// ノードの `_core`(issue #109)からインスペクタの表示内容を組み立てる。
// 追加のbackend呼び出しはせず、グラフ構築時に `_core` へ埋め込んだ値のみを
// 使う。
function buildInspectorContent(
  core: HubNodeCore,
  actions: {
    onFocusWindow: (windowLabel: string) => void;
    onOpenProfileWindow: (profileId: string) => void;
  },
): InspectorContent | null {
  const action = core.windowLabel
    ? { label: "前面化", onClick: () => actions.onFocusWindow(core.windowLabel!) }
    : core.profileId
      ? { label: "ウィンドウで開く", onClick: () => actions.onOpenProfileWindow(core.profileId!) }
      : null;

  switch (core.kind) {
    case "pc":
      return {
        title: "このPC",
        fields: [
          { label: "セッションルートディレクトリ", value: core.effectiveProjectsDir ?? "" },
        ],
        action: null,
      };
    case "profile":
    case "profile-unopened": {
      const fields: InspectorField[] = [
        { label: "名前", value: core.profileName ?? "" },
        { label: "対象リポジトリ", value: core.repositoryPath ?? "(未設定)" },
        { label: "GitHubプロジェクト", value: formatGithubProject(core.githubProject) },
        { label: "対象フォルダ", value: (core.folders ?? []).join(", ") || "(未設定)" },
      ];
      if (core.windowLabel) {
        fields.push({
          label: "選択中セッション",
          value: core.selectedSessionTitle ?? "(未選択)",
        });
      }
      return { title: "プロファイル", fields, action };
    }
    case "cwd":
      return {
        title: "作業ディレクトリ",
        fields: [
          { label: "フルパス", value: core.cwdPath ?? "" },
          { label: "プロジェクトフォルダ", value: core.folder ?? "" },
        ],
        action,
      };
    case "branch":
      return {
        title: "ブランチ",
        fields: [
          { label: "ブランチ名", value: core.branchName ?? "" },
          { label: "セッション数", value: String(core.sessionCount ?? 0) },
        ],
        action,
      };
    case "session":
      return {
        title: "セッション",
        fields: [
          { label: "タイトル", value: core.sessionTitle ?? "" },
          { label: "セッションID", value: core.sessionId ?? "" },
          {
            label: "最終更新",
            value: core.modifiedAt !== undefined ? formatModifiedAt(core.modifiedAt) : "",
          },
          { label: "作業ディレクトリ", value: core.cwdPath ?? UNKNOWN_CWD },
          { label: "ブランチ", value: branchLabel(core.gitBranchRaw ?? null) },
        ],
        action,
      };
    default:
      return null;
  }
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
  const [profileDetails, setProfileDetails] = useState<ProfileDetails>({});
  const [effectiveProjectsDir, setEffectiveProjectsDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  // ノードのドラッグ固定位置(issue #121)。起動時に一度だけ読み込み、以後は
  // ドラッグのたびに更新する。キーは `positionKey`(`buildGraphData` 参照)。
  const [savedPositions, setSavedPositions] = useState<Record<string, NodePositionDto>>({});

  // `session:changed` ハンドラは購読を1回だけにしたい(プロファイル一覧が
  // 変わるたびに listen/unlisten し直すと無駄なため)一方、判定には最新の
  // プロファイル→詳細(対象フォルダ含む)対応表が要る。ref 経由で最新値を
  // 参照する。
  const profileDetailsRef = useRef<ProfileDetails>({});
  useEffect(() => {
    profileDetailsRef.current = profileDetails;
  }, [profileDetails]);

  // 指定プロファイルの詳細(対象リポジトリ・GitHubプロジェクト・対象フォルダ)
  // を読み、各フォルダの `list_sessions`(profile_id 明示。issue #76で導入済み)
  // を呼んで新しい順にまとめる(issue #100)。詳細はインスペクタ表示用
  // (issue #109)。`list_sessions` はmtimeキャッシュ(issue #33)があるため、
  // 再取得のコストは低い。
  const loadSessionsForProfile = useCallback(
    (profileId: string): Promise<{ detail: ProfileDetail; sessions: ProfileSession[] }> => {
      return getSettings(profileId).then((settings) => {
        const folders = settings.selected_project_folders;
        const detail: ProfileDetail = {
          repositoryPath: settings.repository_path,
          githubProject: settings.github_project,
          folders,
        };
        return Promise.all(
          folders.map((folder) =>
            listSessions(folder).then((sessions) =>
              sessions.map((s): ProfileSession => ({ ...s, folder })),
            ),
          ),
        ).then((byFolder) => ({
          detail,
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
        setProfileDetails(Object.fromEntries(entries.map(([id, r]) => [id, r.detail])));
      });
    },
    [loadSessionsForProfile],
  );

  const load = useCallback((): Promise<void> => {
    return Promise.all([listWindowStates(), getSettings()])
      .then(([states, settings]) => {
        setWindowStates(states);
        setProfiles(settings.profiles);
        setEffectiveProjectsDir(settings.effective_projects_dir);
        setError(null);
        return loadAllProfileSessions(settings.profiles);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [loadAllProfileSessions]);

  useEffect(() => {
    load();
  }, [load]);

  // ドラッグ固定位置(issue #121)は起動時に一度だけ読み込む。プロファイル・
  // セッション一覧とは独立したファイル(`hub-layout.json`)のため、
  // `windows:changed` 等の再取得では読み直さない(このセッション内で保存
  // した内容は既に `savedPositions` state 側が最新)。
  useEffect(() => {
    getHubLayout()
      .then((layout) => setSavedPositions(layout.positions))
      .catch((e) => console.error(e));
  }, []);

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
      const affectedProfileIds = Object.entries(profileDetailsRef.current)
        .filter(([, detail]) => detail.folders.includes(project))
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
          setProfileDetails((prev) => ({
            ...prev,
            ...Object.fromEntries(entries.map(([id, r]) => [id, r.detail])),
          }));
        })
        .catch((e) => console.error(e));
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadSessionsForProfile]);

  // `windowLabel` があればそのウィンドウを前面化、無ければ `profileId` の
  // ウィンドウを新規に開く(開いていれば前面化、未オープンなら新規起動。
  // issue #100)。
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

  // `buildGraphData` が直近に払い出した positionKey の集合(issue #121)。
  // 保存時、既に存在しないノードの位置情報をここでフィルタして落とす
  // (`save_hub_layout` はマージではなく丸ごと置き換えのため、呼び出し側で
  // 現在有効な分だけに絞る必要がある)。ref にしているのは、保存タイミング
  // (ドラッグ終了時・デバウンス後)で常に最新の集合を参照したいため。
  const validPositionKeysRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const scheduleSaveHubLayout = useCallback((positions: Record<string, NodePositionDto>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const validKeys = validPositionKeysRef.current;
      const filtered = Object.fromEntries(
        Object.entries(positions).filter(([key]) => validKeys.has(key)),
      );
      saveHubLayout(filtered).catch((e) => console.error(e));
    }, HUB_LAYOUT_SAVE_DEBOUNCE_MS);
  }, []);

  // ノードのドラッグ終了時、位置を `savedPositions` に反映しつつ
  // デバウンス保存する(issue #121)。`positionKey` が無いノード(pc・
  // sessionなど永続化対象外)は何もしない。
  const handleNodeDragEnded = useCallback(
    (node: NodeDatum) => {
      const core = node._core as HubNodeCore;
      const positionKey = core.positionKey;
      if (!positionKey) return;
      setSavedPositions((prev) => {
        const next = { ...prev, [positionKey]: { x: node.x, y: node.y } };
        scheduleSaveHubLayout(next);
        return next;
      });
    },
    [scheduleSaveHubLayout],
  );

  // Rectum(命令的API)は初回に一度だけ生成し、以後は同じインスタンスを
  // 使い続ける。`@yanqirenshi/assh0le` の `Colon.data()` は、`selector()`
  // (`Asshole` がマウント時に一度だけ呼ぶ)が設定済みであれば、以後の
  // `.data(newData)` 呼び出しのたびにD3のenter/update/exit差分更新で
  // 再描画するだけで済む(カメラ=パン/ズームには触れない)。以前は
  // データが変わるたびにRectumを作り直し、`<D3Network key={dataKey}>` で
  // コンポーネントごと強制再マウントしていたため、ウィンドウを開く操作
  // (`windows:changed` → 再取得 → データ更新)のたびに視点・ズームが
  // 初期状態にリセットされる不具合があった。`handleNodeClick`/
  // `handleNodeDragEnded` は空配列依存で安定しているため、このRectumは
  // `HubPage` のマウント中ずっと同一インスタンスのままになる。
  //
  // NOTE: 現状 @yanqirenshi/d3.network 側の既知の問題により、ノードの
  // `<g>` に無条件で付く d3.drag() がネイティブの click イベントを
  // 抑制してしまい、この node.click コールバックが呼ばれない
  // (issue #84 のPRコメント参照)。ライブラリ本体の修正・バージョンアップ
  // 待ち。ここは修正後にそのまま動くよう、素直な形にしてある。
  const rectum = useMemo(() => {
    return new Rectum({
      callbacks: { node: { click: handleNodeClick, dragEnded: handleNodeDragEnded } },
    });
  }, [handleNodeClick, handleNodeDragEnded]);

  // データが変わるたびに同じRectumインスタンスへ `.data()` を呼んで更新
  // する。`move: "support"`(profile・作業ディレクトリ・ブランチ)の
  // ノードは `buildGraphData` が毎回座標を計算し直すため、`savedPositions`
  // (issue #121)を渡さない限りユーザーがドラッグした位置は更新のたびに
  // リセットされる(これはRectumを作り直すかどうかに関係ない、`move:
  // "support"` の既知の仕様。カメラ=パン/ズームとは別の話)。`Asshole` の
  // `rectum.selector()` 呼び出しより先にこのeffectが走った場合でも、
  // `Colon.data()` は selector 未設定なら描画せず値を保持するだけなので、
  // 後から selector が設定された時点で自動的に初回描画される。
  const dataKey = JSON.stringify({
    windowStates,
    profiles,
    sessionsByProfile,
    profileDetails,
    effectiveProjectsDir,
    savedPositions,
  });
  useEffect(() => {
    // NOTE: `@yanqirenshi/d3.network` の `Edges.js`(`draw()`)には、IDが
    // 一致した既存の辺要素(本来は「更新」として残すべきもの)まで無条件に
    // `remove()` してしまうバグがある(`Nodes.js` 側は `exit()` のみを
    // 正しく削除しており影響を受けない)。Rectumインスタンスを使い回す
    // ようになった(このeffect)ことで、2回目以降の `.data()` 呼び出しで
    // このバグが表面化し、辺(接続線)だけが全部消えてノードだけが残る
    // 状態になっていた。ライブラリ本体の修正待ちの間、ここで毎回いったん
    // 既存の辺要素を明示的に空にしてから `.data()` を呼ぶことで、
    // ライブラリの `enter()` が必ず全辺を新規追加として作り直すようにする
    // (辺自体はドラッグ位置等の保持すべき状態を持たないため、毎回作り
    // 直しても実害はない)。
    hubPageRef.current?.querySelectorAll("path.ng-edge").forEach((el) => el.remove());
    const { nodes, edges, positionKeys } = buildGraphData(
      windowStates,
      profiles,
      sessionsByProfile,
      profileDetails,
      effectiveProjectsDir,
      savedPositions,
    );
    validPositionKeysRef.current = positionKeys;
    rectum.data({ nodes, edges });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectum, dataKey]);

  // ノードの右クリックでインスペクタ(issue #109)を表示する。d3.network の
  // ノードAPI(node.click等)にcontextmenuの仕組みが無いため、描画後のDOMへ
  // イベント委任で直接バインドする(#84のクリック対応と同じ流儀。d3の
  // データ結合(`selection.data()`)はDOM要素の `__data__` にその要素の
  // データを直接載せる仕様のため、右クリックされた要素の祖先から
  // `g.ng-node` を辿ればノードの生データ(`_core` を含む)が取れる)。
  // `.hub-page` 自体はデータが変わっても作り直されない(key を持つのは
  // 中の `D3Network` だけ)ため、委任先の要素は安定しており、購読はマウント
  // 時の1回だけでよい(グラフが再描画されるたびに張り直す必要が無い)。
  const [inspectorCore, setInspectorCore] = useState<HubNodeCore | null>(null);
  const hubPageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = hubPageRef.current;
    if (!container) return;
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const nodeGroup = target?.closest("g.ng-node") as
        | (Element & { __data__?: NodeDatum })
        | null;
      if (!nodeGroup?.__data__) return;
      e.preventDefault();
      const core = nodeGroup.__data__._core as HubNodeCore;
      setInspectorCore(core);
    };
    container.addEventListener("contextmenu", handleContextMenu);
    return () => container.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // 閉じる: ×(HubInspector側)・グラフの空白部クリック・Esc(issue #109)。
  // ノード自身のクリック(前面化・ウィンドウ起動)はここでは扱わず、既存の
  // 左クリック挙動をそのまま保つ。
  const handleHubPageClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest("g.ng-node")) return;
    setInspectorCore(null);
  }, []);

  useEffect(() => {
    if (!inspectorCore) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspectorCore(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inspectorCore]);

  const inspectorContent = inspectorCore
    ? buildInspectorContent(inspectorCore, {
        onFocusWindow: (windowLabel) => focusWindow(windowLabel).catch((e) => console.error(e)),
        onOpenProfileWindow: (profileId) =>
          openProfileWindow(profileId).catch((e) => console.error(e)),
      })
    : null;

  // インスペクタの幅をマウスドラッグで変更できるようにする(初期444px・
  // 最小222px・最大888px)。パネルは右端固定(`right:0`)のため、幅は
  // 「`.hub-page` の右端 - マウスのX座標」で都度算出する(ドラッグ開始時の
  // 差分ではなく現在位置から直接計算するため、stateの古い値を参照する心配が
  // ない)。
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_INITIAL_WIDTH);
  const handleResizeStart = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = hubPageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextWidth = rect.right - moveEvent.clientX;
      setInspectorWidth(
        Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, nextWidth)),
      );
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      // ドラッグ終了時にマウス下にあった要素(グラフのノード等)へ、ドラッグ
      // 操作の一部として直後に発火する click が誤って渡らないよう、次の
      // 1回だけキャプチャ段階で止める。
      window.addEventListener(
        "click",
        (clickEvent) => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
        },
        { capture: true, once: true },
      );
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  // ドラッグ固定位置を全て破棄し、自動レイアウトへ戻す(issue #121)。
  // 元に戻せない操作のため確認を挟む。
  const handleResetLayout = useCallback(() => {
    if (!window.confirm("ノードの配置をリセットしますか?")) return;
    setSavedPositions({});
    saveHubLayout({}).catch((e) => console.error(e));
  }, []);

  const dockItems = useMemo(
    () => [
      {
        id: "hub-reload",
        label: RELOAD_ICON,
        title: "再読み込み",
        onClick: load,
      },
      {
        id: "hub-reset-layout",
        label: LAYOUT_RESET_ICON,
        title: "配置をリセット",
        onClick: handleResetLayout,
      },
    ],
    [load, handleResetLayout],
  );
  usePageDockItems(dockItems);

  return (
    <div className="hub-page" ref={hubPageRef} onClick={handleHubPageClick}>
      {error && <p className="error">{error}</p>}
      {/* `rectum` はマウント中ずっと同一インスタンス(上記参照)なので、
          `key` は付けない。`key` を付けて`dataKey`が変わるたびに強制再
          マウントすると、そのたびにカメラ(パン/ズーム)がリセットされて
          しまう。 */}
      <D3Network rectum={rectum} />
      {inspectorContent && (
        <HubInspector
          content={inspectorContent}
          width={inspectorWidth}
          onClose={() => setInspectorCore(null)}
          onResizeStart={handleResizeStart}
        />
      )}
    </div>
  );
}

export default HubPage;
