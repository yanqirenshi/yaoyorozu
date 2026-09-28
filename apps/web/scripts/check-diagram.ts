/**
 * apps/web の図のページ(/class-diagram・/tm・/sitemap)を headless の Microsoft Edge で開き、
 * 箱の重なり・線の交差・枠からのはみ出し・コンソールエラーの有無をコマンドで確認する。
 *
 *   npm run web:check-diagram -- class-diagram --expect-count=227
 *   npm run web:check-diagram -- tm --expect-count=30
 *   npm run web:check-diagram -- sitemap
 *
 * これまで各セッションは Claude Desktop のブラウザのペイン(preview_start /
 * javascript_tool / read_console_messages)で描画と幾何を確かめてきたが、Desktop から
 * yaoyorozu app へ移行したセッションはそのペインを使えない(#462)。
 * PC に入っている Microsoft Edge を画面なし(headless)で起動し、
 * Chrome DevTools Protocol(CDP)に Node 標準の fetch / WebSocket だけで繋ぐ
 * (playwright / puppeteer 等は追加しない。apps/native の開発版を CDP で確認する方法
 * (native-dev-verify-from-worktree メモ)と同じやり方)。
 *
 * ポートの取り違え事故(2026-09-25、他セッションの開発サーバ・CDP に繋いでしまった)の
 * 再発防止のため、
 * - Edge は毎回ちがう一時プロフィール・`--remote-debugging-port=0`(OS が空きポートを
 *   割り当てる)で起動し、実際のポートは Edge が書き出す `DevToolsActivePort` から読む。
 *   固定ポートを推測して繋ぐことがないので、他セッションの Edge に繋がりようがない。
 * - 開発サーバは、指定 URL(既定 http://localhost:3000)にこのアプリ(タイトルが
 *   「YAOYOROZU」)が既に応答していればそれを使い、無ければこのスクリプトが空きポートで
 *   自分の Next.js を起動し、終わったら止める。
 *
 * Node は 24 以上を前提とし、TypeScript のまま実行する(型注釈は実行時に取り除かれる。
 * scripts/generate-tokens.ts と同じ)。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

/* ==================================================================== *
 *   図ごとの定義(対象パス・描画完了の目印・計測スクリプト)
 * ==================================================================== */

type DiagramName = "class-diagram" | "tm" | "sitemap";

type MeasureResult = Record<string, unknown> & { error?: string };

type DiagramSpec = {
  /** ページのパス。 */
  path: string;
  /** 描画が終わったとみなす目印(このセレクタが現れるまで待つ)。 */
  readySelector: string;
  /** ブラウザ内で実行して計測する関数。DOM 以外(Node 側の変数)は参照できない。 */
  measure: () => MeasureResult;
  /** --expect-count と比較する、measure() の返り値のキー。 */
  countKey: string;
};

type Rect = { left: number; top: number; right: number; bottom: number };

/** 箱2つが重なっているか(screen 座標の軸並行な矩形どうし)。 */
function rectsIntersect(a: Rect, b: Rect): boolean {
  const EPS = 1; // わずかな誤差(サブピクセル)は重なりに数えない
  return (
    a.left < b.right - EPS &&
    b.left < a.right - EPS &&
    a.top < b.bottom - EPS &&
    b.top < a.bottom - EPS
  );
}

/** a が b をすっぽり包んでいるか(サイトマップのタブのように、意図して内側に置く場合)。 */
function rectFullyContains(a: Rect, b: Rect): boolean {
  const EPS = 1;
  return (
    a.left <= b.left + EPS &&
    a.top <= b.top + EPS &&
    a.right >= b.right - EPS &&
    a.bottom >= b.bottom - EPS
  );
}

/**
 * 箱2つが「不正に」重なっているか。一方が他方をすっぽり包んでいる場合は、
 * サイトマップの親ノードとタブの子ノードのように意図した入れ子とみなし、
 * 重なりに数えない(d3.sitemap は親子を別々の `g.node` として並べて描き、
 * 子の座標を親の内側の絶対位置に変換するだけで、DOM 上は親子関係を持たない)。
 */
