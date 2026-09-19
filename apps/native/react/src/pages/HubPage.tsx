import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import D3Network, { Rectum } from "@yanqirenshi/d3.network";
import type { NodeDatum } from "@yanqirenshi/d3.network";
import {
  focusWindow,
  getHubLayout,
  getPc,
  getSettings,
  isAppError,
  listWindowStates,
  onPcDataLoaded,
  onSettingsUpdated,
  onWindowsChanged,
  openProfileWindow,
  reconcileGitState,
  saveHubLayout,
} from "../api";
import type {
  GitBranchDto,
  GitRepositoryDto,
  GithubProjectDto,
  NodePositionDto,
  PcDto,
  SessionDto,
} from "../api";
import { usePageDockItems } from "../DockItemsContext";
import { RELOAD_ICON } from "../icons";
import { HUB_NODE_ICON_URIS } from "../hubNodeIcons";
import HubInspector from "../HubInspector";
import type { InspectorContent } from "../HubInspector";

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

// プロファイル/GitRepository/GitBranch ノードの配置(ハブ再構築 第2〜3段。
// issue #224・#229)。左からプロファイル列・リポジトリ列・ブランチ列を縦に
// 並べ、セッションのグリッドはその右側から始める。位置は並び順
// (`buildGraphData`参照)で決まるだけの簡易な整列で、ドラッグで動かせる
// (`move: "support"`)ため実装時点では見やすさよりも「エッジが追える」ことを
// 優先する。第3段でプロファイル列を一番左に足したため、他の列は1列ぶん右へ
// ずらした(保存済みの位置があるノードはその位置のまま)。
const PROFILE_COLUMN_X = 80;
const REPOSITORY_COLUMN_X = 320;
const BRANCH_COLUMN_X = 560;
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
// 原点のxはプロファイル/GitRepository/GitBranch列(issue #224・#229)と
// 重ならない位置まで右へ寄せる。
const SESSION_GRID_ORIGIN = { x: 800, y: 70 };
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
// GitRepository/GitBranch ノードを、第3段(issue #229)でプロファイルノードを
// 戻した。フィールドはインスペクタ(issue #109)の表示と、プロファイルノードの
// 左クリック(ウィンドウの前面化/新規オープン)に使う。
type HubNodeCore = {
  kind: "session" | "git-repository" | "git-branch" | "profile";
  // ドラッグ位置の永続化(issue #121)に使う安定キー。位置を保存する
  // ノードにのみ設定する(セッションノードは force シミュレーションに委ねる
  // ため保存しない。issue #226)。GitRepository/GitBranch ノード(issue #224)は
  // 台帳の個体指定子(repository_path/branch_id)由来のキーで保存する。
  positionKey?: string;
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

// `pc`(`get_pc`)と settings のプロファイルから、プロファイルノード(ハブ
// 再構築 第3段。issue #229)、GitRepository/GitBranch ノード(第2段。
// issue #224)、セッションノード(第1段。issue #214)を組み立てる。表示対象は
// 全プロファイル、登録済みリポジトリ(`User.repositories`)とその現存ブランチ
// (削除済みはバックエンド側で除外済み)、および全セッション(`User.sessions`。
// `~/.claude/projects` 全体で、プロファイルの対象フォルダ設定とは無関係)。
// Pc・User ノードは引き続き表示しない。backend は全ユーザーに同じ一覧を
// 割り当てる(`app::pc_with_user_sessions`/`app::current_pc_with_repositories`)
// ため、重複させないよう先頭ユーザーの分だけを使う。d3.network はノードに
// x/y が必須のため、座標は列・格子の位置として自前で計算する。
function buildGraphData(
  pc: PcDto | null,
  profiles: HubProfile[],
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
      circle: { r: 20, ...INVISIBLE_NODE_CIRCLE },
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
  });

  return { nodes, edges, positionKeys };
}

// ノードの `_core`(issue #109)からインスペクタの表示内容を組み立てる。
// 追加のbackend呼び出しはせず、グラフ構築時に `_core` へ埋め込んだ値のみを
// 使う。アクションはプロファイルノードの「前面化/ウィンドウで開く」だけで
// (issue #229)、他のノードは持たない(issue #214)。ノード種別(issue #224・
// #229でセッション以外も追加)ごとに表示内容を分ける。
function buildInspectorContent(
  core: HubNodeCore,
  onOpenProfile: (core: HubNodeCore) => void,
): InspectorContent {
  if (core.kind === "profile") return buildProfileInspectorContent(core, onOpenProfile);
  if (core.kind === "git-repository") return buildRepositoryInspectorContent(core);
  if (core.kind === "git-branch") return buildBranchInspectorContent(core);
  return buildSessionInspectorContent(core);
}

