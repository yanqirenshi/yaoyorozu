/**
 * apps/web の図のページ(/class-diagram・/tm・/sitemap)を headless の Microsoft Edge で開き、
 * 箱の重なり・線の交差・枠からのはみ出し・コンソールエラーの有無をコマンドで確認する。
 *
 *   npm run web:check-diagram -- class-diagram --expect-count=227
 *   npm run web:check-diagram -- tm --expect-count=30
 *   npm run web:check-diagram -- sitemap
 *   npm run web:check-diagram -- --help
 *   npm run web:check-diagram -- --cleanup   # 残った Edge の掃除だけ行う(#475)
 *
 * これまで各セッションは Claude Desktop のブラウザのペイン(preview_start /
 * javascript_tool / read_console_messages)で描画と幾何を確かめてきたが、Desktop から
 * yaoyorozu app へ移行したセッションはそのペインを使えない(#462)。
 * PC に入っている Microsoft Edge を画面なし(headless)で起動し、
 * Chrome DevTools Protocol(CDP)に Node 標準の fetch / WebSocket だけで繋ぐ
 * (playwright / puppeteer 等は追加しない。apps/native の開発版を CDP で確認する方法
 * (native-dev-verify-from-worktree メモ)と同じやり方)。
 *
 * **必ず、確認したい変更のある作業ツリー(worktree)でこのスクリプトを実行する**
 * (実行開始時に、このスクリプトのある作業ツリー(WEB_ROOT)の絶対パスと、使うサーバの
 * URL を必ず表示するので、報告に貼れば取り違えが第三者にも分かる)。
 *
 * ポートの取り違え事故(2026-09-25、他セッションの開発サーバ・CDP に繋いでしまった)の
 * 再発防止のため、
 * - Edge は毎回ちがう一時プロフィール・`--remote-debugging-port=0`(OS が空きポートを
 *   割り当てる)で起動し、実際のポートは Edge が書き出す `DevToolsActivePort` から読む。
 *   固定ポートを推測して繋ぐことがないので、他セッションの Edge に繋がりようがない。
 * - 開発サーバは、既定では**このスクリプトのある作業ツリー(WEB_ROOT)から自分で
 *   空きポートで起動し**、終わったら止める。他セッションが起動済みのサーバ(既定の
 *   3000 番など)を既定では絶対に使わない — worktree で作業しているのに、たまたま
 *   3000 番で動いている main の作業ツリーの開発サーバを見て「問題なし」と誤報告する
 *   事故(2026-09-25 の「他セッションの Vite のコードを見て誤診した」事例と同型)を防ぐ
 *   ため。既に動いているサーバを使いたいときは `--base-url` で明示する(このときは
 *   どの作業ツリーのコードを出しているか確認できない旨の警告を出す)。
 * - 確認したい作業ツリーで既に `next dev` 等が動いていて自分のサーバを起動できない
 *   ときは、そのプロセスを止めるか、`--base-url` でそのサーバの URL を明示する
 *   (例: `--base-url=http://localhost:3000`。ただしそのサーバが確認したい作業ツリーの
 *   コードを出しているか、自分で確かめること)。
 *
 * Node は 24 以上を前提とし、TypeScript のまま実行する(型注釈は実行時に取り除かれる。
 * scripts/generate-tokens.ts と同じ)。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, createServer } from "node:net";

/** このスクリプトが起動する Edge の一時プロフィール名の接頭辞。残骸の見分けに使う。 */
const EDGE_TEMP_PREFIX = "yaoyorozu-check-diagram-";
/** 一時プロフィールの直下に置く、所有者(このスクリプトの process.pid)を書くファイル。 */
const OWNER_PID_FILE = "owner-pid.txt";

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
    // #589 で /{リポジトリ名}/class-diagram へ移した。
    path: "/yaoyorozu/class-diagram",
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
    path: "/yaoyorozu/sitemap",
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
  /** 明示的に指定したときだけ使う、既に動いているサーバの URL。既定は null(自分で起動する)。 */
  baseUrl: string | null;
  /** 自分でサーバを起動するときのポート。既定は null(空きポートを自動で選ぶ)。 */
  port: number | null;
  timeoutMs: number;
};