function rectsOverlap(a: Rect, b: Rect): boolean {
  if (!rectsIntersect(a, b)) return false;
  if (rectFullyContains(a, b) || rectFullyContains(b, a)) return false;
  return true;
}

/** g.class-box(またはそれに準じるグループ)の直下のテキストが、箱の外へはみ出していないか。 */
function findTextOverflow(
  boxEl: Element,
  boxRect: { left: number; top: number; right: number; bottom: number },
  isOwnText: (text: Element) => boolean,
): boolean {
  const EPS = 1;
  const texts = boxEl.querySelectorAll("text");
  for (const t of Array.from(texts)) {
    if (!isOwnText(t)) continue;
    const r = t.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // 空文字
    if (r.left < boxRect.left - EPS || r.right > boxRect.right + EPS) return true;
  }
  return false;
}

/**
 * 線分 a・b が(端点近くでの単なる接触を除いて)実際に交差しているか。
 * ノード同士を結ぶ線は箱の縁のちょうど1点で接するので、端点近傍(EPS)は除外する。
 */
function segmentsCross(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false; // 平行
  const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / denom;
  const u = ((b.x1 - a.x1) * d1y - (b.y1 - a.y1) * d1x) / denom;
  const EPS = 0.02;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}

/**
 * 線分が箱の内部を(端点で触れるだけでなく)実際に横切っているか。
 * Liang-Barsky のクリッピングで、矩形との交差区間 [t0, t1] の長さが実質ゼロなら
 * 「縁で触れているだけ」として横切りに数えない。
 */
function segmentCrossesRect(
  seg: { x1: number; y1: number; x2: number; y2: number },
  box: { left: number; top: number; right: number; bottom: number },
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const p = [-dx, dx, -dy, dy];
  const q = [seg.x1 - box.left, box.right - seg.x1, seg.y1 - box.top, box.bottom - seg.y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t1 - t0 > 1e-6;
}

/**
 * ブラウザに渡す関数を文字列化し、その場で呼び出す式にする。
 * 計測関数は rectsOverlap・findTextOverflow・segmentsCross・segmentCrossesRect を
 * 自由変数として参照するので、同じスコープに const 宣言として持ち込んでから呼び出す
 * (Runtime.evaluate は1つの式しか渡せないため、ヘルパーは別送りにできない)。
 */
function toEvalExpression(fn: () => unknown): string {
  return `(() => {
    const rectsIntersect = ${rectsIntersect.toString()};
    const rectFullyContains = ${rectFullyContains.toString()};
    const rectsOverlap = ${rectsOverlap.toString()};
    const findTextOverflow = ${findTextOverflow.toString()};
    const segmentsCross = ${segmentsCross.toString()};
    const segmentCrossesRect = ${segmentCrossesRect.toString()};
    return (${fn.toString()})();
  })()`;
}

/* -------------------- /class-diagram(d3.classes) -------------------- */

function measureClassDiagram(): MeasureResult {
  const svg = document.querySelector("svg.class-diagram");
  if (!svg) return { error: "svg.class-diagram が見つからない" };

  const boxEls = Array.from(document.querySelectorAll("g.class-box"));
  if (boxEls.length === 0) return { error: "g.class-box が見つからない" };

  const boxes = boxEls.map((g) => {
    const body = g.querySelector("rect.box-body") as Element;
    const r = (body ?? g).getBoundingClientRect();
    return {
      id: g.getAttribute("data-id") ?? "",
      el: g,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    };
  });

  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (rectsIntersect(boxes[i], boxes[j])) {
        overlaps.push(`${boxes[i].id} x ${boxes[j].id}`);
      }
    }
  }

  const overflow: string[] = [];
  for (const b of boxes) {
    if (findTextOverflow(b.el, b, () => true)) overflow.push(b.id);
  }

  const lineEls = Array.from(document.querySelectorAll("line.connector"));
  const lines = lineEls.map((line) => {
    const rel = line.closest("g.relationship");
    const x1 = Number(line.getAttribute("x1"));
    const y1 = Number(line.getAttribute("y1"));
    const x2 = Number(line.getAttribute("x2"));
    const y2 = Number(line.getAttribute("y2"));
    const ctm = (line as SVGGraphicsElement).getScreenCTM();
    const svgRoot = (line as unknown as SVGElement).ownerSVGElement as SVGSVGElement;
    const p1 = svgRoot.createSVGPoint();
    p1.x = x1;
    p1.y = y1;
    const p2 = svgRoot.createSVGPoint();
    p2.x = x2;
    p2.y = y2;
    const s1 = ctm ? p1.matrixTransform(ctm) : p1;
    const s2 = ctm ? p2.matrixTransform(ctm) : p2;
    return { id: rel?.getAttribute("data-id") ?? "", x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y };
  });

  const lineCrossesBox: string[] = [];
  for (const ln of lines) {
    for (const box of boxes) {
      if (segmentCrossesRect(ln, box)) lineCrossesBox.push(`${ln.id} x ${box.id}`);
    }
  }

  const lineCrossings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (segmentsCross(lines[i], lines[j])) {
        lineCrossings.push(`${lines[i].id} x ${lines[j].id}`);
      }
    }
  }

  return {
    boxCount: boxes.length,
    overlaps,
    overflow,
    connectorCount: lines.length,
    lineCrossesBox,
    lineCrossings,
  };
}

