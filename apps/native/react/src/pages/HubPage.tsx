import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import D3Network, { Rectum } from "@yanqirenshi/d3.network";
import type { NodeDatum } from "@yanqirenshi/d3.network";
import {
  getHubLayout,
  getPc,
  isAppError,
  onPcDataLoaded,
  reconcileGitState,
  saveHubLayout,
} from "../api";
import type { NodePositionDto, PcDto, SessionDto } from "../api";
import { usePageDockItems } from "../DockItemsContext";
import { LAYOUT_RESET_ICON, RELOAD_ICON } from "../icons";
import { HUB_NODE_ICON_URIS } from "../hubNodeIcons";
import HubInspector from "../HubInspector";
import type { InspectorContent } from "../HubInspector";

// 伝統色パレット(App.css の :root/tokens.css と同じ値。issue #84・#93)。
const COLOR_PEARL = "#fbfbf8"; // 真珠
const COLOR_KYO_MURASAKI = "#9d5b8b"; // 京紫(session)
const COLOR_SUMI = "#373737"; // 墨

// セッションノードの配置(ハブ再構築 第1段。issue #214 の仕様変更コメント)。
// セッションノードだけでエッジが無いため、force に任せると d3.network の
// シミュレーション(反発力と衝突のみ。中心への引力は無く、外から足す API も
// 無い)では互いに押し合って際限なく広がり続ける。そこで整列(グリッド)に
// する。`move: "support"` で格子の位置に留めつつ、ドラッグでは動かせる。
// 列数は横長の画面に合わせて「行数 × 1.5 ≒ 列数」になるよう決める
// (141件なら15列 × 10行)。
const SESSION_GRID_ORIGIN = { x: 80, y: 70 };
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

// 右クリック時に何を表示するかを判定するための、ノードの元データ(`_core`)。
// 第1段はセッションノードのみ(ハブ再構築 第1段。issue #214)。フィールドは
// インスペクタ(issue #109)の表示専用。
type HubNodeCore = {
  kind: "session";
  // ドラッグ位置の永続化(issue #121)に使う安定キー。位置を保存する
  // ノードにのみ設定する(第1段のセッションノードは格子に並べるだけで、
  // 位置は保存しない)。
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

// `pc`(`get_pc`)から、読み込んだ全セッションのノードだけを組み立てる
// (ハブ再構築 第1段。issue #214 の仕様変更コメント: Pc・User ノードと
// 階層エッジは表示しない)。セッションは `pc.users[].sessions` の全件
// (~/.claude/projects 全体。プロファイルの対象フォルダ設定とは無関係)。
// backend は全ユーザーに同じ一覧を割り当てる(`app::pc_with_user_sessions`)
// ため、重複させないよう先頭ユーザーの分だけを使う。d3.network はノードに
// x/y が必須のため、座標は格子の位置として自前で計算する。
function buildGraphData(pc: PcDto | null) {
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  // 現在のグラフに実在する positionKey の集合(issue #121)。保存時、既に
  // 存在しないノードの位置情報をここで自然に除外する(呼び出し側が保存前に
  // この集合でフィルタする)。第1段では位置を保存するノードが無いため空。
  const positionKeys = new Set<string>();

  const sessions = pc?.users[0]?.sessions ?? [];
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
    nodes.push({
      id: sessionNodeId,
      x: SESSION_GRID_ORIGIN.x + (i % columns) * SESSION_GRID_CELL_WIDTH,
      y: SESSION_GRID_ORIGIN.y + Math.floor(i / columns) * SESSION_GRID_CELL_HEIGHT,
      move: "support",
      label: {
        text: truncate(title, SESSION_LABEL_MAX_CHARS),
        fill: COLOR_SUMI,
        font: { size: 12 },
        y: labelYBelowCircle(20),
      },
      circle: { r: 20, fill: COLOR_PEARL, stroke: { color: COLOR_KYO_MURASAKI, width: 2 } },
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
    });
  });

  return { nodes, edges, positionKeys };
}

// ノードの `_core`(issue #109)からインスペクタの表示内容を組み立てる。
// 追加のbackend呼び出しはせず、グラフ構築時に `_core` へ埋め込んだ値のみを
// 使う。第1段ではノードからウィンドウを開く動線を持たないため、アクションは
// 無し(issue #214)。
function buildInspectorContent(core: HubNodeCore): InspectorContent {
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
    ],
    action: null,
  };
}

// メインウィンドウの起点となる「俯瞰グラフ」画面(ハブ化 その2。issue #84)。
// オブジェクトモデルのインスタンスビューとして作り直している途中で、第1段
// (issue #214)は `get_pc` で読み込んだ全セッション(User.sessions)のノード
// だけを描く。セッション一覧は起動後のバックグラウンド読み込み(issue #212)で
// 揃うため、`pc:data_loaded` までは空のまま「読み込み中」を表示する。ノードの
// 右クリックでインスペクタを表示する(左クリックの動作は第1段では持たない)。
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
  const rectum = useMemo(() => {
    return new Rectum({
      callbacks: { node: { dragEnded: handleNodeDragEnded } },
    });
  }, [handleNodeDragEnded]);

  // データが変わるたびに同じRectumインスタンスへ `.data()` を呼んで更新
  // する。`Asshole` の `rectum.selector()` 呼び出しより先にこのeffectが
  // 走った場合でも、`Colon.data()` は selector 未設定なら描画せず値を保持
  // するだけなので、後から selector が設定された時点で自動的に初回描画される。
  // `savedPositions` は第1段のグラフ内容には影響しないが、位置を保存する
  // ノードを再導入したとき(次段以降)に取りこぼさないよう依存に含めておく。
  const dataKey = JSON.stringify({ pc, savedPositions });
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
    const { nodes, edges, positionKeys } = buildGraphData(pc);
    validPositionKeysRef.current = positionKeys;
    rectum.data({ nodes, edges });
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

  const inspectorContent = inspectorCore ? buildInspectorContent(inspectorCore) : null;

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

  // 「再読み込み」操作。`reconcile_git_state` はGit台帳の再観測に加えて
  // 全プロジェクトの `Session` 一覧も組み立て直す(issue #193・#197)ため、
  // これを呼んでから `getPc` で取り直すとセッションの増減が反映される。
  // 失敗しても(fail-safe)`getPc` は必ず呼び直す。`pcDataLoaded` は
  // `loadPc` が応答の `data_loaded` から都度導出するため、ここで個別に
  // 更新する必要は無い(issue #218)。
  const handleReload = useCallback((): Promise<void> => {
    return reconcileGitState()
      .catch((e) => console.error(e))
      .then(() => loadPc());
  }, [loadPc]);

  const dockItems = useMemo(
    () => [
      {
        id: "hub-reload",
        label: RELOAD_ICON,
        title: "再読み込み",
        onClick: handleReload,
      },
      {
        id: "hub-reset-layout",
        label: LAYOUT_RESET_ICON,
        title: "配置をリセット",
        onClick: handleResetLayout,
      },
    ],
    [handleReload, handleResetLayout],
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