const HELP_TEXT = `使い方: npm run web:check-diagram -- <対象> [オプション]
       npm run web:check-diagram -- --cleanup [--dry-run]

対象: ${Object.keys(DIAGRAMS).join(" / ")}

オプション:
  --expect-count=N   期待する箱(エンティティ・ノード)の数。合わなければ終了コードが非0
  --base-url=URL     既に動いているサーバをそのまま使う(既定はしない。このスクリプトの
                      ある作業ツリーから自分で開発サーバを起動して使う)。
                      指定したときは、そのサーバがどの作業ツリーのコードを出しているか
                      自分で確かめること(このスクリプトは確認しない)
  --port=N           自分で開発サーバを起動するときのポート(既定は空きポートを自動選択)
  --timeout=ms        描画待ちのタイムアウト(既定 45000)
  --cleanup           このスクリプトが起動して残った Edge の掃除だけを行う(後述)
  --dry-run           --cleanup と組み合わせ、対象の一覧だけ出して止めない
  --help, -h          このヘルプを表示する

確認したい作業ツリーで既に next dev 等が動いていて自分のサーバを起動できない
(ポートが埋まっている・.next の競合でビルドが失敗する等)ときは、そのプロセスを
止めるか、--base-url でそのサーバの URL を明示する。

## Edge が残ったとき(--cleanup)

このスクリプトは、実行が正常に終わっても異常に終わっても Edge を止めるようにしているが
(try/finally に加えて Ctrl+C・想定外の例外でも後片付けする)、それでも取りこぼす
可能性はゼロではない(#475)。残ったら次のコマンドで掃除する。

  npm run web:check-diagram -- --cleanup

これは、\`--user-data-dir\` に \`${EDGE_TEMP_PREFIX}\`(このスクリプトの一時プロフィールの
接頭辞)を含む msedge.exe だけを対象にし、そのうち**所有者(起動した node の PID。
一時プロフィール内の \`${OWNER_PID_FILE}\` に記録)がもう生きていないもの**だけを PID
指定で止め、一時プロフィールのフォルダを消す。実行中の別セッションのぶんには触れない。
対象は実行前に一覧で表示する(--dry-run を付けると一覧だけで止めない)。

**絶対に \`taskkill /IM msedge.exe\` のようなプロセス名一致の一括終了はしない**
(全セッションが1つの app(WebView2)の上で動いており、2026-09-29 に
msedgewebview2.exe の一括終了で app と全セッションが止まった事故がある)。手動で
探すときも、コマンドラインに \`${EDGE_TEMP_PREFIX}\` を含むものだけを PID 指定で
個別に止めること(例 PowerShell:
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*${EDGE_TEMP_PREFIX}*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
)。`;

function parseArgs(argv: string[]): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const [diagramArg, ...rest] = argv;
  if (!diagramArg || !(diagramArg in DIAGRAMS)) {
    const names = Object.keys(DIAGRAMS).join(" / ");
    throw new UsageError(
      `対象は ${names} のいずれかを指定する(例: npm run web:check-diagram -- class-diagram。` +
        `--help で使い方を表示する)`,
    );
  }
  const options: Options = {
    diagram: diagramArg as DiagramName,
    expectCount: null,
    baseUrl: null,
    port: null,
    // 初回の Turbopack コンパイルは worktree によっては数十秒かかることがある(#471)。
    // 既定を短くすると、実際には表示できているのに「読み込みが終わらなかった」と
    // 誤判定することがある。
    timeoutMs: 45000,
  };
  for (const arg of rest) {
    const [key, value] = arg.replace(/^--/, "").split(/=(.*)/s);
    switch (key) {
      case "expect-count":
        options.expectCount = Number(value);
        break;
      case "base-url":
        options.baseUrl = value.replace(/\/+$/, "");
        break;
      case "port":
        options.port = Number(value);
        break;
      case "timeout":
        options.timeoutMs = Number(value);
        break;
      default:
        throw new UsageError(`不明なオプション: --${key}(--help で使い方を表示する)`);
    }
  }
  return options;
}