/* -------------------------- /tm(d3.ter) ------------------------------ */

function measureTm(): MeasureResult {
  const entityEls = Array.from(document.querySelectorAll("g.entity"));
  if (entityEls.length === 0) return { error: "g.entity が見つからない" };

  const entities = entityEls.map((g) => {
    const d = (g as unknown as { __data__?: { name?: { val?: () => string } } }).__data__;
    const name = d?.name?.val ? d.name.val() : (g.getAttribute("data-id") ?? "");
    const r = g.getBoundingClientRect();
    return { name, el: g, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

  const overlaps: string[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (rectsIntersect(entities[i], entities[j])) {
        overlaps.push(`${entities[i].name} x ${entities[j].name}`);
      }
    }
  }

  const overflow: string[] = [];
  for (const e of entities) {
    if (findTextOverflow(e.el, e, () => true)) overflow.push(e.name);
  }

  const svg = entityEls[0].ownerSVGElement as SVGSVGElement;
  return {
    count: entities.length,
    overlaps,
    overflow,
    connectors: svg.querySelectorAll("line.connector").length,
    cardLine: svg.querySelectorAll("line.cardinality").length,
    cardPath: svg.querySelectorAll("path.cardinality").length,
    optLine: svg.querySelectorAll("line.optionality").length,
    optCircle: svg.querySelectorAll("circle.optionality").length,
  };
}

/* ------------------------ /sitemap(d3.sitemap) ------------------------ */

function measureSitemap(): MeasureResult {
  const nodeEls = Array.from(document.querySelectorAll("g.node"));
  if (nodeEls.length === 0) return { error: "g.node が見つからない" };

  const nodes = nodeEls.map((g) => {
    const body = g.querySelector("rect.node-body") as Element;
    const r = (body ?? g).getBoundingClientRect();
    const label = g.querySelector("text.node-label")?.textContent ?? "";
    return { id: label || g.getAttribute("data-id") || "", el: g, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

  // d3.sitemap は親子を別々の g.node として並べて描く(DOM 上の入れ子ではなく、
  // 子の座標を親の内側の絶対位置に変換して描くだけ)。タブなど「親の内側に収まる」
  // 子ノードは一方が他方をすっぽり包む形になるので、rectsOverlap がそれを除く。
  const overlaps: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (rectsOverlap(nodes[i], nodes[j])) overlaps.push(`${nodes[i].id} x ${nodes[j].id}`);
    }
  }

  const overflow: string[] = [];
  for (const n of nodes) {
    if (findTextOverflow(n.el, n, () => true)) overflow.push(n.id);
  }

  return { count: nodes.length, overlaps, overflow };
}

const DIAGRAMS: Record<DiagramName, DiagramSpec> = {
  "class-diagram": {
    path: "/class-diagram",
    readySelector: "g.class-box",
    measure: measureClassDiagram,
    countKey: "boxCount",
  },
  tm: {
    path: "/tm",
    readySelector: "g.entity",
    measure: measureTm,
    countKey: "count",
  },
  sitemap: {
    path: "/sitemap",
    readySelector: "g.node",
    measure: measureSitemap,
    countKey: "count",
  },
};

/* ==================================================================== *
 *   CLI 引数
 * ==================================================================== */

type Options = {
  diagram: DiagramName;
  expectCount: number | null;
  baseUrl: string | null;
  port: number;
  timeoutMs: number;
};

function parseArgs(argv: string[]): Options {
  const [diagramArg, ...rest] = argv;
  if (!diagramArg || !(diagramArg in DIAGRAMS)) {
    const names = Object.keys(DIAGRAMS).join(" / ");
    throw new UsageError(
      `対象は ${names} のいずれかを指定する(例: npm run web:check-diagram -- class-diagram)`,
    );
  }
  const options: Options = {
    diagram: diagramArg as DiagramName,
    expectCount: null,
    baseUrl: null,
    port: 3000,
    timeoutMs: 20000,
  };
  for (const arg of rest) {
    const [key, value] = arg.replace(/^--/, "").split(/=(.*)/s);
    switch (key) {
      case "expect-count":
        options.expectCount = Number(value);
        break;
      case "url":
        options.baseUrl = value.replace(/\/+$/, "");
        break;
      case "port":
        options.port = Number(value);
        break;
      case "timeout":
        options.timeoutMs = Number(value);
        break;
      default:
        throw new UsageError(`不明なオプション: --${key}`);
    }
  }
  return options;
}

class UsageError extends Error {}

/* ==================================================================== *
 *   開発サーバ(起動済みなら使い、無ければ自分で起動する)
 * ==================================================================== */

const WEB_ROOT = join(import.meta.dirname, "..");

/** 空きポートを1つ確保する(OS 割り当て → 一度閉じて番号だけ使う)。 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error("空きポートを取得できない"))));
    });
  });
}

/** そのポートで、このアプリ(YAOYOROZU)が既に応答しているか。 */
async function isOwnAppRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes("YAOYOROZU");
  } catch {
    return false;
  }
}

async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOwnAppRunning(port)) return true;
    await sleep(500);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Windows・POSIX どちらでも、子孫プロセスごと確実に止める。 */