// プロファイル(issue #229)。settings の内容とウィンドウの開閉状態を表示し、
// 左クリックと同じ操作(前面化/ウィンドウで開く)をボタンでも出す。
function buildProfileInspectorContent(
  core: HubNodeCore,
  onOpenProfile: (core: HubNodeCore) => void,
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
      onClick: () => onOpenProfile(core),
    },
  };
}

function buildSessionInspectorContent(core: HubNodeCore): InspectorContent {
  const conversationFiles = core.conversationFiles ?? [];
  return {
    title: truncate(core.sessionTitle ?? "セッション", SESSION_TITLE_MAX_CHARS),
    fields: [
      // モデル属性(`domain::Session`。issue #197)。
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
    ],
    action: null,
  };
}

// GitRepository(issue #224)。`domain::GitRepository`のモデル属性のみを表示
// する(worktree一覧の詳細は次段のスコープ)。
function buildRepositoryInspectorContent(core: HubNodeCore): InspectorContent {
  return {
    title: truncate(core.repositoryName ?? "リポジトリ", SESSION_TITLE_MAX_CHARS),
    fields: [
      { label: "repository_path", value: core.repositoryPath ?? "" },
      { label: "description", value: core.repositoryDescription || "(未設定)" },
      { label: "ブランチ数", value: String(core.repositoryBranchCount ?? 0) },
      { label: "worktree数", value: String(core.repositoryWorktreeCount ?? 0) },
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
// プロファイルのノードとプロファイル→GitRepository の線を戻した(Pc・Userの
// ノードは引き続き表示しない)。セッション一覧・Git台帳は起動後のバック
// グラウンド読み込み(issue #212)で揃うため、`pc:data_loaded` までは空のまま
// 「読み込み中」を表示する。ノードの右クリックでインスペクタを表示する。
// 左クリックはプロファイルノードだけが持つ(開いていれば前面化、無ければ
// ウィンドウを開く。issue #229)。
function HubPage() {
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

  // 起動後のバックグラウンド読み込み(Git台帳の観測・全プロジェクトの
  // jsonl走査。issue #212)が完了したら`pc`を取り直す(成否によらず発火
  // する。issue #218)。
  useEffect(() => {
    const unlistenPromise = onPcDataLoaded(() => {
      loadPc();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadPc]);

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

  // ノードのドラッグ固定位置(issue #121)。起動時に一度だけ読み込み、以後は
  // ドラッグのたびに更新する。キーは `positionKey`(`buildGraphData` 参照)。
  const [savedPositions, setSavedPositions] = useState<Record<string, NodePositionDto>>({});
  useEffect(() => {
    getHubLayout()
      .then((layout) => setSavedPositions(layout.positions))
      .catch((e) => console.error(e));
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
  // デバウンス保存する(issue #121)。`positionKey` が無いノード(永続化
  // 対象外)は何もしない。
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
  // 再描画するだけで済む(カメラ=パン/ズームには触れない)。データが
  // 変わるたびにRectumを作り直すと、そのたびに視点・ズームが初期状態に
  // リセットされる。`handleNodeDragEnded` は安定しているため、このRectumは
  // `HubPage` のマウント中ずっと同一インスタンスのままになる。
  // 背景のグリッド線は描かない(ユーザー指示)。
  const rectum = useMemo(() => {
    return new Rectum({
      grid: { draw: false },
      callbacks: { node: { click: handleNodeClick, dragEnded: handleNodeDragEnded } },
    });
  }, [handleNodeClick, handleNodeDragEnded]);

  // データが変わるたびに同じRectumインスタンスへ `.data()` を呼んで更新
  // する。`Asshole` の `rectum.selector()` 呼び出しより先にこのeffectが
  // 走った場合でも、`Colon.data()` は selector 未設定なら描画せず値を保持
  // するだけなので、後から selector が設定された時点で自動的に初回描画される。
  // `savedPositions` はGitRepository/GitBranchノードの位置(issue #224)に
  // 反映するため依存に含める。
  const dataKey = JSON.stringify({ pc, profiles, savedPositions });
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
      savedPositions,
      currentPositions,
    );
    validPositionKeysRef.current = positionKeys;
    rectum.data({ nodes, edges });
    restartSimulation(rectum);
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

  // 閉じる: ×(HubInspector側)・グラフの空白部クリック・Esc(issue #109)。
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
    ? buildInspectorContent(inspectorCore, openOrFocusProfile)
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

  // 「再読み込み」操作。`reconcile_git_state` はGit台帳の再観測に加えて
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
        id: "hub-reload",
        label: RELOAD_ICON,
        title: "再読み込み",
        onClick: handleReload,
      },
    ],
    [handleReload],
  );
  usePageDockItems(dockItems);

  return (
    <div className="hub-page" ref={hubPageRef} onClick={handleHubPageClick}>
      {error && <p className="error">{error}</p>}
      {!pcDataLoaded && <p className="hub-loading">セッションを読み込み中…</p>}
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
