import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import D3Network, { Rectum } from "@yanqirenshi/d3.network";
import type { NodeDatum } from "@yanqirenshi/d3.network";
import {
  focusWindow,
  getHubLayout,
  getHubTuning,
  getPc,
  getSettings,
  getViewerTabs,
  isAppError,
  listRunningSessions,
  listWindowStates,
  onPcDataLoaded,
  onPcDataLoading,
  onPcDataProgress,
  onPcSessionsUpdated,
  onRunningSessionChanged,
  onSettingsUpdated,
  onWindowsChanged,
  openProfileWindow,
  reconcileGitState,
  saveHubLayout,
  saveHubTuning,
  saveViewerTabs,
  startRunningSession,
  stopRunningSession,
} from "../api";
import type {
  CameraDto,
  GitBranchDto,
  GitRepositoryDto,
  GitWorktreeDto,
  GithubProjectDto,
  HubLayoutDto,
  NodePositionDto,
  PcDto,
  RunningPermissionModeDto,
  RunningSessionRefDto,
  RunningSessionSummaryDto,
  SessionDto,
  WorktreeSpecDto,
} from "../api";
import { usePageDockItems } from "../DockItemsContext";
import { DOMAIN_RELOAD_ICON, TUNING_ICON } from "../icons";
import HubTuningPopover, { DEFAULT_HUB_TUNING } from "../HubTuningPopover";
import type { HubTuning } from "../HubTuningPopover";
import { HUB_NODE_ICON_URIS } from "../hubNodeIcons";
import HubInspector from "../HubInspector";
import type { InspectorAction, InspectorContent, InspectorField } from "../HubInspector";
import {
  PERMISSION_MODE_LABELS,
  currentPermissionModeLabel,
  processStateLabel,
} from "../runningSessionLabels";

// 伝統色パレット(App.css の :root/tokens.css と同じ値。issue #84・#93)。
const COLOR_PEARL = "#fbfbf8"; // 真珠
const COLOR_KYO_MURASAKI = "#9d5b8b"; // 京紫(profile)
const COLOR_SUMI = "#373737"; // 墨
const COLOR_BORDER = "#dbdbdb"; // tokens.css の --border-default(エッジの線)

// リポジトリ・ブランチ・セッションのノードの円(ユーザー指示)。背景は透明、
// 枠線はなしにして、アイコンとラベルだけが見えるようにする。背景を
// 「なし」(`fill: none`)にしないのは、d3.network ではアイコン画像が
// クリックを透過させ(`pointer-events: none`)、クリック・右クリック・
// ドラッグを円(`circle.base`)が受けているため。SVG は塗りが `none` の
// 部分ではマウス操作を拾わないので、ノードを操作できなくなる。`transparent`
// なら見えないまま操作は拾える。枠線は `none`・太さ 0 で描かない。
// プロファイルのノードは、枠の太さでウィンドウの開閉を表す(issue #229)ため
// 対象外。
const INVISIBLE_NODE_CIRCLE = {
  fill: "transparent",
  stroke: { color: "none", width: 0 },
};

// 実行中セッション(issue #408)の状態を表すセッションノードの円の枠。
// セッションノードは既定では枠を描かない(上の `INVISIBLE_NODE_CIRCLE`)ため、
// app が起動しているセッションだけが枠を持ち、一目で見分けられる。色は
// tokens.css の伝統色から採り、意味の決め方は Badge(部品)のトーン
// (`runningSessionLabels` の `processStateTone`)に合わせる: いま動いて
// いる・人の操作を待っている(起動中・実行中・権限待ち)は金茶、落ち着いて
// いる(待機)は墨。権限待ちは人が答えるまで進まないので、枠を太くして
// 目立たせる。終了したものは枠を描かない(未起動と同じ見え方へ戻す)。
// 色だけに頼らないよう、状態の文言はインスペクタに必ず出す
// (`buildSessionInspectorContent`)。
const COLOR_KINCHA_500 = "#e58b25"; // 金茶(動いている)
const COLOR_KINCHA_700 = "#a46114"; // 金茶の濃い方(権限待ち)
const COLOR_SUMI_400 = "#a3a3a3"; // 墨(待機)
const RUNNING_STROKE_WIDTH = 3;
const AWAITING_PERMISSION_STROKE_WIDTH = 6;
function sessionNodeCircleStyle(running: RunningSessionSummaryDto | null) {
  switch (running?.process_state) {
    case "starting":
    case "running":
      return {
        fill: "transparent",
        stroke: { color: COLOR_KINCHA_500, width: RUNNING_STROKE_WIDTH },
      };
    case "awaiting_permission":
      return {
        fill: "transparent",
        stroke: { color: COLOR_KINCHA_700, width: AWAITING_PERMISSION_STROKE_WIDTH },
      };
    case "idle":
      return {
        fill: "transparent",
        stroke: { color: COLOR_SUMI_400, width: RUNNING_STROKE_WIDTH },
      };
    default:
      return INVISIBLE_NODE_CIRCLE;
  }
}

// Pc/User/プロファイル/GitRepository/GitBranch ノードの配置(ハブ再構築
// 第2〜4段。issue #224・#229・#283)。左から Pc 列・User 列・プロファイル列・
// リポジトリ列・ブランチ列を縦に並べ、セッションのグリッドはその右側から
// 始める。位置は並び順(`buildGraphData`参照)で決まるだけの簡易な整列で、
// ドラッグで動かせる(`move: "support"`)ため実装時点では見やすさよりも
// 「エッジが追える」ことを優先する。第3段でプロファイル列、第4段で Pc・User
// 列を一番左に足したため、そのたびに他の列を右へずらした(保存済みの位置が
// あるノードはその位置のまま)。
const PC_COLUMN_X = 80;
const USER_COLUMN_X = 320;
const PROFILE_COLUMN_X = 560;
const REPOSITORY_COLUMN_X = 800;
const BRANCH_COLUMN_X = 1040;
// GitWorktree 列(issue #438)。リポジトリ・ブランチの右に置き、セッションの
// 格子はさらに右から始める。
const WORKTREE_COLUMN_X = 1280;
// プロファイルノードの枠の太さ。ウィンドウで開いているものを太くする
// (issue #229。`buildGraphData` 参照)。
const PROFILE_OPEN_STROKE_WIDTH = 6;
const PROFILE_CLOSED_STROKE_WIDTH = 2;
const GIT_NODE_ORIGIN_Y = 70;
const GIT_NODE_ROW_HEIGHT = 90;

// セッションノードの初期配置(issue #214・#226)。セッションノードは
// `move: "will"` で force シミュレーションに委ねる(issue #226。第2段 #224 で
// セッション → GitBranch の線が入り、線で結ばれたセッションはブランチの周りに
// 集まるようになったため)。ここで決めるのはシミュレーション開始時の位置で、
// 第1段(issue #214)の格子の計算をそのまま流用する。列数は横長の画面に
// 合わせて「行数 × 1.5 ≒ 列数」になるよう決める(141件なら15列 × 10行)。
// 原点のxは Pc/User/プロファイル/GitRepository/GitBranch列(issue #224・
// #229・#283)と重ならない位置まで右へ寄せる。
const SESSION_GRID_ORIGIN = { x: 1520, y: 70 };
const SESSION_GRID_ASPECT = 1.5;
// 格子の間隔。横はラベル(12px × 最大16文字 ≒ 192px)が隣と重ならない幅、
// 縦は円(半径20)+ ラベル1行が収まる高さ。
const SESSION_GRID_CELL_WIDTH = 240;
const SESSION_GRID_CELL_HEIGHT = 110;

// セッションノードのラベルの最大文字数(issue #214)。格子の横幅に 12px の
// 文字が収まる長さにする(日本語でも隣のラベルと重なりにくい)。
const SESSION_LABEL_MAX_CHARS = 16;
// インスペクタの見出しに使うタイトルの最大文字数。
const SESSION_TITLE_MAX_CHARS = 40;
// session_id から表示名を作るときの桁数(既存のタイトル解決と同じ。issue #33)。
const SESSION_ID_PREFIX_CHARS = 8;

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
// グラフ調整値(issue #249)の保存のデバウンス間隔。ノード位置と同じ流儀。
const HUB_TUNING_SAVE_DEBOUNCE_MS = 500;

// `.data()` のたびに force シミュレーションを動かし直す(issue #226)。
// d3.network の `dragEnded`(`Simulation.js`)はドラッグ終了時に
// `alphaTarget(0)` を設定するため、ノードを1度でもドラッグするとシミュレー
// ションはやがて止まる。`Rectum.data()` はシミュレーションを再開しないので、
// 止まった後の再描画(再読み込み・配置のリセット等)では tick が走らず、
// 作り直した辺に線の形(`d`)が入らない(線が消える)うえ、`will` のノードも
// 動かない。d3.network 0.6 で追加された `rectum.simulation.configure()` も
// 再開はするが、常に `alpha(1)`(最大の強さ)で動かし直すため、再描画の
// たびに全ノードが大きく動いてしまう。そこで内部の d3 シミュレーション
// (`rectum.simulation.simulation`)を直接再開する。alphaTarget はライブラリの
// 既定値(0.6 の `Simulation.js` の `DEFAULT_OPTIONS.alpha.target` = 0.002)に
// 戻し、alpha は再描画のたびにノードが大きく動き回らない程度の小さな値にする。
// 実行中セッション → worktree の線(issue #438)の印。d3.network 0.6.1 の
// `Edges.js`(`makeDataLine`)は辺ごとの `line.color` を読まず、Rectum に渡した
// 既定色で全部の辺を塗る(ライブラリ側に「本来はデータに持たせるべき」という
// TODO コメントがある)。そのため、描いた直後にこの印の付いた辺だけ stroke を
// 上書きする(`applyRunningWorktreeEdgeColor`)。`tick` は色に触らないので、
// 上書きはシミュレーションが動いても消えない。
const RUNNING_WORKTREE_RELATION = "running-worktree";

function applyRunningWorktreeEdgeColor(container: HTMLElement | null): void {
  container?.querySelectorAll("path.ng-edge").forEach((el) => {
    const core = (el as Element & { __data__?: { _core?: Record<string, unknown> } }).__data__
      ?._core;
    if (core?.relation !== RUNNING_WORKTREE_RELATION) return;
    const line = core.line as { color?: string } | undefined;
    if (line?.color) el.setAttribute("stroke", line.color);
  });
}

const SIMULATION_RESTART_ALPHA = 0.1;
const SIMULATION_DEFAULT_ALPHA_TARGET = 0.002;
type D3SimulationLike = {
  alpha(value: number): D3SimulationLike;
  alphaTarget(value: number): D3SimulationLike;
  restart(): D3SimulationLike;
};
function restartSimulation(rectum: Rectum): void {
  const simulation = (rectum as unknown as { simulation?: { simulation?: D3SimulationLike } })
    .simulation?.simulation;
  simulation
    ?.alpha(SIMULATION_RESTART_ALPHA)
    .alphaTarget(SIMULATION_DEFAULT_ALPHA_TARGET)
    .restart();
}