function killTree(child: ChildProcess): void {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function ensureDevServer(
  options: Options,
): Promise<{ baseUrl: string; stop: () => void }> {
  if (options.baseUrl) {
    return { baseUrl: options.baseUrl, stop: () => {} };
  }

  if (await isOwnAppRunning(options.port)) {
    console.log(`開発サーバは起動済み(http://localhost:${options.port})なのでそれを使う。`);
    return { baseUrl: `http://localhost:${options.port}`, stop: () => {} };
  }

  const port = await findFreePort();
  console.log(`開発サーバが見つからないので、ポート ${port} で自分で起動する。`);
  // トークン(CSS カスタムプロパティ)の生成は web:dev と同じく先に済ませる。
  spawnSync("npm", ["run", "tokens"], { cwd: join(WEB_ROOT, ".."), stdio: "inherit", shell: true });

  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: WEB_ROOT,
    stdio: "ignore",
    shell: true,
    detached: process.platform !== "win32",
  });

  const ok = await waitForServer(port, 60000);
  if (!ok) {
    killTree(child);
    throw new Error(`開発サーバ(ポート ${port})が起動しなかった`);
  }

  return {
    baseUrl: `http://localhost:${port}`,
    stop: () => killTree(child),
  };
}

/* ==================================================================== *
 *   Microsoft Edge を headless で起動し、CDP に繋ぐ
 * ==================================================================== */

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/microsoft-edge-stable",
].filter((p): p is string => !!p);