class UsageError extends Error {}

/* ==================================================================== *
 *   開発サーバ(起動済みなら使い、無ければ自分で起動する)
 * ==================================================================== */

const WEB_ROOT = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB_ROOT, "..", "..");

/*
 * ==================================================================== *
 *   緊急時の後片付け(Ctrl+C・想定外の例外など、finally を通らない終了)
 * ==================================================================== *
 *
 * 通常は main() の try/finally で開発サーバ・Edge を止めるが、Ctrl+C(SIGINT)は
 * ハンドラを登録しないと Node が pending の finally を待たずに即終了する。ここでは
 * そのときのための同期的(async を待てない)な最終手段を用意する。
 *
 * Windows の Job Object(親が死んだら子も終わる仕組み)は Node 標準だけでは使えない
 * (native addon が要る)ため採用しなかった。代わりに、①この最終手段のハンドラ群と、
 * ②`--user-data-dir` で確実に自分の Edge だけを見分けて止める killByUserDataDir、
 * ③取りこぼしたときのための `--cleanup` の3段構えで対応する(2026-09-30、#475)。
 */

let activeEdge: { childPid?: number; userDataDir: string } | null = null;
let activeDevServerChild: ChildProcess | null = null;

/** 同期(spawnSync)だけで、分かっている範囲を止める。Ctrl+C・例外の最終手段。 */
function emergencyCleanupSync(): void {
  if (activeDevServerChild) {
    killTree(activeDevServerChild);
    activeDevServerChild = null;
  }
  if (activeEdge) {
    if (activeEdge.childPid != null && process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(activeEdge.childPid), "/T", "/F"], { stdio: "ignore" });
    }
    killByUserDataDir(activeEdge.userDataDir);
    try {
      rmSync(activeEdge.userDataDir, { recursive: true, force: true });
    } catch {
      // 使用中で消せなくても、プロセス自体は止めてあるので次回の --cleanup に任せる。
    }
    activeEdge = null;
  }
}

process.on("exit", emergencyCleanupSync);
process.on("SIGINT", () => {
  emergencyCleanupSync();
  process.exit(130);
});
process.on("SIGTERM", () => {
  emergencyCleanupSync();
  process.exit(143);
});
process.on("uncaughtException", (e) => {
  console.error(e);
  emergencyCleanupSync();
  process.exit(1);
});

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

/**
 * そのポートの path で YAOYOROZU が応答しているか。自分で起動したサーバの起動待ちに
 * のみ使う(既に動いている別のサーバを「使えるから使う」判定には使わない。タイトルに
 * YAOYOROZU を含むかだけでは、どの作業ツリーのコードを出しているかは分からないため)。
 *
 * 叩く path は必ず**これから確認したい図のページ**にする。`/` は `/wbs` へ
 * リダイレクトするため、それを叩くと無関係な `/wbs` がコンパイルされるだけで、
 * 肝心の図のページはまだ未コンパイルのまま — 起動待ちと、この後の実際の描画待ちの
 * 2回ぶん、初回コンパイルの時間がかかってしまっていた(#474)。
 */