// 右クリック時に何を表示するかを判定するための、ノードの元データ(`_core`)。
// 第1段(issue #214)はセッションノードのみだったが、第2段(issue #224)で
// GitRepository/GitBranch ノードを、第3段(issue #229)でプロファイルノードを、
// 第4段(issue #283)で Pc/User ノードを戻した。フィールドはインスペクタ
// (issue #109)の表示と、プロファイルノードの左クリック(ウィンドウの
// 前面化/新規オープン)に使う。
type HubNodeCore = {
  kind:
    | "pc"
    | "user"
    | "session"
    | "git-repository"
    | "git-branch"
    | "git-worktree"
    | "profile";
  // ドラッグ位置の永続化(issue #121)に使う安定キー。位置を保存する
  // ノードにのみ設定する(セッションノードは force シミュレーションに委ねる
  // ため保存しない。issue #226)。GitRepository/GitBranch ノード(issue #224)は
  // 台帳の個体指定子(repository_path/branch_id)由来のキーで保存する。
  positionKey?: string;
  // Pc(`domain::Pc`。issue #182・#283)
  pcName?: string;
  systemUuid?: string;
  pcDescription?: string;
  // User(`domain::User`。issue #182・#283)
  userId?: string;
  userName?: string;
  homeDirectory?: string;
  // session(`domain::Session` のモデル属性。issue #197)
  sessionId?: string;
  sessionTitle?: string;
  customTitle?: string | null;
  aiTitle?: string | null;
  mode?: string | null;
  slug?: string | null;
  lastPrompt?: string | null;
  // Session.conversation_files/subagent_files(オブジェクトモデル実装
  // 第5〜6弾。issue #208)。行(LogLine)は遅延読み込みのため、未読み込みの
  // 間は常に`false`/`0`(セッションを開くと`get_session`の読み込みに
  // 相乗りしてキャッシュされる)。`conversationFiles`は issue #217 で
  // 1..*(配列)になった(同じsession_idのjsonlがworktree移動により複数
  // フォルダにできるケースに対応するため)。並びは更新時刻の古い順。
  conversationFiles?: { filePath: string; linesLoaded: boolean; lineCount: number }[];
  subagentFileCount?: number;
  // セッション→ブランチの対応付けに使った表示補助データ(issue #224)。
  // `domain::Session`の属性ではない(`SessionDto.cwd`/`git_branch`参照)。
  cwd?: string | null;
  gitBranch?: string | null;
  // GitRepository(`domain::GitRepository`。issue #189/#193/#224)。
  repositoryName?: string;
  repositoryPath?: string;
  repositoryDescription?: string;
  repositoryBranchCount?: number;
  repositoryWorktreeCount?: number;
  // GitBranch(`domain::GitBranch`。issue #193/#224)。削除済みは
  // バックエンド側(`GitRepositoryDto`への変換)で既に除外されている。
  branchName?: string;
  branchId?: string;
  branchDescription?: string;
  branchCreatedAtTime?: number;
  // プロファイル(settings 由来。issue #229)。オブジェクトモデルのクラス
  // ではなく「1ウィンドウ = 1プロファイル」の起点となる設定。
  profileId?: string;
  profileName?: string;
  profileRepositoryPath?: string | null;
  profileGithubProject?: GithubProjectDto | null;
  profileFolders?: string[];
  // このプロファイルを開いているウィンドウのラベル(無ければ未オープン)。
  windowLabel?: string;
  // 実行中セッションの起動・ビューア表示(issue #408)に使う値。backend は
  // cwd やパスを受け取らず、プロファイルと会話ファイルから解決する
  // (native.md §4)ため、画面側は「どのプロファイルで、どのフォルダの、どの
  // 会話か」だけを持つ。
  //  - project: 会話ファイルの置かれているフォルダ名
  //    (`~/.claude/projects/<project>/<session_id>.jsonl` の <project>)。
  //  - ownerProfileId/Name: このセッションの cwd を含むリポジトリを対象に
  //    しているプロファイル(見つからなければ未設定。起動できない)。
  project?: string | null;
  ownerProfileId?: string;
  ownerProfileName?: string;
  // 会話ファイル(jsonl)がまだ無い、実行中セッションだけの仮ノード(issue #424)。
  provisional?: boolean;
  // 実行中セッションが動いている worktree の名前(issue #438)。リポジトリ本体で
  // 動いている・分からないときは未設定。
  runningWorktreeName?: string;
  // 起動のダイアログで選べる既存の worktree(issue #438)。セッション・リポジトリ・
  // プロファイルのノードに、そのリポジトリの worktree を載せる。
  worktreeChoices?: WorktreeChoice[];
  // GitWorktree(`domain::GitWorktree`。issue #193。ノードとして描くのは #438 から)。
  worktreeId?: string;
  worktreeName?: string;
  worktreeFolderPath?: string;
  worktreeDescription?: string;
  worktreeCheckedOutBranch?: string | null;
  worktreeCreatedAtTime?: number;
  // リポジトリノードから新規セッションを作るときに使うプロファイル
  // (このリポジトリを対象にしているもの。issue #408)。
  repositoryProfileId?: string;
  repositoryProfileName?: string;
};

// ハブに描くプロファイル1件分(issue #229)。`get_settings` のプロファイル
// 一覧(id・名前)と、プロファイルごとの `get_settings(profileId)` の内容、
// `list_window_states` のウィンドウとの対応を合わせた表示用スナップショット。
type HubProfile = {
  id: string;
  name: string;
  repositoryPath: string | null;
  githubProject: GithubProjectDto | null;
  folders: string[];
  windowLabel?: string;
};

// 空白だけの値は未設定として扱い、改行を詰めて1行にする(last_prompt は
// 複数行になりうるため)。
function normalizeTitleSource(value: string | null): string | null {
  if (value === null) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed === "" ? null : collapsed;
}

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length <= maxChars ? text : `${chars.slice(0, maxChars).join("")}…`;
}

// セッションの表示名を決める(issue #214)。優先順位: custom_title →
// ai_title → last_prompt → session_id の先頭8文字。既存のタイトル解決
// (`domain::resolve_session_title`。issue #33)と同じ発想で、モデル属性
// (`SessionDto`)だけから組み立てる。表示用の整形であり、業務ルールではない。
function resolveSessionTitle(session: SessionDto): string {
  return (
    normalizeTitleSource(session.custom_title) ??
    normalizeTitleSource(session.ai_title) ??
    normalizeTitleSource(session.last_prompt) ??
    session.session_id.slice(0, SESSION_ID_PREFIX_CHARS)
  );
}