function findEdge(): string {
  for (const candidate of EDGE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Microsoft Edge が見つからない。EDGE_PATH 環境変数で msedge.exe のパスを指定するか、" +
      "Edge をインストールする。",
  );
}

type EdgeHandle = {
  cdpPort: number;
  close: () => Promise<void>;
};

/**
 * headless Edge を、毎回ちがう一時プロフィール・OS 割り当てポート(0)で起動する。
 * 固定ポートを使わないので、他セッションの Edge に繋がることがない。
 */
async function launchEdge(): Promise<EdgeHandle> {
  const edgePath = findEdge();
  const userDataDir = mkdtempSync(join(tmpdir(), "yaoyorozu-check-diagram-"));

  const child = spawn(
    edgePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const portFile = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + 15000;
  let cdpPort: number | null = null;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const firstLine = readFileSync(portFile, "utf8").split("\n")[0].trim();
      const parsed = Number(firstLine);
      if (Number.isFinite(parsed) && parsed > 0) {
        cdpPort = parsed;
        break;
      }
    }
    await sleep(200);
  }
  if (cdpPort === null) {
    killTree(child);
    rmSync(userDataDir, { recursive: true, force: true });
    throw new Error("Edge の CDP ポートを取得できなかった(DevToolsActivePort が出てこない)。");
  }

  return {
    cdpPort,
    close: async () => {
      killTree(child);
      // taskkill 直後は Edge 側のファイルハンドルがまだ残っていることがあるので、
      // 少し待ってからリトライ付きで消す(rmSync の maxRetries だけでは足りない)。
      await sleep(300);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
          return;
        } catch {
          await sleep(300);
        }
      }
    },
  };
}

/* ---------------------------- CDP クライアント -------------------------- */

type CdpEvent = { method: string; params: Record<string, unknown> };

class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, ((params: Record<string, unknown>) => void)[]>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => this.onMessage(String((ev as MessageEvent).data)));
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpSession> {
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP WebSocket に繋げなかった")), {
        once: true,
      });
    });
    return new CdpSession(ws);
  }

  private onMessage(raw: string): void {
    const msg = JSON.parse(raw) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
    if (msg.id != null) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (const listener of this.listeners.get(msg.method) ?? []) listener(msg.params ?? {});
    }
  }

  on(method: string, listener: (params: Record<string, unknown>) => void): void {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method: string, timeoutMs: number): Promise<CdpEvent["params"]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} を ${timeoutMs}ms 待ったが来なかった`)), timeoutMs);
      this.on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

// タブは about:blank で作り、実際の遷移は呼び出し側が Page.navigate で行う
// (コンソールのイベント購読をナビゲーション前に済ませたいため)。
async function createPage(cdpPort: number): Promise<{ id: string; ws: string }> {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT",
  });
  const target = (await res.json()) as { id: string; webSocketDebuggerUrl: string };
  return { id: target.id, ws: target.webSocketDebuggerUrl };
}

async function closePage(cdpPort: number, id: string): Promise<void> {
  await fetch(`http://127.0.0.1:${cdpPort}/json/close/${id}`).catch(() => {});
}

/* ==================================================================== *
 *   本体
 * ==================================================================== */