async function isRespondingAt(port: number, path: string): Promise<boolean> {
  try {
    // Turbopack はページを初回アクセス時にその場でコンパイルするため、最初の1回は
    // 数秒〜数十秒かかることがある(#471 で報告された worktree では 36 秒ほど)。
    // ここを短くすると、そのコンパイル中のリクエストを毎回中断してしまい、
    // 実際には起動できているのに waitForServer が失敗と判定し続けることがある。
    const res = await fetch(`http://localhost:${port}${path}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes("YAOYOROZU");
  } catch {
    return false;
  }
}

/**
 * @param onProgress 待っている間、定期的に(約15秒ごとに)経過秒数を知らせる。
 *   失敗なのか初回コンパイル中なのかが外から分かるようにする(#474)。
 */
async function waitForServer(
  port: number,
  path: string,
  timeoutMs: number,
  onProgress?: (elapsedMs: number) => void,
): Promise<boolean> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastProgressAt = start;
  while (Date.now() < deadline) {
    if (await isRespondingAt(port, path)) return true;
    const now = Date.now();
    if (onProgress && now - lastProgressAt >= 15000) {
      onProgress(now - start);
      lastProgressAt = now;
    }
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

/**
 * このスクリプトが起動した Edge の生き残りを、コマンドラインに userDataDir(mkdtemp で
 * 作った、実行のたびにちがう一時プロフィールのパス)を含むものだけに絞って止める。
 * Chromium はクラッシュレポート用のプロセス(crashpad_handler)などを親子関係の外に
 * 作ることがあり、`taskkill /T`(プロセスツリー)だけでは取りこぼすことがある
 * (2026-09-29、掃除しきれなかった msedge.exe が積み重なって動作を遅くした事例)。
 * **絶対にプロセス名一致(taskkill /IM)の一括終了はしない**(全セッションが1つの
 * app(WebView2)の上で動いており、名前一致だと他セッションを巻き込む。同日の事故)。
 * userDataDir はこの実行だけの一意なパスなので、これで絞る限り他プロセスに影響しない。
 */
function killByUserDataDir(userDataDir: string): void {
  if (process.platform !== "win32") return;
  const command =
    `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${psLikeEscape(userDataDir)}*' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync("powershell", ["-NoProfile", "-Command", command], { stdio: "ignore" });
}

/**
 * PowerShell の単一引用符文字列(かつ -like パターン)に安全に埋め込めるようエスケープする。
 * 単一引用符文字列でバックスラッシュはただの文字(エスケープ不要)。二重化すると逆に
 * 実際のパス(単一のバックスラッシュ)と一致しなくなる不具合があった(#475 の一因。
 * killByUserDataDir が常に0件ヒットになり、後片付けが効いていなかった)。
 * -like の特殊文字(`*` `?` `[` `]`)はバッククォートでエスケープする。
 */
function psLikeEscape(value: string): string {
  return value.replace(/'/g, "''").replace(/[`*?[\]]/g, "`$&");
}

/**
 * 開発サーバを用意する。既定では、このスクリプトのある作業ツリー(WEB_ROOT)から
 * 自分で空きポートで起動する(他セッションが動かしている、既定の 3000 番などの
 * サーバは既定では絶対に使わない。worktree の変更ではなく別の作業ツリー — 多くは
 * main — の図を見て「問題なし」と誤報告する事故を防ぐため)。
 * `--base-url` を明示したときだけ、そのサーバをそのまま使う。
 */
async function ensureDevServer(
  options: Options,
  path: string,
): Promise<{ baseUrl: string; stop: () => void }> {
  if (options.baseUrl) {
    console.warn(
      `⚠ --base-url で指定されたサーバをそのまま使う: ${options.baseUrl}\n` +
        `  このサーバが ${WEB_ROOT} のコードを出しているかはこのスクリプトでは確認できない。呼び出し側で確かめること。`,
    );
    return { baseUrl: options.baseUrl, stop: () => {} };
  }

  const port = options.port ?? (await findFreePort());
  console.log(`${WEB_ROOT} から、ポート ${port} で開発サーバを自分で起動する。`);
  // トークン(CSS カスタムプロパティ)の生成は web:dev と同じく先に済ませる。
  spawnSync("npm", ["run", "tokens"], { cwd: REPO_ROOT, stdio: "inherit", shell: true });

  // cwd を WEB_ROOT にして `next dev` を起動すると、worktree(特に .claude/worktrees/
  // 配下のように、上位に別の package-lock.json を持つ作業ツリーの中に入れ子で作られた
  // もの)では Next がワークスペースのルートを見誤り、app ディレクトリを見失うことが
  // ある(#471)。cwd はリポジトリのルートにし、対象ディレクトリは引数で明示する。
  const output: string[] = [];
  const child = spawn("npx", ["next", "dev", WEB_ROOT, "-p", String(port)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    detached: process.platform !== "win32",
  });
  const recordOutput = (chunk: Buffer) => {
    output.push(chunk.toString("utf8"));
    // 際限なく溜めない(失敗時の末尾数十行が分かれば十分)。
    if (output.length > 500) output.shift();
  };
  child.stdout?.on("data", recordOutput);
  child.stderr?.on("data", recordOutput);
  // Ctrl+C・想定外の例外など、finally を通らない終了でも止められるようにする(#475)。
  activeDevServerChild = child;

  // 初回コンパイルに数十秒かかる環境があるため(#471・#474)、1回のリクエスト待ち
  // (60秒)より十分長くする。
  const ok = await waitForServer(port, path, 180000, (elapsedMs) => {
    const tail = output.join("").split("\n").filter((l) => l.trim() !== "").at(-1);
    console.log(
      `  …まだ起動待ち(${Math.round(elapsedMs / 1000)}秒経過)。next dev の直近の出力: ` +
        (tail ?? "(まだ無い)"),
    );
  });
  if (!ok) {
    killTree(child);
    activeDevServerChild = null;
    const busy = await isPortOccupied(port);
    const tail = output.join("").split("\n").filter((l) => l.trim() !== "").slice(-40).join("\n");
    throw new Error(
      (busy
        ? `開発サーバ(ポート ${port})が起動しなかった。このポートは既に何か別のプロセスが` +
          `使っている。そのプロセスを止めるか、--port で別のポートを指定する` +
          `(それでも起動しないときは --base-url も検討する。--help を参照)。\n`
        : `開発サーバ(ポート ${port})が起動しなかった(ポート自体は空いている。next dev が` +
          `起動時に失敗した可能性がある。--base-url でそのサーバの URL を明示する手も` +
          `ある。--help を参照)。\n`) + `--- next dev の出力(末尾) ---\n${tail || "(出力なし)"}`,
    );
  }

  return {
    baseUrl: `http://localhost:${port}`,
    stop: () => {
      killTree(child);
      activeDevServerChild = null;
    },
  };
}

/** そのポートに TCP で繋げるか(何かが実際に listen しているか)。 */
function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1", timeout: 1000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
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
  userDataDir: string;
  close: () => Promise<void>;
};

/**
 * headless Edge を、毎回ちがう一時プロフィール・OS 割り当てポート(0)で起動する。
 * 固定ポートを使わないので、他セッションの Edge に繋がることがない。
 *
 * 起動プロセス(spawn した子)は、実際のブラウザ本体を別プロセスとして起こして
 * 自分はすぐ終わる作りのため、その子の PID に taskkill /T しても本体に届かないことが
 * ある(#475)。本体は `--user-data-dir` にこの実行専用の一時プロフィールを持つ
 * `msedge.exe` として見分けられるので、後片付けは PID ではなくそれで探す
 * (killByUserDataDir)。あわせて、このプロフィール自身の所有者(このスクリプトの
 * process.pid)を `owner-pid.txt` に書いておく。`--cleanup` はこれを読んで、
 * 所有者がまだ生きているプロフィール(= 実行中の別セッション)には触れない。
 */
async function launchEdge(): Promise<EdgeHandle> {
  const edgePath = findEdge();
  const userDataDir = mkdtempSync(join(tmpdir(), EDGE_TEMP_PREFIX));
  writeFileSync(join(userDataDir, OWNER_PID_FILE), String(process.pid));

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
  // Ctrl+C・想定外の例外など、finally を通らない終了でも後片付けできるようにする
  // (#475。詳しくはファイル末尾の緊急時の後片付けを参照)。
  activeEdge = { childPid: child.pid, userDataDir };

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
    killByUserDataDir(userDataDir);
    rmSync(userDataDir, { recursive: true, force: true });
    activeEdge = null;
    throw new Error("Edge の CDP ポートを取得できなかった(DevToolsActivePort が出てこない)。");
  }

  return {
    cdpPort,
    userDataDir,
    close: async () => {
      // まず CDP で行儀よく閉じるよう頼む(確実ならこれで本体ごと終わる)。
      // うまくいかなくても、後続の PID 指定の kill で必ずカバーする。
      await closeEdgeGracefully(cdpPort);
      killTree(child);
      killByUserDataDir(userDataDir);
      activeEdge = null;
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

/**
 * Edge に `Browser.close` で行儀よく終了するよう頼む(ベストエフォート)。
 * これで本体が確実に終わるとは限らない(#475 の見立てどおり、起動プロセスと本体が
 * 別プロセスのことがある)ため、失敗しても呼び出し側で PID 指定の kill を必ず続ける。
 */
async function closeEdgeGracefully(cdpPort: number): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    const info = (await res.json()) as { webSocketDebuggerUrl?: string };
    if (!info.webSocketDebuggerUrl) return;
    const session = await CdpSession.connect(info.webSocketDebuggerUrl);
    try {
      await Promise.race([session.send("Browser.close"), sleep(2000)]);
    } finally {
      session.close();
    }
  } catch {
    // 繋げない・応答しない等はここでは無視する。
  }
}

/* ==================================================================== *
 *   残骸の掃除(--cleanup)
 * ==================================================================== */

type EdgeCandidate = {
  processId: number;
  created: string;
  userDataDir: string | null;
};

/** 1つの Edge の起動(= 1つの一時プロフィール)にぶら下がるプロセスの束。 */
type EdgeInstance = {
  userDataDir: string | null;
  created: string;
  processIds: number[];
  ownerAlive: boolean;
};

/** その PID のプロセスが今も存在するか(シグナル 0 で存在確認するだけで、実際には送らない)。 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * `--user-data-dir` に EDGE_TEMP_PREFIX を含む msedge.exe(= このスクリプトが起動した
 * もの)を、コマンドラインで絞って一覧する。プロセス名一致の一括終了はしない
 * (CLAUDE.md 2026-09-30 のルール。ここでも対象はコマンドラインで絞り、最終的に
 * 止める・消すのは PID / パス指定でだけ行う)。
 *
 * headless の Edge は、1回の起動でもレンダラ・GPU・crashpad_handler 等の
 * サブプロセスに分かれ、その多くが同じ `--user-data-dir` を引き継いだコマンドラインで
 * 現れる。1プロセス = 1インスタンスではないので、この関数は生のプロセス一覧を返すだけに
 * とどめ、まとめ(インスタンス単位への集約)は groupByInstance で行う。
 */
function listEdgeCandidates(): EdgeCandidate[] {
  if (process.platform !== "win32") return [];
  const script =
    `$results = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${EDGE_TEMP_PREFIX}*' } | ` +
    `ForEach-Object { [PSCustomObject]@{ ProcessId = $_.ProcessId; ` +
    `Created = $_.CreationDate.ToString('s'); CommandLine = $_.CommandLine } }); ` +
    `$results | ConvertTo-Json -Compress`;
  const res = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  });
  const stdout = (res.stdout ?? "").trim();
  if (!stdout) return [];
  let rows: { ProcessId: number; Created: string; CommandLine: string }[];
  try {
    const parsed = JSON.parse(stdout);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
  return rows.map((row) => {
    const match = row.CommandLine.match(/--user-data-dir=(\S+)/);
    // サブプロセスによっては値がクォートで囲まれることがあるので剥がす。
    const userDataDir = match ? match[1].replace(/^"|"$/g, "") : null;
    return { processId: row.ProcessId, created: row.Created, userDataDir };
  });
}

/** 生のプロセス一覧を、`--user-data-dir` ごと(= Edge の起動ごと)にまとめる。 */
function groupByInstance(candidates: EdgeCandidate[]): EdgeInstance[] {
  const groups = new Map<string, EdgeInstance>();
  for (const c of candidates) {
    const key = c.userDataDir ?? `(unknown:${c.processId})`;
    const g = groups.get(key);
    if (g) {
      g.processIds.push(c.processId);
      if (c.created < g.created) g.created = c.created; // いちばん早く起動したものを代表にする
      continue;
    }
    let ownerAlive = true; // 所有者が分からないものは、誤って消さないよう「生きている」扱いにする。
    if (c.userDataDir) {
      try {
        const ownerPid = Number(readFileSync(join(c.userDataDir, OWNER_PID_FILE), "utf8").trim());
        ownerAlive = Number.isFinite(ownerPid) && isProcessAlive(ownerPid);
      } catch {
        // owner-pid.txt が無い(#475 より前に残ったものなど)は、所有者が確認できない
        // ぶん安全側ではあるが、実際にはほぼ確実に孤児なので orphan 扱いにする。
        ownerAlive = false;
      }
    }
    groups.set(key, { userDataDir: c.userDataDir, created: c.created, processIds: [c.processId], ownerAlive });
  }
  return [...groups.values()];
}

function printEdgeInstances(instances: EdgeInstance[]): void {
  for (const i of instances) {
    const status = i.userDataDir == null ? "(user-data-dir 不明。触らない)" : i.ownerAlive ? "実行中" : "孤児";
    console.log(
      `  起動 ${i.created}  ${status}  プロセス ${i.processIds.length} 件(PID ${i.processIds.join(", ")})  ` +
        (i.userDataDir ?? "(不明)"),
    );
  }
}

async function runCleanup(dryRun: boolean): Promise<number> {
  const instances = groupByInstance(listEdgeCandidates());
  if (instances.length === 0) {
    console.log("残骸は無い。");
    return 0;
  }
  console.log(`Edge ${instances.length} 件見つかった:`);
  printEdgeInstances(instances);

  const orphans = instances.filter((i) => i.userDataDir != null && !i.ownerAlive);
  const skipped = instances.length - orphans.length;
  if (skipped > 0) {
    console.log(`${skipped} 件は実行中(所有者が生きている)か user-data-dir 不明のため触らない。`);
  }
  if (orphans.length === 0) {
    console.log("止めるものは無い。");
    return 0;
  }

  if (dryRun) {
    console.log(`--dry-run のため、${orphans.length} 件は止めずに一覧だけ出した。`);
    return 0;
  }

  for (const o of orphans) {
    if (process.platform === "win32") {
      for (const pid of o.processIds) {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      }
    }
    if (o.userDataDir) {
      try {
        rmSync(o.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch {
        // プロセスは止めてあるので、フォルダが残っても実害は小さい。
      }
    }
  }
  console.log(`${orphans.length} 件止めて、一時プロフィールを消した。`);
  return 0;
}

/* ==================================================================== *
 *   本体
 * ==================================================================== */

type ConsoleMessage = { type: string; text: string };

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--cleanup")) {
    return runCleanup(argv.includes("--dry-run"));
  }

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

  // どの作業ツリーの図を確認しているかを必ず表示する(報告に貼れば取り違えが分かる)。
  console.log(`作業ツリー: ${WEB_ROOT}`);

  const orphanCount = groupByInstance(listEdgeCandidates()).filter(
    (i) => i.userDataDir != null && !i.ownerAlive,
  ).length;
  if (orphanCount > 0) {
    console.warn(
      `⚠ 前回までの Edge の残骸が ${orphanCount} 件残っている。` +
        `npm run web:check-diagram -- --cleanup で片付けられる。`,
    );
  }

  let devServer: { baseUrl: string; stop: () => void } | null = null;
  let edge: EdgeHandle | null = null;
  let cdp: CdpSession | null = null;
  let pageId: string | null = null;

  try {
    try {
      devServer = await ensureDevServer(options, spec.path);
    } catch (e) {
      console.error(`開発サーバの準備に失敗した: ${(e as Error).message}`);
      return 4;
    }
    console.log(`URL: ${devServer.baseUrl}${spec.path}`);

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