// パス比較の正規化(区切り文字・末尾のスラッシュ・大小文字の違いを吸収する。
// issue #224)。Windows のパス(バックスラッシュ・大文字小文字を区別しない)を
// 主な対象にした簡易な比較で、シンボリックリンク解決等は行わない。
function normalizePathForComparison(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// `path` が `base` そのもの、または `base` の配下にあるかを判定する
// (issue #224)。
function isPathUnder(path: string, base: string): boolean {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedBase = normalizePathForComparison(base);
  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
}

// セッションの `cwd` から、それを所有する登録済みリポジトリ(`repository_path`
// またはいずれかの worktree の `worktree_folder_path` の配下)を1つ特定する
// (issue #224)。複数のリポジトリの配下が重なることは通常無いため、最初に
// 見つかったものを採用する単純な実装にしている。
function findOwningRepository(
  cwd: string,
  repositories: GitRepositoryDto[],
): GitRepositoryDto | undefined {
  return repositories.find(
    (repo) =>
      isPathUnder(cwd, repo.repository_path) ||
      repo.worktrees.some((worktree) => isPathUnder(cwd, worktree.worktree_folder_path)),
  );
}

// セッション→GitBranch の対応付け(issue #224。クラス図に無い導出関係:
// ログ行の `cwd`/`git_branch` から求めた表示補助であり、`Session` のモデル上の
// 関連ではない)。`cwd` でリポジトリを特定し、その中で `branch_name` が
// 一致するブランチを探す。対応が取れなければ `undefined` を返し、呼び出し側は
// エッジを引かない(未登録リポジトリのプロジェクト・branch未記録・削除済み
// ブランチ等。フォールバックノードは作らない。第1段の割り切りを維持)。
function findMatchingBranch(
  session: SessionDto,
  repositories: GitRepositoryDto[],
): GitBranchDto | undefined {
  if (!session.cwd || !session.git_branch) return undefined;
  const repository = findOwningRepository(session.cwd, repositories);
  return repository?.branches.find((branch) => branch.branch_name === session.git_branch);
}

function gitBranchNodeId(branchId: string): string {
  return `git-branch:${branchId}`;
}

function gitWorktreeNodeId(worktreeId: string): string {
  return `git-worktree:${worktreeId}`;
}

// 起動のダイアログで選ぶ worktree の選択肢(issue #438)。パスは渡さない
// (backend が台帳の worktree_id から解決する。native.md §4)ので、画面が持つのは
// ID と、選ぶときの手がかり(名前・チェックアウト中のブランチ)だけ。
type WorktreeChoice = { id: string; name: string; branch: string | null };

function worktreeChoicesOf(repository: GitRepositoryDto | undefined): WorktreeChoice[] {
  return (repository?.worktrees ?? []).map((worktree) => ({
    id: worktree.worktree_id,
    name: worktree.worktree_name,
    branch: checkedOutBranchName(worktree, repository),
  }));
}

// `GitWorktree.checked_out_branch` は台帳の GitBranch の個体指定子(ID)なので、
// 画面に出すときはブランチ名へ直す(issue #438。実機で ID が出て気づいた)。
function checkedOutBranchName(
  worktree: GitWorktreeDto,
  repository: GitRepositoryDto | undefined,
): string | null {
  if (!worktree.checked_out_branch) return null;
  return (
    repository?.branches.find((branch) => branch.branch_id === worktree.checked_out_branch)
      ?.branch_name ?? null
  );
}

// 実行中セッションが動いている worktree(issue #438)。起動時の指定は backend が
// 解決してしまうため、画面は実際の cwd から逆に辿る(リポジトリ本体で動いて
// いれば見つからない)。
function findRunningWorktree(
  running: RunningSessionSummaryDto,
  repositories: GitRepositoryDto[],
): GitWorktreeDto | undefined {
  const cwd = running.cwd;
  if (!cwd) return undefined;
  const repository = findOwningRepository(cwd, repositories);
  return repository?.worktrees.find((worktree) =>
    isPathUnder(cwd, worktree.worktree_folder_path),
  );
}

// 会話ファイルのパスから、それが置かれているフォルダ名(`project`)を取り出す
// (issue #408)。`~/.claude/projects/<project>/<session_id>.jsonl` の <project>
// で、再開(`start_running_session` の resume)とビューアのタブ(`ViewerTabDto`)
// のキーに使う。同じ session_id の会話ファイルが複数ある(worktree 移動。
// issue #217)ときは、並びが更新時刻の古い順なので最後の(最も新しい)ものを使う。
function projectFolderOf(session: SessionDto): string | null {
  const files = session.conversation_files;
  const filePath = files.length > 0 ? files[files.length - 1].file_path : null;
  if (!filePath) return null;
  const segments = filePath.replace(/\\/g, "/").split("/");
  return segments.length >= 2 ? segments[segments.length - 2] : null;
}

// リポジトリを対象にしているプロファイルを1つ選ぶ(issue #408)。実行中
// セッションの起動は必ずプロファイルを起点にする(cwd は backend が
// プロファイルから解決する。native.md §4)ため、リポジトリ・セッションの
// ノードから起動するときもプロファイルを1つ決める必要がある。複数あるときは
// 先頭(settings の並び順)を使う。
function findProfileForRepository(
  repositoryPath: string,
  profiles: HubProfile[],
): HubProfile | undefined {
  return profiles.find(
    (profile) =>
      profile.repositoryPath !== null &&
      normalizePathForComparison(profile.repositoryPath) ===
        normalizePathForComparison(repositoryPath),
  );
}

// `pc`(`get_pc`)と settings のプロファイルから、Pc/User ノード(ハブ再構築
// 第4段。issue #283)、プロファイルノード(第3段。issue #229)、GitRepository/
// GitBranch ノード(第2段。issue #224)、セッションノード(第1段。issue #214)を
// 組み立てる。表示対象は Pc・先頭ユーザー、全プロファイル、登録済みリポジトリ
// (`User.repositories`)とその現存ブランチ(削除済みはバックエンド側で除外
// 済み)、および全セッション(`User.sessions`。`~/.claude/projects` 全体で、
// プロファイルの対象フォルダ設定とは無関係)。backend は全ユーザーに同じ一覧を
// 割り当てる(`app::pc_with_user_sessions`/`app::current_pc_with_repositories`)
// ため、重複させないよう先頭ユーザーの分だけを使う。d3.network はノードに
// x/y が必須のため、座標は列・格子の位置として自前で計算する。
function buildGraphData(
  pc: PcDto | null,
  profiles: HubProfile[],
  // session_id → app が起動している実行中セッション(issue #408)。
  runningBySessionId: Map<string, RunningSessionSummaryDto>,
  savedPositions: Record<string, NodePositionDto>,
  currentPositions: Map<string, NodePositionDto>,
) {
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  // 現在のグラフに実在する positionKey の集合(issue #121)。保存時、既に
  // 存在しないノードの位置情報をここで自然に除外する(呼び出し側が保存前に
  // この集合でフィルタする)。
  const positionKeys = new Set<string>();
  let edgeSeq = 0;

  // ドラッグで固定した位置(issue #121)があればそれを使い、無ければ計算した
  // 既定位置を使う(issue #224でGitRepository/GitBranchノードに導入)。
  const resolvePosition = (positionKey: string, defaultX: number, defaultY: number) =>
    savedPositions[positionKey] ?? { x: defaultX, y: defaultY };

  const user = pc?.users[0];
  const repositories = user?.repositories ?? [];
  const sessions = user?.sessions ?? [];

  // GitRepository / GitBranch ノード(issue #224)。リポジトリを縦に並べ、
  // 各リポジトリのブランチをその右列・同じ行範囲に並べる。
  // プロファイルノード(issue #229)を参照先のリポジトリと同じ高さに並べ、
  // 線を引くため、リポジトリごとのノードIDと位置(正規化したパスがキー)を
  // 控えておく。
  const repositoryNodeByPath = new Map<string, { nodeId: string; y: number }>();
  // 実行中セッション → worktree の線(issue #438)を引くための、worktree の
  // フォルダのパス(正規化済み)からノードIDへの対応。
  const worktreeNodeByPath = new Map<string, string>();
  let row = 0;
  repositories.forEach((repo) => {
    const repoRowStart = row;
    repo.branches.forEach((branch) => {
      const branchNodeId = gitBranchNodeId(branch.branch_id);
      positionKeys.add(branchNodeId);
      const branchPosition = resolvePosition(
        branchNodeId,
        BRANCH_COLUMN_X,
        GIT_NODE_ORIGIN_Y + row * GIT_NODE_ROW_HEIGHT,
      );
      nodes.push({
        id: branchNodeId,
        x: branchPosition.x,
        y: branchPosition.y,
        move: "support",
        label: {
          text: truncate(branch.branch_name, SESSION_LABEL_MAX_CHARS),
          fill: COLOR_SUMI,
          font: { size: 12 },
          y: labelYBelowCircle(20),
        },
        circle: { r: 20, ...INVISIBLE_NODE_CIRCLE },
        icon: { url: HUB_NODE_ICON_URIS.gitBranch },
        kind: "git-branch",
        positionKey: branchNodeId,
        branchName: branch.branch_name,
        branchId: branch.branch_id,
        branchDescription: branch.description,
        branchCreatedAtTime: branch.created_at_time,
      });
      row += 1;
    });
    // ブランチが1つも無いリポジトリでも、自身の行を1つ確保する。
    if (repo.branches.length === 0) row += 1;

    const repositoryNodeId = `git-repository:${repo.repository_path}`;
    const profileForRepository = findProfileForRepository(repo.repository_path, profiles);
    positionKeys.add(repositoryNodeId);
    const repositoryPosition = resolvePosition(
      repositoryNodeId,
      REPOSITORY_COLUMN_X,
      GIT_NODE_ORIGIN_Y + repoRowStart * GIT_NODE_ROW_HEIGHT,
    );
    repositoryNodeByPath.set(normalizePathForComparison(repo.repository_path), {
      nodeId: repositoryNodeId,
      y: repositoryPosition.y,
    });
    nodes.push({
      id: repositoryNodeId,
      x: repositoryPosition.x,
      y: repositoryPosition.y,
      move: "support",
      label: {
        text: truncate(repo.repository_name, SESSION_LABEL_MAX_CHARS),
        fill: COLOR_SUMI,
        font: { size: 13 },
        y: labelYBelowCircle(26),
      },
      circle: { r: 26, ...INVISIBLE_NODE_CIRCLE },
      icon: { url: HUB_NODE_ICON_URIS.gitRepository },
      kind: "git-repository",
      positionKey: repositoryNodeId,
      repositoryName: repo.repository_name,
      repositoryPath: repo.repository_path,
      repositoryDescription: repo.description,
      repositoryBranchCount: repo.branches.length,
      repositoryWorktreeCount: repo.worktrees.length,
      // 新規セッション(issue #408)の起点にするプロファイル。
      repositoryProfileId: profileForRepository?.id,
      repositoryProfileName: profileForRepository?.name,
      // 起動する worktree の選択肢(issue #438)。
      worktreeChoices: worktreeChoicesOf(repo),
    });

    // GitWorktree ノード(issue #193 の台帳。ノードとして描くのは #438 から)。
    // リポジトリ本体の右の列に、そのリポジトリの worktree を縦に並べる。実行中
    // セッションがどの worktree で動いているかを線で見せるために足した。
    repo.worktrees.forEach((worktree, i) => {
      const worktreeNodeId = gitWorktreeNodeId(worktree.worktree_id);
      positionKeys.add(worktreeNodeId);
      const worktreePosition = resolvePosition(
        worktreeNodeId,
        WORKTREE_COLUMN_X,
        GIT_NODE_ORIGIN_Y + (repoRowStart + i) * GIT_NODE_ROW_HEIGHT,
      );
      worktreeNodeByPath.set(
        normalizePathForComparison(worktree.worktree_folder_path),
        worktreeNodeId,
      );
      nodes.push({
        id: worktreeNodeId,
        x: worktreePosition.x,
        y: worktreePosition.y,
        move: "support",
        label: {
          text: truncate(worktree.worktree_name, SESSION_LABEL_MAX_CHARS),
          fill: COLOR_SUMI,
          font: { size: 12 },
          y: labelYBelowCircle(20),
        },
        circle: { r: 20, ...INVISIBLE_NODE_CIRCLE },
        icon: { url: HUB_NODE_ICON_URIS.gitWorktree },
        kind: "git-worktree",
        positionKey: worktreeNodeId,
        worktreeId: worktree.worktree_id,
        worktreeName: worktree.worktree_name,
        worktreeFolderPath: worktree.worktree_folder_path,
        worktreeDescription: worktree.description,
        worktreeCheckedOutBranch: checkedOutBranchName(worktree, repo),
        worktreeCreatedAtTime: worktree.created_at_time,
      });
      // GitRepository → GitWorktree(所有。台帳どおり)。
      edges.push({
        id: `e${edgeSeq++}`,
        source: repositoryNodeId,
        target: worktreeNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });
    });

    // GitRepository → GitBranch(所有。台帳どおり。issue #224)。
    repo.branches.forEach((branch) => {
      edges.push({
        id: `e${edgeSeq++}`,
        source: repositoryNodeId,
        target: gitBranchNodeId(branch.branch_id),
        line: { width: 2, color: COLOR_BORDER },
      });
    });
  });

  // Pc / User ノード(ハブ再構築 第4段。issue #283)。プロファイル列のさらに
  // 左に Pc → User の順で並べる。線は Pc → User(コンポジション users)と、
  // User → 各 GitRepository(コンポジション repositories)の2種。User →
  // セッション(コンポジション sessions)はモデル上の所有だが、全セッションへ
  // 何十本もの線を引くとノイズになるため引かない(issue #283 の設計)。
  // `pc` が未取得の間は描かない(取得後の再描画で現れる)。
  if (pc) {
    const pcNodeId = "pc";
    positionKeys.add(pcNodeId);
    const pcPosition = resolvePosition(pcNodeId, PC_COLUMN_X, GIT_NODE_ORIGIN_Y);
    nodes.push({
      id: pcNodeId,
      x: pcPosition.x,
      y: pcPosition.y,
      move: "support",
      label: {
        text: truncate(pc.pc_name, SESSION_LABEL_MAX_CHARS),
        fill: COLOR_SUMI,
        font: { size: 14 },
        y: labelYBelowCircle(28),
      },
      circle: { r: 28, ...INVISIBLE_NODE_CIRCLE },
      icon: { url: HUB_NODE_ICON_URIS.pc },
      kind: "pc",
      positionKey: pcNodeId,
      pcName: pc.pc_name,
      systemUuid: pc.system_uuid,
      pcDescription: pc.description,
    });

    if (user) {
      const userNodeId = `user:${user.user_id}`;
      positionKeys.add(userNodeId);
      const userPosition = resolvePosition(userNodeId, USER_COLUMN_X, GIT_NODE_ORIGIN_Y);
      nodes.push({
        id: userNodeId,
        x: userPosition.x,
        y: userPosition.y,
        move: "support",
        label: {
          text: truncate(user.user_name, SESSION_LABEL_MAX_CHARS),
          fill: COLOR_SUMI,
          font: { size: 13 },
          y: labelYBelowCircle(26),
        },
        circle: { r: 26, ...INVISIBLE_NODE_CIRCLE },
        icon: { url: HUB_NODE_ICON_URIS.user },
        kind: "user",
        positionKey: userNodeId,
        userId: user.user_id,
        userName: user.user_name,
        homeDirectory: user.home_directory,
      });
      edges.push({
        id: `e${edgeSeq++}`,
        source: pcNodeId,
        target: userNodeId,
        line: { width: 2, color: COLOR_BORDER },
      });
      repositoryNodeByPath.forEach((repository) => {
        edges.push({
          id: `e${edgeSeq++}`,
          source: userNodeId,
          target: repository.nodeId,
          line: { width: 2, color: COLOR_BORDER },
        });
      });
    }
  }

  // プロファイルノード(issue #229)。GitRepository 列の左に並べる。
  // `repository_path` が登録リポジトリと一致するものは、そのリポジトリと同じ
  // 高さから下へ積み、線(プロファイル → GitRepository。参照)を引く。
  // 未設定・不一致のものは線を引かず(フォールバックノードは作らない。第1〜2段
  // の割り切りを維持)、全リポジトリの行の下へ並べる。
  const linkedCountByRepository = new Map<string, number>();
  let unlinkedRow = row;
  profiles.forEach((profile) => {
    const profileNodeId = `profile:${profile.id}`;
    positionKeys.add(profileNodeId);
    const repositoryKey = profile.repositoryPath
      ? normalizePathForComparison(profile.repositoryPath)
      : null;
    const repository = repositoryKey ? repositoryNodeByPath.get(repositoryKey) : undefined;
    let defaultY: number;
    if (repositoryKey && repository) {
      const stacked = linkedCountByRepository.get(repositoryKey) ?? 0;
      linkedCountByRepository.set(repositoryKey, stacked + 1);
      defaultY = repository.y + stacked * GIT_NODE_ROW_HEIGHT;
    } else {
      defaultY = GIT_NODE_ORIGIN_Y + unlinkedRow * GIT_NODE_ROW_HEIGHT;
      unlinkedRow += 1;
    }
    const position = resolvePosition(profileNodeId, PROFILE_COLUMN_X, defaultY);
    const isOpen = profile.windowLabel !== undefined;
    nodes.push({
      id: profileNodeId,
      x: position.x,
      y: position.y,
      move: "support",
      label: {
        text: truncate(profile.name, SESSION_LABEL_MAX_CHARS),
        fill: COLOR_SUMI,
        font: { size: 13 },
        y: labelYBelowCircle(24),
      },
      // ウィンドウで開いているプロファイルは枠を太くして見分けられるようにする。
      // 旧プロファイルノード(issue #84)は円を京紫で塗っていたが、d3.network
      // 0.5 までの `makeDataCircle` は `circle.fill` を読まず常に白で塗って
      // いたため、枠の太さで区別することにした(issue #229)。0.6 で塗りも
      // 効くようになったが、見分け方は枠の太さのまま変えていない。
      circle: {
        r: 24,
        fill: COLOR_PEARL,
        stroke: {
          color: COLOR_KYO_MURASAKI,
          width: isOpen ? PROFILE_OPEN_STROKE_WIDTH : PROFILE_CLOSED_STROKE_WIDTH,
        },
      },
      icon: { url: HUB_NODE_ICON_URIS.profile },
      kind: "profile",
      positionKey: profileNodeId,
      profileId: profile.id,
      profileName: profile.name,
      profileRepositoryPath: profile.repositoryPath,
      profileGithubProject: profile.githubProject,
      profileFolders: profile.folders,
      windowLabel: profile.windowLabel,
      // 起動する worktree の選択肢(issue #438)。プロファイルの対象リポジトリのもの。
      worktreeChoices: worktreeChoicesOf(
        repositories.find(
          (repo) =>
            profile.repositoryPath !== null &&
            normalizePathForComparison(repo.repository_path) ===
              normalizePathForComparison(profile.repositoryPath),
        ),
      ),
    });
    if (repository) {
      edges.push({
        id: `e${edgeSeq++}`,
        source: profileNodeId,
        target: repository.nodeId,
        line: { width: 2, color: COLOR_BORDER },
      });
    }
  });

  const columns = Math.max(1, Math.ceil(Math.sqrt(sessions.length * SESSION_GRID_ASPECT)));

  sessions.forEach((session, i) => {
    // ノードIDは session_id で作る。旧実装(issue #214〜#215)では、同じ
    // session_id の jsonl がworktree移動により複数フォルダにできることで
    // session_id が一意でなくなる問題を避けるため会話ファイルのパスを
    // 使っていたが、issue #217 でバックエンド側(`User::load_sessions`)が
    // 同じ session_id の Session を1つに集約する(`conversation_files` が
    // 1..*)ようになったため、session_id は再び一意になり、本来のIDへ戻した。
    const sessionNodeId = `session:${session.session_id}`;
    const title = resolveSessionTitle(session);
    // app が起動している実行中セッション(issue #408)。終了したものは
    // 呼び出し側で除いてあるので、ここに来るのは動いているものだけ。
    const running = runningBySessionId.get(session.session_id) ?? null;
    // 起動(再開)に使うプロファイル(issue #408)。セッションの cwd を含む
    // 登録済みリポジトリを対象にしているプロファイルを使う。
    const owningRepository = session.cwd
      ? findOwningRepository(session.cwd, repositories)
      : undefined;
    const owningProfile = owningRepository
      ? findProfileForRepository(owningRepository.repository_path, profiles)
      : undefined;
    // いま動いている worktree(issue #438)。線とインスペクタに使う。
    const runningWorktree = running ? findRunningWorktree(running, repositories) : undefined;
    // 既に描画中のノードは、シミュレーションで動いた現在位置から続ける
    // (issue #226)。d3.network は `.data()` のたびに同じIDのノードも新しい
    // データの x/y で置き換えるため、引き継がないと再読み込みやブランチの
    // ドラッグ(位置保存 → 再描画)のたびにセッションが格子の位置へ戻る。
    const position = currentPositions.get(sessionNodeId) ?? {
      x: SESSION_GRID_ORIGIN.x + (i % columns) * SESSION_GRID_CELL_WIDTH,
      y: SESSION_GRID_ORIGIN.y + Math.floor(i / columns) * SESSION_GRID_CELL_HEIGHT,
    };
    nodes.push({
      id: sessionNodeId,
      x: position.x,
      y: position.y,
      move: "will",
      label: {
        text: truncate(title, SESSION_LABEL_MAX_CHARS),
        fill: COLOR_SUMI,
        font: { size: 12 },
        y: labelYBelowCircle(20),
      },
      // 実行中セッション(issue #408)だけ枠を描く。
      circle: { r: 20, ...sessionNodeCircleStyle(running) },
      icon: { url: HUB_NODE_ICON_URIS.session },
      kind: "session",
      sessionId: session.session_id,
      sessionTitle: title,
      customTitle: session.custom_title,
      aiTitle: session.ai_title,
      mode: session.mode,
      slug: session.slug,
      lastPrompt: session.last_prompt,
      conversationFiles: session.conversation_files.map((file) => ({
        filePath: file.file_path,
        linesLoaded: file.lines_loaded,
        lineCount: file.line_count,
      })),
      subagentFileCount: session.subagent_files.length,
      cwd: session.cwd,
      gitBranch: session.git_branch,
      // 起動(再開)・ビューア表示(issue #408)に使う値。
      project: projectFolderOf(session),
      ownerProfileId: owningProfile?.id,
      ownerProfileName: owningProfile?.name,
      // 起動する worktree の選択肢と、いま動いている worktree(issue #438)。
      worktreeChoices: worktreeChoicesOf(owningRepository),
      runningWorktreeName: runningWorktree?.worktree_name,
    });

    // セッション → GitBranch(issue #224。クラス図に無い導出関係。ログ行の
    // cwd/git_branchから求めた表示補助のエッジであり、`Session`のモデル上の
    // 関連ではない)。対応が取れないセッションは線を引かない
    // (`findMatchingBranch`参照。フォールバックノードは作らない)。
    const matchedBranch = findMatchingBranch(session, repositories);
    if (matchedBranch) {
      edges.push({
        id: `e${edgeSeq++}`,
        source: sessionNodeId,
        target: gitBranchNodeId(matchedBranch.branch_id),
        line: { width: 1, color: COLOR_BORDER },
      });
    }

    // 実行中セッション → GitWorktree(issue #438)。app が起動した claude が
    // いまどのフォルダで動いているかを表す線で、台帳の関連ではない。他の線
    // (薄い灰色)と違って金茶にしてあるのは、実行中セッションの枠(issue #408)と
    // 同じ「いま動いている」を表すため。太さは所有の線(2)と導出の線(1)の
    // 間を取らず、実行中の枠と同じ意味づけを優先して 2 にしている。
    if (running && runningWorktree) {
      const worktreeNodeId = worktreeNodeByPath.get(
        normalizePathForComparison(runningWorktree.worktree_folder_path),
      );
      if (worktreeNodeId) {
        edges.push({
          id: `e${edgeSeq++}`,
          source: sessionNodeId,
          target: worktreeNodeId,
          line: { width: 2, color: COLOR_KINCHA_500 },
          relation: RUNNING_WORKTREE_RELATION,
        });
      }
    }
  });

  // 仮のセッションノード(issue #424)。app が起動した新しい会話は、会話ファイル
  // (jsonl)ができるまで `User.sessions` に現れない(ハブのセッションノードは
  // `~/.claude/projects` の走査結果から作るため)。起動しているのにノードが無いと
  // 状態も見られず止められないので、実行中セッションの一覧にあって図に無いものを
  // 仮のノードとして描く。ノードIDは通常のセッションノードと同じ
  // (`session:<session_id>`)にしてあるので、会話ファイルができて通常のノードが
  // 現れたら、そのまま置き換わる(インスペクタで選んでいた対象も保たれる)。
  const drawnSessionIds = new Set(sessions.map((session) => session.session_id));
  runningBySessionId.forEach((running, sessionId) => {
    if (drawnSessionIds.has(sessionId)) return;
    const sessionNodeId = `session:${sessionId}`;
    const repository = repositoryNodeByPath.get(
      normalizePathForComparison(running.repository_path),
    );
    const owningProfile = findProfileForRepository(running.repository_path, profiles);
    const runningWorktree = findRunningWorktree(running, repositories);
    // 起動元のリポジトリの高さから描き始める(線で結ぶので、あとはシミュレー
    // ションがリポジトリの近くへ寄せる)。
    const position = currentPositions.get(sessionNodeId) ?? {
      x: SESSION_GRID_ORIGIN.x,
      y: repository?.y ?? SESSION_GRID_ORIGIN.y,
    };
    // 表示名(`--name`)があればそれを、無ければ session_id の先頭8文字を出す
    // (通常のセッションノードのタイトル解決と同じ流儀)。
    const title = running.name ?? sessionId.slice(0, SESSION_ID_PREFIX_CHARS);
    nodes.push({
      id: sessionNodeId,
      x: position.x,
      y: position.y,
      move: "will",
      label: {
        text: truncate(title, SESSION_LABEL_MAX_CHARS),
        fill: COLOR_SUMI,
        font: { size: 12 },
        y: labelYBelowCircle(20),
      },
      circle: { r: 20, ...sessionNodeCircleStyle(running) },
      icon: { url: HUB_NODE_ICON_URIS.session },
      kind: "session",
      provisional: true,
      sessionId,
      sessionTitle: title,
      cwd: running.cwd,
      // 会話ファイルがまだ無いので `project` は決まらない(ビューアで開けない)。
      project: null,
      ownerProfileId: owningProfile?.id,
      ownerProfileName: owningProfile?.name,
      runningWorktreeName: runningWorktree?.worktree_name,
    });
    if (repository) {
      edges.push({
        id: `e${edgeSeq++}`,
        source: sessionNodeId,
        target: repository.nodeId,
        line: { width: 1, color: COLOR_BORDER },
      });
    }
    // 実行中セッション → GitWorktree(issue #438。通常のノードと同じ線)。
    if (runningWorktree) {
      const worktreeNodeId = worktreeNodeByPath.get(
        normalizePathForComparison(runningWorktree.worktree_folder_path),
      );
      if (worktreeNodeId) {
        edges.push({
          id: `e${edgeSeq++}`,
          source: sessionNodeId,
          target: worktreeNodeId,
          line: { width: 2, color: COLOR_KINCHA_500 },
          relation: RUNNING_WORKTREE_RELATION,
        });
      }
    }
  });

  return { nodes, edges, positionKeys };
}

// ノードの `_core` から、グラフのノードID(`buildGraphData` が振ったもの)を
// 求める(issue #424)。描き直したあとにインスペクタの中身を最新へ差し替える
// ために使う。セッションは session_id 由来、それ以外は位置の保存キーがそのまま
// ノードIDになっている。
function nodeIdOfCore(core: HubNodeCore): string | null {
  if (core.kind === "session") return core.sessionId ? `session:${core.sessionId}` : null;
  return core.positionKey ?? null;
}

// インスペクタから行える操作(issue #229・#408)。実処理は呼び出し側
// (`HubGraphPage`)が持ち、ここではボタン・入力欄に配るだけにする。
// `startMode`/`startName` は起動(再開・新規)の入力で、ノードを選び直すと
// 初期値へ戻す(`HubGraphPage` 側)。`busy` は backend への操作の最中で、
// 二重に押させないためにボタンを無効にする。
// 起動するフォルダの選び方(issue #438)。
//  - keep: 指定しない(再開のみ。会話ファイルに記録された cwd で開く)
//  - main: リポジトリ本体
//  - existing: 既存の worktree(台帳の worktree_id)
//  - branch: ブランチ名を指定(worktree が無ければ backend が用意する)
type StartWorktreeKind = "keep" | "main" | "existing" | "branch";

type InspectorHandlers = {
  onOpenProfile: (core: HubNodeCore) => void;
  onOpenInViewer: (core: HubNodeCore) => void;
  onStartResume: (core: HubNodeCore) => void;
  onStop: (target: RunningSessionRefDto) => void;
  onStartNew: (core: HubNodeCore) => void;
  startMode: RunningPermissionModeDto;
  onStartModeChange: (mode: RunningPermissionModeDto) => void;
  startName: string;
  onStartNameChange: (name: string) => void;
  // 起動するフォルダ(issue #438)。
  startWorktreeKind: StartWorktreeKind;
  onStartWorktreeKindChange: (kind: StartWorktreeKind) => void;
  startWorktreeId: string;
  onStartWorktreeIdChange: (worktreeId: string) => void;
  startBranchName: string;
  onStartBranchNameChange: (branchName: string) => void;
  // 入力が足りていない(worktree・ブランチ名が未選択)ときは起動させない。
  startInputIncomplete: boolean;
  // 起動に失敗した理由(worktree の用意の失敗を含む。issue #438)。起動できて
  // いないことが分かるよう、ボタンのすぐ上に出す。
  startError: string | null;
  busy: boolean;
};

// 起動(再開・新規)の入力欄(issue #408)。権限モードは画面で選べるモード
// (`PERMISSION_MODE_LABELS`)から選び、表示名(claude の `--name`)は任意。
// 値は呼び出し側が持ち、ここは表示だけ。
// `nameNote` は表示名の入力欄に添える注意書き(issue #424)。既存の会話を
// 再開するときに表示名を付けると、claude CLI が会話ファイルへ
// `type=custom-title` の行を追記するため、その会話のタイトルが変わる
// (#408 の実機確認で分かった副作用)。既定は空のままなので、何もしなければ
// タイトルは変わらない。
function HubStartSessionForm({
  handlers,
  choices,
  allowKeep,
  nameNote,
}: {
  handlers: InspectorHandlers;
  // 選んでいるノードのリポジトリの worktree(issue #438)。
  choices: WorktreeChoice[];
  // 「指定しない(会話ファイルのフォルダのまま)」を選べるか(再開だけ)。
  allowKeep: boolean;
  nameNote?: string;
}) {
  return (
    <>
      <label className="hub-inspector-form-row">
        <span>ブランチ / worktree</span>
        <select
          value={handlers.startWorktreeKind}
          disabled={handlers.busy}
          onChange={(e) =>
            handlers.onStartWorktreeKindChange(e.target.value as StartWorktreeKind)
          }
        >
          {allowKeep && <option value="keep">会話ファイルのフォルダのまま</option>}
          <option value="main">リポジトリ本体</option>
          {choices.length > 0 && <option value="existing">既存の worktree から選ぶ</option>}
          <option value="branch">ブランチ名を指定</option>
        </select>
      </label>
      {handlers.startWorktreeKind === "existing" && (
        <label className="hub-inspector-form-row">
          <span>worktree</span>
          <select
            value={handlers.startWorktreeId}
            disabled={handlers.busy}
            onChange={(e) => handlers.onStartWorktreeIdChange(e.target.value)}
          >
            <option value="">(選んでください)</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.branch ? `${choice.name}(${choice.branch})` : choice.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {handlers.startWorktreeKind === "branch" && (
        <label className="hub-inspector-form-row">
          <span>ブランチ名</span>
          <input
            type="text"
            value={handlers.startBranchName}
            disabled={handlers.busy}
            placeholder="session/impl-app-hub など"
            onChange={(e) => handlers.onStartBranchNameChange(e.target.value)}
          />
          <small className="hub-inspector-form-note">
            そのブランチの worktree が無ければ作成し、origin/main で最新化してから起動します
          </small>
        </label>
      )}
      <label className="hub-inspector-form-row">
        <span>権限モード</span>
        <select
          value={handlers.startMode}
          disabled={handlers.busy}
          onChange={(e) =>
            handlers.onStartModeChange(e.target.value as RunningPermissionModeDto)
          }
        >
          {(Object.keys(PERMISSION_MODE_LABELS) as RunningPermissionModeDto[]).map((mode) => (
            <option key={mode} value={mode}>
              {PERMISSION_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      <label className="hub-inspector-form-row">
        <span>表示名</span>
        <input
          type="text"
          value={handlers.startName}
          disabled={handlers.busy}
          placeholder="(任意)"
          onChange={(e) => handlers.onStartNameChange(e.target.value)}
        />
        {nameNote && <small className="hub-inspector-form-note">{nameNote}</small>}
      </label>
      {handlers.startError && (
        <p className="hub-inspector-form-error" role="alert">
          {handlers.startError}
        </p>
      )}
    </>
  );
}

// セッション間メッセージ(issue #437)に必要な claude の版。対応しているかの判定は
// backend(`RunningSessionSummaryDto.peer_messaging`)が持ち、ここは文言だけ。
const MIN_PEER_MESSAGING_VERSION = "2.1.268";

// 既存の会話を再開するときの注意書き(issue #424)。
const RESUME_NAME_NOTE = "表示名を付けると、この会話のタイトルが変わります";

// ノードの `_core`(issue #109)からインスペクタの表示内容を組み立てる。
// グラフ構築時に `_core` へ埋め込んだ値と、実行中セッションの一覧
// (`running`。issue #408)だけを使い、ここから backend を呼ぶことはしない
// (押されたときの処理は `handlers`)。ノード種別(issue #224・#229で
// セッション以外も追加)ごとに表示内容を分ける。
function buildInspectorContent(
  core: HubNodeCore,
  handlers: InspectorHandlers,
  // セッションノードのとき、app が起動している実行中セッション(無ければ null)。
  running: RunningSessionSummaryDto | null,
): InspectorContent {
  if (core.kind === "pc") return buildPcInspectorContent(core);
  if (core.kind === "user") return buildUserInspectorContent(core);
  if (core.kind === "profile") return buildProfileInspectorContent(core, handlers);
  if (core.kind === "git-repository") return buildRepositoryInspectorContent(core, handlers);
  if (core.kind === "git-branch") return buildBranchInspectorContent(core);
  if (core.kind === "git-worktree") return buildWorktreeInspectorContent(core);
  return buildSessionInspectorContent(core, handlers, running);
}

// Pc(issue #283)。`domain::Pc` のモデル属性(#182 当時の表示と同じ)。
function buildPcInspectorContent(core: HubNodeCore): InspectorContent {
  return {
    title: truncate(core.pcName ?? "PC", SESSION_TITLE_MAX_CHARS),
    fields: [
      { label: "pc_name", value: core.pcName ?? "" },
      { label: "system_uuid", value: core.systemUuid ?? "" },
      { label: "description", value: core.pcDescription || "(未設定)" },
    ],
    action: null,
  };
}

// User(issue #283)。`domain::User` のモデル属性。
function buildUserInspectorContent(core: HubNodeCore): InspectorContent {
  return {
    title: truncate(core.userName ?? "ユーザー", SESSION_TITLE_MAX_CHARS),
    fields: [
      { label: "user_name", value: core.userName ?? "" },
      { label: "user_id", value: core.userId ?? "" },
      { label: "home_directory", value: core.homeDirectory ?? "" },
    ],
    action: null,
  };
}

// プロファイル(issue #229)。settings の内容とウィンドウの開閉状態を表示し、
// 左クリックと同じ操作(前面化/ウィンドウで開く)をボタンでも出す。
// 新規セッション(issue #408)もここから作る(claude の cwd はプロファイルの
// リポジトリになるため、リポジトリ未設定のプロファイルからは作れない)。
function buildProfileInspectorContent(
  core: HubNodeCore,
  handlers: InspectorHandlers,
): InspectorContent {
  const project = core.profileGithubProject;
  return {
    title: truncate(core.profileName ?? "プロファイル", SESSION_TITLE_MAX_CHARS),
    fields: [
      { label: "名前", value: core.profileName ?? "" },
      { label: "repository_path", value: core.profileRepositoryPath ?? "(未設定)" },
      {
        label: "GitHubプロジェクト",
        value: project ? `${project.owner}#${project.number}` : "(未設定)",
      },
      // 複数件は改行区切り(`.hub-inspector-field dd` は `white-space: pre-line`)。
      { label: "対象フォルダ", value: (core.profileFolders ?? []).join("\n") || "(未設定)" },
      {
        label: "ウィンドウ",
        value: core.windowLabel ? "開いている" : "開いていない",
      },
    ],
    action: {
      label: core.windowLabel ? "前面化" : "ウィンドウで開く",
      onClick: () => handlers.onOpenProfile(core),
    },
    body: core.profileRepositoryPath ? (
      <HubStartSessionForm
        handlers={handlers}
        choices={core.worktreeChoices ?? []}
        allowKeep={false}
      />
    ) : undefined,
    actions: [
      {
        label: "新規セッション",
        onClick: () => handlers.onStartNew(core),
        disabled:
          handlers.busy || !core.profileRepositoryPath || handlers.startInputIncomplete,
      },
    ],
  };
}

// セッション(issue #214)。モデル属性に加えて、app が起動している実行中
// セッション(issue #408)の状態と、起動(再開)・停止・ビューア表示の操作を
// 出す。状態は Query(`listRunningSessions`)で取り直した値だけを使い、操作の
// 結果を先読みして書き換えることはしない。
function buildSessionInspectorContent(
  core: HubNodeCore,
  handlers: InspectorHandlers,
  running: RunningSessionSummaryDto | null,
): InspectorContent {
  const conversationFiles = core.conversationFiles ?? [];
  // 起動・ビューア表示は「プロファイル + フォルダ名 + session_id」で指定する
  // (backend は cwd を受け取らない。native.md §4)。どれかが欠けていると
  // 実行できないため、ボタンを押せなくする。
  const canAddress = Boolean(core.project && core.sessionId && core.ownerProfileId);
  // 実行中のときだけ出す項目(状態の詳細)。
  const runningFields: InspectorField[] = running
    ? [
        { label: "現在のモデル", value: running.current_model ?? "(最初の応答まで不明)" },
        {
          label: "権限モード",
          value: currentPermissionModeLabel(running.current_permission_mode),
        },
        { label: "答え待ち", value: `${running.pending_permission_count}件` },
        { label: "リポジトリ", value: running.repository_path },
        // いま動いているフォルダ(issue #438)。cwd から逆に辿って worktree を
        // 特定しているので、見つからなければリポジトリ本体で動いている。
        { label: "worktree", value: core.runningWorktreeName ?? "(リポジトリ本体)" },
        { label: "claude の版", value: running.cli_version ?? "(不明)" },
        // 版が古いときの警告(issue #437・#438)。起動は止まっていない。
        ...(running.peer_messaging === false
          ? [
              {
                label: "注意",
                value: `この claude(版 ${running.cli_version ?? "?"})は、セッション間メッセージに対応していません(${MIN_PEER_MESSAGING_VERSION} 以上が必要)。会話の対話は使えます`,
              },
            ]
          : []),
        { label: "表示名", value: running.name ?? "(未設定)" },
      ]
    : [];
  const actions: InspectorAction[] = [
    {
      label: "ビューアで開く",
      onClick: () => handlers.onOpenInViewer(core),
      disabled: handlers.busy || !canAddress,
    },
  ];
  if (running) {
    actions.push({
      label: "停止",
      onClick: () => handlers.onStop(running.target),
      disabled: handlers.busy,
    });
  } else {
    actions.push({
      label: "起動(再開)",
      onClick: () => handlers.onStartResume(core),
      disabled: handlers.busy || !canAddress || handlers.startInputIncomplete,
    });
  }
  // 会話ファイルがまだ無い仮ノード(issue #424)は、モデル属性(会話ファイルから
  // 読むもの)がまだ無いので、その旨だけを出す。
  const modelFields: InspectorField[] = core.provisional
    ? [
        {
          label: "会話ファイル",
          value: "(まだありません。最初のやり取りで作られます)",
        },
        { label: "セッションID", value: core.sessionId ?? "" },
        { label: "cwd(表示補助)", value: core.cwd ?? "(未記録)" },
      ]
    : sessionModelFields(core, conversationFiles);
  return {
    title: truncate(core.sessionTitle ?? "セッション", SESSION_TITLE_MAX_CHARS),
    fields: [
      // 実行中セッション(issue #408)。ノードの枠(色・太さ)だけに頼らず、
      // 状態は必ず文字でも出す。
      { label: "実行状態", value: processStateLabel(running?.process_state ?? null) },
      ...runningFields,
      {
        label: "起動に使うプロファイル",
        value:
          core.ownerProfileName ??
          "(このセッションのリポジトリを対象にしたプロファイルがありません)",
      },
      { label: "フォルダ(project)", value: core.project ?? "(会話ファイルができるまで不明)" },
      ...modelFields,
    ],
    // 起動していないときだけ、起動の入力欄を出す。
    body: running ? undefined : (
      <HubStartSessionForm
        handlers={handlers}
        choices={core.worktreeChoices ?? []}
        allowKeep
        nameNote={RESUME_NAME_NOTE}
      />
    ),
    action: null,
    actions,
  };
}

// 通常のセッションノードで出す、モデル属性(`domain::Session`。issue #197)と
// 表示補助データ(issue #224)の項目。
function sessionModelFields(
  core: HubNodeCore,
  conversationFiles: NonNullable<HubNodeCore["conversationFiles"]>,
): InspectorField[] {
  return [
    { label: "セッションID", value: core.sessionId ?? "" },
    { label: "custom_title", value: core.customTitle ?? "(未設定)" },
    { label: "ai_title", value: core.aiTitle ?? "(未設定)" },
    { label: "mode", value: core.mode ?? "(未設定)" },
    { label: "slug", value: core.slug ?? "(未設定)" },
    { label: "last_prompt", value: core.lastPrompt ?? "(未設定)" },
    // Session.conversation_files/subagent_files(issue #208)。行
    // (LogLine)は遅延読み込みのため、読み込み状態・行数もあわせて
    // 表示する(未読み込みなら「未読み込み」・0件)。conversation_files は
    // issue #217 で1..*になった(worktree移動で同じsession_idのjsonlが
    // 複数フォルダにできるケースに対応)。1件のときは従来どおりの見え方に
    // なる。並びは更新時刻の古い順。改行区切りで複数件を表示する(App.css
    // の `.hub-inspector-field dd` に `white-space: pre-line` を設定済み)。
    {
      label: "会話ファイル",
      value: conversationFiles.map((f) => f.filePath).join("\n"),
    },
    {
      label: "会話ファイルの行",
      value: conversationFiles
        .map((f) => (f.linesLoaded ? `読み込み済み(${f.lineCount}行)` : "未読み込み"))
        .join("\n"),
    },
    {
      label: "サブエージェント数",
      value: String(core.subagentFileCount ?? 0),
    },
    // 表示補助データ(issue #224)。セッション→ブランチの線の根拠を
    // インスペクタで確認できるようにする(`domain::Session`の属性ではない)。
    { label: "cwd(表示補助)", value: core.cwd ?? "(未記録)" },
    { label: "git_branch(表示補助)", value: core.gitBranch ?? "(未記録)" },
  ];
}

// GitRepository(issue #224)。`domain::GitRepository`のモデル属性のみを表示
// する(worktree一覧の詳細は次段のスコープ)。新規セッション(issue #408)は
// このリポジトリを対象にしているプロファイルを起点に作る(無ければ作れない)。
function buildRepositoryInspectorContent(
  core: HubNodeCore,
  handlers: InspectorHandlers,
): InspectorContent {
  return {
    title: truncate(core.repositoryName ?? "リポジトリ", SESSION_TITLE_MAX_CHARS),
    fields: [
      { label: "repository_path", value: core.repositoryPath ?? "" },
      { label: "description", value: core.repositoryDescription || "(未設定)" },
      { label: "ブランチ数", value: String(core.repositoryBranchCount ?? 0) },
      { label: "worktree数", value: String(core.repositoryWorktreeCount ?? 0) },
      {
        label: "新規セッションのプロファイル",
        value:
          core.repositoryProfileName ??
          "(このリポジトリを対象にしたプロファイルがありません)",
      },
    ],
    body: core.repositoryProfileId ? (
      <HubStartSessionForm
        handlers={handlers}
        choices={core.worktreeChoices ?? []}
        allowKeep={false}
      />
    ) : undefined,
    action: null,
    actions: [
      {
        label: "新規セッション",
        onClick: () => handlers.onStartNew(core),
        disabled: handlers.busy || !core.repositoryProfileId || handlers.startInputIncomplete,
      },
    ],
  };
}

// GitWorktree(issue #193 の台帳。ノードとして描くのは #438 から)。
// `domain::GitWorktree` のモデル属性を表示する。
function buildWorktreeInspectorContent(core: HubNodeCore): InspectorContent {
  return {
    title: truncate(core.worktreeName ?? "worktree", SESSION_TITLE_MAX_CHARS),
    fields: [
      { label: "worktree_id", value: core.worktreeId ?? "" },
      { label: "worktree_folder_path", value: core.worktreeFolderPath ?? "" },
      { label: "description", value: core.worktreeDescription || "(未設定)" },
      {
        label: "checked_out_branch",
        value: core.worktreeCheckedOutBranch ?? "(不明)",
      },
      { label: "created_at_time", value: String(core.worktreeCreatedAtTime ?? "") },
    ],
    action: null,
  };
}

// GitBranch(issue #224)。削除済みブランチはバックエンド側で既に除外されて
// いるためノード自体が存在しない。
function buildBranchInspectorContent(core: HubNodeCore): InspectorContent {
  return {
    title: truncate(core.branchName ?? "ブランチ", SESSION_TITLE_MAX_CHARS),
    fields: [
      { label: "branch_id", value: core.branchId ?? "" },
      { label: "description", value: core.branchDescription || "(未設定)" },
      { label: "created_at_time", value: String(core.branchCreatedAtTime ?? "") },
    ],
    action: null,
  };
}

// メインウィンドウの起点となる「俯瞰グラフ」画面(ハブ化 その2。issue #84)。
// オブジェクトモデルのインスタンスビューとして作り直している途中で、第1段
// (issue #214)は `get_pc` で読み込んだ全セッション(User.sessions)のノード
// だけを描いた。第2段(issue #224)で GitRepository/GitBranch のノードと、
// GitRepository→GitBranch・セッション→GitBranch の線を、第3段(issue #229)で
// プロファイルのノードとプロファイル→GitRepository の線を、第4段(issue #283)で
// Pc・User のノードと Pc→User・User→GitRepository の線を戻した。セッション
// 一覧・Git台帳は起動後のバック
// グラウンド読み込み(issue #212)で揃うため、`pc:data_loaded` までは空のまま
// 「読み込み中」を表示する。ノードの右クリックでインスペクタを表示する。
// 左クリックはプロファイルノードだけが持つ(開いていれば前面化、無ければ
// ウィンドウを開く。issue #229)。
// 保存済みのハブのレイアウト(ノード位置・視点。`get_hub_layout`)を読み込んでから
// グラフを描く(issue #268)。視点の復元は Rectum のコンストラクタの `transform`
// (公開されたオプション)で行うため、Rectum を作る前にレイアウトが必要になる
// (Rectum は作ったあと視点を後から設定する公開APIを持たない)。読み込みに失敗
// しても、既定(位置なし・視点なし)で描く。
function HubPage() {
  const [layout, setLayout] = useState<HubLayoutDto | null>(null);
  // 最初に届いた結果だけを使う(`prev ?? next`)。開発時の StrictMode では
  // この effect が2回走り、`getHubLayout` の応答も2回届く。2回目で別の
  // オブジェクトに差し替えると、`initialLayout` に依存する Rectum が
  // (`HubGraphPage` の useMemo で)作り直される。一方、描画部品(assh0le の
  // `Asshole`)はマウント時の Rectum にしか `selector()` を呼ばないため、
  // 作り直された Rectum は画面にマウントされず、ノードが1つも描かれなく
  // なっていた(issue #283 の実機確認で判明)。
  useEffect(() => {
    getHubLayout()
      .then((next) => setLayout((prev) => prev ?? next))
      .catch((e) => {
        console.error(e);
        setLayout((prev) => prev ?? { positions: {}, camera: null });
      });
  }, []);
  if (!layout) return <div className="hub-page" />;
  return <HubGraphPage initialLayout={layout} />;
}

function HubGraphPage({ initialLayout }: { initialLayout: HubLayoutDto }) {
  const [error, setError] = useState<string | null>(null);
  // セッション一覧の取得元(オブジェクトモデル実装。issue #182・#197)。
  const [pc, setPc] = useState<PcDto | null>(null);
  // セッション一覧・Git台帳の読み込み状態(issue #212・#218)。起動直後は
  // `AppState.user_sessions` が空のまま(jsonl走査をバックグラウンド化して
  // 初回表示のラグを無くしたため)なので「読み込み中」として表示する。
  // `pc:data_loaded` イベントはマウント中のハブにしか届かない(#212の
  // 既知の制約。イベント発火後に`/settings`から戻る等で再マウントすると
  // 聞き逃す)ため、`PcDto.data_loaded`(`get_pc` の応答)をこの状態の
  // 唯一の情報源にし、マウント時の問い合わせ(`loadPc`)+イベント購読の
  // 両方から同じ`loadPc`を呼ぶだけにする(イベントとポーリングの二重化は
  // しない)。
  const [pcDataLoaded, setPcDataLoaded] = useState(false);
  // 走査キュー(PoC)の進捗(読み込み中の「n/m」表示用)。null は
  // 進捗が一度も届いていない状態(従来どおり件数なしの表示)。
  const [scanProgress, setScanProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  const loadPc = useCallback((): Promise<void> => {
    return getPc()
      .then((next) => {
        setPc(next);
        setPcDataLoaded(next.data_loaded);
        setError(null);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadPc();
  }, [loadPc]);

  // app が起動している実行中セッション(issue #407・#408)。状態の唯一の情報源は
  // `list_running_sessions` の応答で、`running-session:changed`(状態が変わった・
  // 権限の問い合わせが来た/決着した)が届くたびに取り直す。イベントの中身は
  // 反映せず、必ず一覧を引き直す(楽観更新はしない)。
  const [runningSessions, setRunningSessions] = useState<RunningSessionSummaryDto[]>([]);
  const loadRunningSessions = useCallback((): Promise<void> => {
    return listRunningSessions()
      .then(setRunningSessions)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadRunningSessions();
    const unlistenPromise = onRunningSessionChanged(() => {
      loadRunningSessions();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadRunningSessions]);

  // session_id → 実行中セッション。終了したもの(一覧には残る)は載せず、
  // 未起動と同じ扱いにする。同じ会話の二重起動は backend が止める
  // (`app::ensure_can_start`)ので、実行中のものは session_id で一意になる。
  const runningBySessionId = useMemo(() => {
    const map = new Map<string, RunningSessionSummaryDto>();
    runningSessions.forEach((summary) => {
      if (summary.process_state !== "exited") map.set(summary.session_id, summary);
    });
    return map;
  }, [runningSessions]);

  // 起動後のバックグラウンド読み込み(Git台帳の観測・全プロジェクトの
  // jsonl走査。issue #212)が完了したら`pc`を取り直す(成否によらず発火
  // する。issue #218)。
  // 手動の再読み込みの開始(`pc:data_loading`。issue #245)でも取り直し、
  // `data_loaded` が `false` に戻った状態を反映して「読み込み中」を出す。
  // 開始・完了のどちらも同じ `loadPc` を呼ぶだけで、状態の唯一の情報源は
  // 引き続き `PcDto.data_loaded` (ポーリングは導入しない)。
  // 走査キュー(PoC)の進捗イベントでは、完了したセッションから逐次表示する
  // ため `pc` も取り直す。イベントは1ファイル完了ごとに届き短時間に連発する
  // ため、取り直しは末尾デバウンス(300ms)でまとめる(最終状態は
  // `pc:data_loaded` 側の `loadPc` でも取り直されるため取りこぼさない)。
  // セッションファイルの変更による差分再走査の完了(`pc:sessions_updated`。
  // issue #311)でも同じデバウンスで取り直す(セッションが進行中だと続けて届く)。
  const progressReloadTimer = useRef<number | null>(null);
  useEffect(() => {
    const scheduleReload = () => {
      if (progressReloadTimer.current === null) {
        progressReloadTimer.current = window.setTimeout(() => {
          progressReloadTimer.current = null;
          loadPc();
          // 新規に作った会話が一覧へ現れた直後に枠(実行中の印)が付くよう、
          // 実行中セッションも一緒に取り直す(issue #408)。
          loadRunningSessions();
        }, 300);
      }
    };
    const unlistenPromises = [
      onPcDataLoaded(loadPc),
      onPcDataLoading(loadPc),
      onPcDataProgress((progress) => {
        setScanProgress(progress);
        scheduleReload();
      }),
      onPcSessionsUpdated(scheduleReload),
    ];
    return () => {
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()));
      if (progressReloadTimer.current !== null) {
        window.clearTimeout(progressReloadTimer.current);
        progressReloadTimer.current = null;
      }
    };
  }, [loadPc, loadRunningSessions]);

  // プロファイル(issue #229)。`get_settings` の一覧(id・名前)に、プロファイル
  // ごとの `get_settings(profileId)` の内容(対象リポジトリ等)と、
  // `list_window_states` から引いた開いているウィンドウを合わせる。
  // 1ウィンドウ = 1プロファイル(native.md §6)のため、同じプロファイルを
  // 複数ウィンドウが開いている場合は最初に見つかったウィンドウを使う。
  const [profiles, setProfiles] = useState<HubProfile[]>([]);
  const loadProfiles = useCallback((): Promise<void> => {
    return Promise.all([getSettings(), listWindowStates()])
      .then(([settings, windowStates]) => {
        const windowLabelByProfileId = new Map<string, string>();
        windowStates.forEach((w) =>
          w.tabs.forEach((tab) => {
            if (!windowLabelByProfileId.has(tab.profile_id)) {
              windowLabelByProfileId.set(tab.profile_id, w.label);
            }
          }),
        );
        return Promise.all(
          settings.profiles.map((p) =>
            getSettings(p.id).then(
              (detail): HubProfile => ({
                id: p.id,
                name: p.name,
                repositoryPath: detail.repository_path,
                githubProject: detail.github_project,
                folders: detail.selected_project_folders,
                windowLabel: windowLabelByProfileId.get(p.id),
              }),
            ),
          ),
        );
      })
      .then(setProfiles)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // ウィンドウの開閉ではプロファイルの開閉状態だけが変わる。settings の変更
  // ではプロファイルに加えて登録リポジトリ(`get_pc` が settings から都度
  // 組み立てる)も変わりうるため、`pc` も取り直す(旧実装と同じ流儀。
  // issue #229)。
  useEffect(() => {
    const unlistenPromises = [
      onWindowsChanged(() => {
        loadProfiles();
      }),
      onSettingsUpdated(() => {
        loadProfiles();
        loadPc();
      }),
    ];
    return () => {
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [loadProfiles, loadPc]);

  // プロファイルのウィンドウが開いていれば前面化し、無ければ開く(issue #229。
  // #215 で外した動作をプロファイルノードに限って戻した)。左クリックと
  // インスペクタのボタンの両方から使う。
  const openOrFocusProfile = useCallback((core: HubNodeCore) => {
    if (core.windowLabel) {
      focusWindow(core.windowLabel).catch((e) => console.error(e));
      return;
    }
    if (core.profileId) {
      openProfileWindow(core.profileId).catch((e) => console.error(e));
    }
  }, []);

  const handleNodeClick = useCallback(
    (node: NodeDatum) => {
      const core = node._core as HubNodeCore;
      if (core.kind !== "profile") return;
      openOrFocusProfile(core);
    },
    [openOrFocusProfile],
  );

  // インスペクタからの実行中セッションの操作(issue #408)。押した結果は
  // Query(`listRunningSessions`)で取り直して反映する(先読みで状態を書き
  // 換えない)。`busy` の間はボタンを押せなくして二重の起動・停止を防ぐ
  // (backend も `ensure_can_start` で止めるが、応答を待っている間の見た目の
  // ため)。起動の入力(権限モード・表示名)はインスペクタで選んだノードに
  // 対する一時的な値で、ノードを選び直すと初期値へ戻す。
  const [busy, setBusy] = useState(false);
  const [startMode, setStartMode] = useState<RunningPermissionModeDto>("default");
  const [startName, setStartName] = useState("");
  // 起動するフォルダの指定(issue #438)。既定は「これまでと同じ場所」
  // (再開は会話ファイルの cwd、新規作成はリポジトリ本体)。
  const [startWorktreeKind, setStartWorktreeKind] = useState<StartWorktreeKind>("keep");
  const [startWorktreeId, setStartWorktreeId] = useState("");
  const [startBranchName, setStartBranchName] = useState("");
  // 起動に失敗した理由(worktree の用意の失敗を含む)。押したボタンのすぐ上に出す。
  const [startError, setStartError] = useState<string | null>(null);

  // 選んだ指定を backend の要求の形にする(パスは渡さない。native.md §4)。
  // `null` は「指定しない」で、再開では会話ファイルの cwd がそのまま使われる。
  const startWorktreeSpec = useMemo((): WorktreeSpecDto | null => {
    switch (startWorktreeKind) {
      case "main":
        return { kind: "main" };
      case "existing":
        return startWorktreeId ? { kind: "existing", worktree_id: startWorktreeId } : null;
      case "branch": {
        const branchName = startBranchName.trim();
        return branchName ? { kind: "branch", branch_name: branchName } : null;
      }
      default:
        return null;
    }
  }, [startWorktreeKind, startWorktreeId, startBranchName]);

  // worktree・ブランチ名を選ぶ指定なのに、まだ入力されていない状態。
  const startInputIncomplete =
    (startWorktreeKind === "existing" && startWorktreeId === "") ||
    (startWorktreeKind === "branch" && startBranchName.trim() === "");

  const runInspectorAction = useCallback(
    (action: () => Promise<unknown>) => {
      setBusy(true);
      action()
        .then(() => setError(null))
        .catch((e) => setError(isAppError(e) ? e.message : String(e)))
        .finally(() => {
          setBusy(false);
          loadRunningSessions();
        });
    },
    [loadRunningSessions],
  );

  // 既存の会話を再開する(`--resume`)。cwd は渡さず、プロファイルとフォルダ名
  // ・session_id だけで指定する(native.md §4)。
  // 起動(再開・新規)の操作(issue #438)。失敗の理由は画面上部の共通のエラー
  // 表示ではなく、押したボタンのすぐ上に出す。worktree の用意に失敗したとき
  // (`worktree_sync_failed` など)に、起動できていないことがその場で分かる
  // ようにするため。状態の反映は他の操作と同じく Query の取り直しで行う。
  const runStartAction = useCallback(
    (action: () => Promise<unknown>) => {
      setBusy(true);
      setStartError(null);
      action()
        .then(() => setStartError(null))
        .catch((e) => setStartError(isAppError(e) ? e.message : String(e)))
        .finally(() => {
          setBusy(false);
          loadRunningSessions();
        });
    },
    [loadRunningSessions],
  );

  const handleStartResume = useCallback(
    (core: HubNodeCore) => {
      const { project, sessionId, ownerProfileId } = core;
      if (!project || !sessionId || !ownerProfileId) return;
      runStartAction(() =>
        startRunningSession(ownerProfileId, {
          kind: "resume",
          project,
          session_id: sessionId,
          mode: startMode,
          name: startName.trim() || null,
          // 指定しない(`null`)ときは、会話ファイルに記録された cwd で開く。
          worktree: startWorktreeSpec,
        }),
      );
    },
    [runStartAction, startMode, startName, startWorktreeSpec],
  );

  // 新しい会話を作る。プロファイルノードは自身を、リポジトリノードはその
  // リポジトリを対象にしているプロファイルを起点にする(cwd はそのプロファイル
  // のリポジトリになる)。会話 ID は backend が決める。
  const handleStartNew = useCallback(
    (core: HubNodeCore) => {
      const profileId = core.profileId ?? core.repositoryProfileId;
      if (!profileId) return;
      runStartAction(() =>
        startRunningSession(profileId, {
          kind: "new",
          mode: startMode,
          name: startName.trim() || null,
          // 新規作成は場所を必ず決める(既定はリポジトリ本体)。
          worktree: startWorktreeSpec ?? { kind: "main" },
        }),
      );
    },
    [runStartAction, startMode, startName, startWorktreeSpec],
  );

  const handleStopRunningSession = useCallback(
    (target: RunningSessionRefDto) => {
      runInspectorAction(() => stopRunningSession(target));
    },
    [runInspectorAction],
  );

  // セッションをビューア(プロファイルのウィンドウ)で開く(issue #408・#424)。
  // ビューアが表示するのは「プロファイルごとのセッションタブの並び」
  // (`save_viewer_tabs`。issue #353)なので、まだ無ければそこへ足してから、
  // そのセッションを指定してウィンドウを開く(既に開いていれば前面化して
  // そのセッションへ移動させる)。
  // #408 では `open_profile_window` がプロファイルしか受け取らず「開くだけ・
  // 選択されない」「既に開いているウィンドウには足したタブがすぐ出ない」と
  // いう制約があったが、共有層(issue #422)で `session` 引数と
  // `viewer-tabs:changed` が入ったため、どちらもここで解消している
  // (タブの反映はビューア側が購読して取り直すので、ハブ側の追加処理は不要)。
  const handleOpenInViewer = useCallback(
    (core: HubNodeCore) => {
      const { project, sessionId, ownerProfileId } = core;
      if (!project || !sessionId || !ownerProfileId) return;
      const profile = profiles.find((p) => p.id === ownerProfileId);
      const session = { project, session_id: sessionId };
      runInspectorAction(() =>
        getViewerTabs(ownerProfileId)
          .then((tabs) =>
            tabs.some((tab) => tab.project === project && tab.session_id === sessionId)
              ? undefined
              : saveViewerTabs(ownerProfileId, [...tabs, session]),
          )
          .then(() =>
            profile?.windowLabel
              ? focusWindow(profile.windowLabel, session)
              : openProfileWindow(ownerProfileId, session),
          ),
      );
    },
    [profiles, runInspectorAction],
  );

  const inspectorHandlers: InspectorHandlers = useMemo(
    () => ({
      onOpenProfile: openOrFocusProfile,
      onOpenInViewer: handleOpenInViewer,
      onStartResume: handleStartResume,
      onStop: handleStopRunningSession,
      onStartNew: handleStartNew,
      startMode,
      onStartModeChange: setStartMode,
      startName,
      onStartNameChange: setStartName,
      startWorktreeKind,
      onStartWorktreeKindChange: setStartWorktreeKind,
      startWorktreeId,
      onStartWorktreeIdChange: setStartWorktreeId,
      startBranchName,
      onStartBranchNameChange: setStartBranchName,
      startInputIncomplete,
      startError,
      busy,
    }),
    [
      openOrFocusProfile,
      handleOpenInViewer,
      handleStartResume,
      handleStopRunningSession,
      handleStartNew,
      startMode,
      startName,
      startWorktreeKind,
      startWorktreeId,
      startBranchName,
      startInputIncomplete,
      startError,
      busy,
    ],
  );

  // ノードのドラッグ固定位置(issue #121)。起動時に読み込んだ値(`HubPage` が
  // 渡す `initialLayout`)から始め、ドラッグのたびに更新する。キーは
  // `positionKey`(`buildGraphData` 参照)。`positionsRef`/`cameraRef` は、
  // デバウンス保存(下記)が常に最新の値を参照するための ref。
  const [savedPositions, setSavedPositions] = useState<Record<string, NodePositionDto>>(
    initialLayout.positions,
  );
  const positionsRef = useRef<Record<string, NodePositionDto>>(initialLayout.positions);
  const cameraRef = useRef<CameraDto | null>(initialLayout.camera);

  // `buildGraphData` が直近に払い出した positionKey の集合(issue #121)。
  // 保存時、既に存在しないノードの位置情報をここでフィルタして落とす
  // (`save_hub_layout` はマージではなく丸ごと置き換えのため、呼び出し側で
  // 現在有効な分だけに絞る必要がある)。ref にしているのは、保存タイミング
  // (ドラッグ終了時・デバウンス後)で常に最新の集合を参照したいため。
  const validPositionKeysRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ノード位置と視点(パン・ズーム。issue #268)をまとめて保存する
  // (`save_hub_layout` は丸ごと置き換えのため、どちらか一方だけの保存で
  // もう一方を消さないよう、常に最新の両方を渡す)。
  const saveHubLayoutNow = useCallback(() => {
    saveTimerRef.current = null;
    const validKeys = validPositionKeysRef.current;
    const filtered = Object.fromEntries(
      Object.entries(positionsRef.current).filter(([key]) => validKeys.has(key)),
    );
    saveHubLayout(filtered, cameraRef.current).catch((e) => console.error(e));
  }, []);

  const scheduleSaveHubLayout = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveHubLayoutNow, HUB_LAYOUT_SAVE_DEBOUNCE_MS);
  }, [saveHubLayoutNow]);

  // 画面を離れるとき、デバウンス待ちの変更が残っていれば失わないよう保存する。
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveHubLayoutNow();
      }
    };
  }, [saveHubLayoutNow]);

  // ノードのドラッグ終了時、位置を `savedPositions` に反映しつつ
  // デバウンス保存する(issue #121)。`positionKey` が無いノード(永続化
  // 対象外)は何もしない。
  const handleNodeDragEnded = useCallback(
    (node: NodeDatum) => {
      const core = node._core as HubNodeCore;
      const positionKey = core.positionKey;
      if (!positionKey) return;
      const next = { ...positionsRef.current, [positionKey]: { x: node.x, y: node.y } };
      positionsRef.current = next;
      setSavedPositions(next);
      scheduleSaveHubLayout();
    },
    [scheduleSaveHubLayout],
  );

  // Rectum(命令的API)は初回に一度だけ生成し、以後は同じインスタンスを
  // 使い続ける。`@yanqirenshi/assh0le` の `Colon.data()` は、`selector()`
  // (`Asshole` がマウント時に一度だけ呼ぶ)が設定済みであれば、以後の
  // `.data(newData)` 呼び出しのたびにD3のenter/update/exit差分更新で
  // 再描画するだけで済む(カメラ=パン/ズームには触れない)。データが
  // 変わるたびにRectumを作り直すと、そのたびに視点・ズームが初期状態に
  // リセットされる。`handleNodeDragEnded` は安定しているため、このRectumは
  // `HubPage` のマウント中ずっと同一インスタンスのままになる。
  // 背景のグリッド線は描かない(ユーザー指示)。
  // 保存済みの視点(パン・ズーム。issue #268)は、コンストラクタの `transform`
  // (公開されたオプション)で復元する。d3.svg は初期変換を
  // `d3.zoomIdentity.scale(k).translate(x, y)` で作る(translate は scale の
  // 後なので実際の平行移動は k 倍になる)ため、保存した実際の変換
  // (`onZoom` が渡す `screen = world * k + {x, y}`)を再現するには x/y を k で
  // 割って渡す。
  const rectum = useMemo(() => {
    const camera = initialLayout.camera;
    return new Rectum({
      grid: { draw: false },
      ...(camera ? { transform: { k: camera.k, x: camera.x / camera.k, y: camera.y / camera.k } } : {}),
      callbacks: { node: { click: handleNodeClick, dragEnded: handleNodeDragEnded } },
    });
  }, [handleNodeClick, handleNodeDragEnded, initialLayout]);

  // パン・ズームのたびに現在の視点を控え、デバウンス保存する(issue #268。
  // ノード位置と同じ 500ms の流儀。操作が続く間は保存を延ばし、終わったら
  // 1回だけ保存する)。d3.network(assh0le)の公開メソッド `d3svg().onZoom()` を
  // 使う。`d3svg()` は `Asshole` のマウント(`selector()`)前に呼ぶと例外に
  // なる(マウントは子の描画・サイズ計測の後)ため、公開メソッド `d3Element()`
  // でマウントを待ってから登録する。復元時の初期変換はマウント中(登録前)に
  // 適用済みのため、保存は走らない。
  useEffect(() => {
    let frame = 0;
    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      if (!rectum.d3Element()) {
        frame = requestAnimationFrame(register);
        return;
      }
      rectum.d3svg().onZoom((transform) => {
        cameraRef.current = { x: transform.x, y: transform.y, k: transform.k };
        scheduleSaveHubLayout();
      });
    };
    register();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [rectum, scheduleSaveHubLayout]);

  // データが変わるたびに同じRectumインスタンスへ `.data()` を呼んで更新
  // する。`Asshole` の `rectum.selector()` 呼び出しより先にこのeffectが
  // 走った場合でも、`Colon.data()` は selector 未設定なら描画せず値を保持
  // するだけなので、後から selector が設定された時点で自動的に初回描画される。
  // `savedPositions` はGitRepository/GitBranchノードの位置(issue #224)に
  // 反映するため依存に含める。
  // 実行中セッションの状態(issue #408)はセッションノードの枠に出るため、
  // 変わったら描き直す。
  const dataKey = JSON.stringify({ pc, profiles, runningSessions, savedPositions });
  useEffect(() => {
    // NOTE: `@yanqirenshi/d3.network` の `Edges.js`(`draw()`)には、IDが
    // 一致した既存の辺要素(本来は「更新」として残すべきもの)まで無条件に
    // `remove()` してしまうバグがある(`Nodes.js` 側は `exit()` のみを
    // 正しく削除しており影響を受けない)。2回目以降の `.data()` 呼び出しで
    // 辺(接続線)だけが全部消えてノードだけが残る状態になるため、ライブラリ
    // 本体の修正待ちの間、ここで毎回いったん既存の辺要素を明示的に空にして
    // から `.data()` を呼び、ライブラリの `enter()` が必ず全辺を新規追加として
    // 作り直すようにする(辺自体は保持すべき状態を持たないため実害はない)。
    hubPageRef.current?.querySelectorAll("path.ng-edge").forEach((el) => el.remove());
    // 描画中のノードの現在位置(force シミュレーションで動いた後の値)。
    // d3 のデータ結合は各 `g.ng-node` の `__data__` にノードのデータを載せる
    // (右クリックのインスペクタと同じ取り方。issue #226)。
    const currentPositions = new Map<string, NodePositionDto>();
    hubPageRef.current?.querySelectorAll("g.ng-node").forEach((el) => {
      const datum = (el as Element & { __data__?: NodeDatum }).__data__;
      if (datum) currentPositions.set(datum.id, { x: datum.x, y: datum.y });
    });
    const { nodes, edges, positionKeys } = buildGraphData(
      pc,
      profiles,
      runningBySessionId,
      savedPositions,
      currentPositions,
    );
    validPositionKeysRef.current = positionKeys;
    rectum.data({ nodes, edges });
    // 辺ごとの色はライブラリが読まないため、描いた直後に上書きする(issue #438)。
    applyRunningWorktreeEdgeColor(hubPageRef.current);
    restartSimulation(rectum);
    // 開いているインスペクタの中身を、描き直したノードの値で更新する
    // (issue #424)。仮ノードが会話ファイルのできた通常のノードへ置き換わった
    // ときに、選択を保ったまま中身(フォルダ名・会話ファイル等)が最新になる。
    // 対象のノードが消えたときは直前の値をそのまま残す(パネルを閉じるのは
    // ×・Esc・グラフの空白部のクリックだけにする)。
    setInspectorCore((prev) => {
      if (!prev) return prev;
      const id = nodeIdOfCore(prev);
      if (!id) return prev;
      const groups = Array.from(hubPageRef.current?.querySelectorAll("g.ng-node") ?? []);
      const hit = groups.find(
        (el) => (el as Element & { __data__?: NodeDatum }).__data__?.id === id,
      ) as (Element & { __data__?: NodeDatum }) | undefined;
      return (hit?.__data__?._core as HubNodeCore | undefined) ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectum, dataKey]);

  // ノードの右クリックでインスペクタ(issue #109)を表示する。d3.network の
  // ノードAPI(node.click等)にcontextmenuの仕組みが無いため、描画後のDOMへ
  // イベント委任で直接バインドする(d3のデータ結合(`selection.data()`)は
  // DOM要素の `__data__` にその要素のデータを直接載せる仕様のため、右クリック
  // された要素の祖先から `g.ng-node` を辿ればノードの生データ(`_core` を
  // 含む)が取れる)。`.hub-page` 自体はデータが変わっても作り直されない
  // ため、委任先の要素は安定しており、購読はマウント時の1回だけでよい。
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

  // 別のノードを選んだら、起動の入力(権限モード・表示名)を初期値へ戻す
  // (前のノードで入れた表示名が残らないようにする。issue #408)。
  // 見るのは選んでいるノードのIDで、`inspectorCore` そのものではない。core は
  // グラフを描き直すたびに新しい値へ差し替える(issue #424)ため、それを
  // 見てしまうと、同じノードを見ている最中の再描画(実行中セッションの状態
  // 変化など)で入力中の表示名が消えてしまう。
  const inspectorNodeId = inspectorCore ? nodeIdOfCore(inspectorCore) : null;
  const inspectorNodeKind = inspectorCore?.kind ?? null;
  useEffect(() => {
    setStartMode("default");
    setStartName("");
    // 再開は「会話ファイルのフォルダのまま」、新規作成は「リポジトリ本体」を
    // 既定にする(issue #438。どちらも、これまでと同じ場所で起動する選択)。
    setStartWorktreeKind(inspectorNodeKind === "session" ? "keep" : "main");
    setStartWorktreeId("");
    setStartBranchName("");
    setStartError(null);
  }, [inspectorNodeId, inspectorNodeKind]);

  // グラフの調整メニュー(issue #246・#249)。値は `hub-tuning.json` に保存し
  // (スライダー変更後に `HUB_TUNING_SAVE_DEBOUNCE_MS` でまとめて保存)、
  // マウント時に読み込んで復元する。変更は即座にシミュレーションへ反映する
  // (d3.network 0.6 の公開API `rectum.simulation.configure()`。指定した項目
  // だけ上書きし alpha(1) で動かし直すため、動きが見える)。`link.strength` の
  // 「既定」(`null`)は d3-force の既定(次数依存)のままにするため、
  // シミュレーションへ渡さない。
  const [tuningOpen, setTuningOpen] = useState(false);
  const [tuning, setTuning] = useState<HubTuning>(DEFAULT_HUB_TUNING);
  const tuningRef = useRef<HubTuning>(DEFAULT_HUB_TUNING);
  const tuningSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveTuning = useCallback(() => {
    tuningSaveTimerRef.current = null;
    const t = tuningRef.current;
    saveHubTuning({
      link_distance: t.linkDistance,
      link_strength: t.linkStrength,
      charge_strength: t.chargeStrength,
      collide_radius: t.collideRadius,
    }).catch((e) => console.error(e));
  }, []);

  // 保存済みの調整値を復元して適用する。既定値のままなら何もしない
  // (シミュレーションを無駄に動かし直さない)。
  useEffect(() => {
    getHubTuning()
      .then((dto) => {
        const restored: HubTuning = {
          linkDistance: dto.link_distance,
          linkStrength: dto.link_strength,
          chargeStrength: dto.charge_strength,
          collideRadius: dto.collide_radius,
        };
        if (JSON.stringify(restored) === JSON.stringify(DEFAULT_HUB_TUNING)) return;
        tuningRef.current = restored;
        setTuning(restored);
        rectum.simulation.configure({
          link: {
            distance: restored.linkDistance,
            ...(restored.linkStrength === null ? {} : { strength: restored.linkStrength }),
          },
          charge: { strength: restored.chargeStrength },
          collide: { radius: restored.collideRadius },
        });
      })
      .catch((e) => console.error(e));
  }, [rectum]);

  // 画面を離れるとき、デバウンス待ちの変更が残っていれば失わないよう保存する。
  useEffect(() => {
    return () => {
      if (tuningSaveTimerRef.current) {
        clearTimeout(tuningSaveTimerRef.current);
        saveTuning();
      }
    };
  }, [saveTuning]);

  const handleTuningChange = useCallback(
    (key: keyof HubTuning, value: number) => {
      const next = { ...tuningRef.current, [key]: value };
      tuningRef.current = next;
      setTuning(next);
      switch (key) {
        case "linkDistance":
          rectum.simulation.configure({ link: { distance: value } });
          break;
        case "linkStrength":
          rectum.simulation.configure({ link: { strength: value } });
          break;
        case "chargeStrength":
          rectum.simulation.configure({ charge: { strength: value } });
          break;
        case "collideRadius":
          rectum.simulation.configure({ collide: { radius: value } });
          break;
      }
      if (tuningSaveTimerRef.current) clearTimeout(tuningSaveTimerRef.current);
      tuningSaveTimerRef.current = setTimeout(saveTuning, HUB_TUNING_SAVE_DEBOUNCE_MS);
    },
    [rectum, saveTuning],
  );

  // 閉じる: ×(HubInspector側)・グラフの空白部クリック・Esc(issue #109)。
  const handleHubPageClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest("g.ng-node")) return;
    setInspectorCore(null);
    setTuningOpen(false);
  }, []);

  useEffect(() => {
    if (!inspectorCore) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspectorCore(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inspectorCore]);

  // インスペクタが持つノードの値(`_core`)は右クリックした時点のもの。実行中
  // セッションの状態はその後も変わるので、表示の直前に Query で取り直した一覧
  // (`runningBySessionId`)から引き直す(issue #408)。
  const inspectorRunning =
    inspectorCore?.kind === "session" && inspectorCore.sessionId
      ? (runningBySessionId.get(inspectorCore.sessionId) ?? null)
      : null;
  const inspectorContent = inspectorCore
    ? buildInspectorContent(inspectorCore, inspectorHandlers, inspectorRunning)
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

  // dock の「domain データを再読み込み」操作(issue #243)。`reconcile_git_state`
  // はGit台帳の再観測に加えて
  // 全プロジェクトの `Session` 一覧も組み立て直す(issue #193・#197)ため、
  // これを呼んでから `getPc` で取り直すとセッションの増減が反映される。
  // 失敗しても(fail-safe)`getPc` は必ず呼び直す。`pcDataLoaded` は
  // `loadPc` が応答の `data_loaded` から都度導出するため、ここで個別に
  // 更新する必要は無い(issue #218)。
  const handleReload = useCallback((): Promise<void> => {
    const reloadPc = reconcileGitState()
      .catch((e) => console.error(e))
      .then(() => loadPc());
    return Promise.all([reloadPc, loadProfiles()]).then(() => undefined);
  }, [loadPc, loadProfiles]);

  // dock の「配置をリセット」(issue #121・#226)はユーザー指示で削除した。
  const dockItems = useMemo(
    () => [
      {
        // ハブ固有の「domain データ再読み込み」(issue #243)。他画面の汎用
        // 更新と同じ見た目にしないため、専用のアイコンと文言にする。
        id: "hub-reload-domain",
        label: DOMAIN_RELOAD_ICON,
        title: "domain データを再読み込み",
        onClick: handleReload,
      },
      {
        // グラフの調整メニュー(issue #246)。吹き出しは command-dock の
        // `popup`(テキスト項目のみ)ではスライダーを置けないため、即アクション型
        // にして、開閉するだけ。吹き出し自体は下の `HubTuningPopover`。
        id: "hub-tuning",
        label: TUNING_ICON,
        title: "グラフの調整",
        onClick: () => setTuningOpen((open) => !open),
        // 吹き出しの開閉状態(枠線・選択色に反映。issue #255。AppDock 参照)。
        popupOpen: tuningOpen,
      },
    ],
    [handleReload, tuningOpen],
  );
  usePageDockItems(dockItems);

  return (
    <div className="hub-page" ref={hubPageRef} onClick={handleHubPageClick}>
      {error && <p className="error">{error}</p>}
      {!pcDataLoaded && (
        <p className="hub-loading">
          セッションを読み込み中…
          {scanProgress && ` (${scanProgress.completed}/${scanProgress.total})`}
        </p>
      )}
      {/* `rectum` はマウント中ずっと同一インスタンス(上記参照)なので、
          `key` は付けない。`key` を付けて`dataKey`が変わるたびに強制再
          マウントすると、そのたびにカメラ(パン/ズーム)がリセットされて
          しまう。 */}
      <D3Network rectum={rectum} />
      {tuningOpen && <HubTuningPopover values={tuning} onChange={handleTuningChange} />}
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