type ConsoleMessage = { type: string; text: string };

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }

  const spec = DIAGRAMS[options.diagram];

  let devServer: { baseUrl: string; stop: () => void } | null = null;
  let edge: EdgeHandle | null = null;
  let cdp: CdpSession | null = null;
  let pageId: string | null = null;

  try {
    try {
      devServer = await ensureDevServer(options);
    } catch (e) {
      console.error(`開発サーバの準備に失敗した: ${(e as Error).message}`);
      return 4;
    }

    try {
      edge = await launchEdge();
    } catch (e) {
      console.error((e as Error).message);
      return 3;
    }

    const targetUrl = `${devServer.baseUrl}${spec.path}`;
    const page = await createPage(edge.cdpPort);
    pageId = page.id;
    cdp = await CdpSession.connect(page.ws);

    const consoleMessages: ConsoleMessage[] = [];
    cdp.on("Runtime.consoleAPICalled", (params) => {
      const p = params as { type: string; args?: { value?: unknown; description?: string }[] };
      if (p.type !== "error") return;
      const text = (p.args ?? [])
        .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? "")))
        .join(" ");
      consoleMessages.push({ type: "console.error", text });
    });
    cdp.on("Runtime.exceptionThrown", (params) => {
      const p = params as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
      const text = p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "unknown";
      consoleMessages.push({ type: "exception", text });
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const loaded = cdp.waitForEvent("Page.loadEventFired", options.timeoutMs);
    await cdp.send("Page.navigate", { url: targetUrl });
    try {
      await loaded;
    } catch (e) {
      console.error(`${targetUrl} の読み込みが終わらなかった: ${(e as Error).message}`);
      return 5;
    }

    const ready = await waitForSelector(cdp, spec.readySelector, options.timeoutMs);
    if (!ready) {
      console.error(`${spec.readySelector} が ${options.timeoutMs}ms 経っても現れなかった。`);
      return 5;
    }
    // 描画が落ち着くのを少し待つ(レイアウト計算・フォント適用の余韻)。
    await sleep(500);

    const evalResult = await cdp.send<{ result: { value: MeasureResult } }>("Runtime.evaluate", {
      expression: toEvalExpression(spec.measure as () => unknown),
      returnByValue: true,
      awaitPromise: true,
    });
    const measured = evalResult.result.value;

    return report(options, spec, measured, consoleMessages);
  } finally {
    if (cdp) cdp.close();
    if (edge && pageId) await closePage(edge.cdpPort, pageId);
    if (edge) await edge.close();
    if (devServer) devServer.stop();
  }
}

async function waitForSelector(cdp: CdpSession, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await cdp.send<{ result: { value: boolean } }>("Runtime.evaluate", {
      expression: `!!document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: true,
    });
    if (res.result.value) return true;
    await sleep(300);
  }
  return false;
}

function report(
  options: Options,
  spec: DiagramSpec,
  measured: MeasureResult,
  consoleMessages: ConsoleMessage[],
): number {
  console.log(JSON.stringify({ diagram: options.diagram, ...measured, consoleMessages }, null, 2));

  if (measured.error) {
    console.error(`✗ ${measured.error}`);
    return 1;
  }

  const problems: string[] = [];

  const count = Number(measured[spec.countKey] ?? NaN);
  if (options.expectCount != null && count !== options.expectCount) {
    problems.push(`箱の数が一致しない(期待 ${options.expectCount} / 実際 ${count})`);
  }

  const overlaps = (measured.overlaps as unknown[] | undefined) ?? [];
  if (overlaps.length > 0) problems.push(`重なりが ${overlaps.length} 件ある: ${overlaps.join(", ")}`);

  const overflow = (measured.overflow as unknown[] | undefined) ?? [];
  if (overflow.length > 0) problems.push(`枠からのはみ出しが ${overflow.length} 件ある: ${overflow.join(", ")}`);

  const lineCrossesBox = (measured.lineCrossesBox as unknown[] | undefined) ?? [];
  if (lineCrossesBox.length > 0) {
    problems.push(`線が箱を横切っている: ${lineCrossesBox.length} 件: ${lineCrossesBox.join(", ")}`);
  }

  const lineCrossings = (measured.lineCrossings as unknown[] | undefined) ?? [];
  if (lineCrossings.length > 0) {
    problems.push(`線どうしが交差している: ${lineCrossings.length} 件: ${lineCrossings.join(", ")}`);
  }

  if (consoleMessages.length > 0) {
    problems.push(`コンソールエラーが ${consoleMessages.length} 件ある`);
  }

  if (problems.length > 0) {
    console.error(`✗ ${options.diagram}: ` + problems.join(" / "));
    return 1;
  }

  console.log(`✓ ${options.diagram}: 箱 ${count} 件、問題なし。`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
