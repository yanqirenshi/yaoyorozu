// 実行中セッション(段階 3)のサーバ側の確認。**使い捨て**のデータフォルダ・ホーム・リポジトリ・
// 会話フォルダを作り、偽の claude(`crates/infra/tests/fake_claude.cjs`)でサーバを実際に起動して、
// HTTP(`/rpc`)と SSE(`/events`)から一通りを確かめる。本物の `%APPDATA%\com.yaoyorozu.native`・
// `~/.claude`・他のセッションの claude には触れない(USERPROFILE/HOME も使い捨ての場所へ差し替える)。
//
// 使い方(`apps/native` で `cargo build -p server` のあと):
//   node server/scripts/e2e-running.mjs [サーバの exe のパス]
//
// 止めるのは、**このスクリプトが起動した PID とその子孫だけ**(名前一致の一括終了はしない)。

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, "..", "..");
const serverExe = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? path.join(nativeDir, "target", "debug", "server.exe");
const fakeClaude = path.join(nativeDir, "crates", "infra", "tests", "fake_claude.cjs");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slash = (p) => p.replaceAll("\\", "/");

// ---- 使い捨ての場所 ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), "yyz-e2e-"));
const dirs = {
  data: path.join(root, "data"),
  home: path.join(root, "home"),
  repo: path.join(root, "repo"),
};
const projects = path.join(dirs.home, ".claude", "projects");
const projectName = "e2e-project";
fs.mkdirSync(dirs.data, { recursive: true });
fs.mkdirSync(path.join(projects, projectName), { recursive: true });
fs.mkdirSync(path.join(dirs.home, ".claude", "sessions"), { recursive: true });
fs.mkdirSync(dirs.repo, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: dirs.repo, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("config", "user.email", "e2e@example.invalid");
git("config", "user.name", "e2e");
fs.writeFileSync(path.join(dirs.repo, "README.md"), "e2e\n");
git("add", ".");
git("commit", "-q", "-m", "init");

// ---- プロセスの木 ----
function descendants(pid) {
  const out = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId)\" }",
    ],
    { encoding: "utf8" },
  );
  const parentOf = new Map();
  const children = new Map();
  for (const line of out.split(/\r?\n/)) {
    const [c, p] = line.split(",").map(Number);
    if (!c) continue;
    parentOf.set(c, p);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(c);
  }
  const found = [];
  const walk = (p) => {
    for (const c of children.get(p) ?? []) {
      found.push(c);
      walk(c);
    }
  };
  walk(pid);
  return found;
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ---- サーバの起動 ----
const startedPids = [];
let nextPort = 14300 + Math.floor(Math.random() * 400);
const serverEnv = (dataDir, port) => ({
  ...process.env,
  YAOYOROZU_DATA_DIR: dataDir,
  YAOYOROZU_SERVER_PORT: String(port),
  YAOYOROZU_SERVER_FAKE_CLAUDE: fakeClaude,
  USERPROFILE: dirs.home,
  HOME: dirs.home,
});
// 自分専用の(非表示の)コンソールで起動する。Ctrl+C をそのコンソールへだけ送るため
// (このスクリプトや他のセッションのコンソールへは届かない)。出力はファイルへ。
function startServer({ dataDir = dirs.data, port = nextPort++ } = {}) {
  const out = path.join(root, `server-${port}.out`);
  const err = path.join(root, `server-${port}.err`);
  const pidFile = path.join(root, `server-${port}.pid`);
  const command = `${consoleApi}
[K]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) | Out-Null
$p = Start-Process -FilePath '${serverExe}' -WindowStyle Hidden -PassThru -RedirectStandardOutput '${out}' -RedirectStandardError '${err}'; $p.Id | Out-File -Encoding ascii '${pidFile}'`;
  // 標準入出力は捨てる(つながったままだと、子のサーバがパイプを持ち続けて、この呼び出しが終わらない)。
  execFileSync("powershell", ["-NoProfile", "-Command", command], { env: serverEnv(dataDir, port), stdio: "ignore" });
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  startedPids.push(pid);
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
  const log = { join: () => read(out) + read(err) };
  const exited = (async () => {
    while (alive(pid)) await sleep(100);
    return "gone";
  })();
  return { child: { pid, get exitCode() { return alive(pid) ? null : 0; } }, port, log, exited, base: `http://127.0.0.1:${port}`, dataDir };
}
// 2 つ目のサーバ(断られる確認)。終了コードがほしいので、ふつうに起動して終わりを待つ。
function runServerOnce({ dataDir = dirs.data, port = nextPort++ } = {}) {
  const child = spawn(serverExe, [], { env: serverEnv(dataDir, port), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, log, exited };
}
async function waitHealthy(srv) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${srv.base}/health`);
      if (r.ok) return;
    } catch {}
    if (srv.child.exitCode !== null) throw new Error(`サーバが終了しました: ${srv.log.join("")}`);
    await sleep(100);
  }
  throw new Error("サーバが起動しません");
}
const token = (srv) => fs.readFileSync(path.join(srv.dataDir, "server-token"), "utf8").trim();

// `--next`: ブラウザと同じ道(Next の中継 `/api/*`。トークンは中継が付ける)を通して確かめる。
// 先に `apps/console` で `npx next build` しておく。
const viaNext = process.argv.includes("--next");
const consolePort = 3300 + Math.floor(Math.random() * 90);
const nextBase = `http://127.0.0.1:${consolePort}`;
const rpcUrl = (srv, command) => (viaNext ? `${nextBase}/api/rpc/${command}` : `${srv.base}/rpc/${command}`);
const eventsUrl = (srv) => (viaNext ? `${nextBase}/api/events` : `${srv.base}/events`);
const authHeaders = (srv) => (viaNext ? { origin: nextBase } : { authorization: `Bearer ${token(srv)}` });

async function startNext() {
  const consoleDir = path.join(nativeDir, "..", "console");
  const nextBin = path.join(nativeDir, "..", "..", "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(consolePort)], {
    cwd: consoleDir,
    env: { ...process.env, YAOYOROZU_DATA_DIR: dirs.data, NODE_ENV: "production" },
    windowsHide: true,
    stdio: "ignore",
  });
  startedPids.push(child.pid);
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${nextBase}/api/health`, { headers: { origin: nextBase } });
      if (r.status < 600) return;
    } catch {}
    await sleep(200);
  }
  throw new Error("next start が起動しません(先に apps/console で next build を)");
}

async function rpc(srv, command, body = {}, { raw } = {}) {
  const r = await fetch(rpcUrl(srv, command), {
    method: "POST",
    headers: { ...authHeaders(srv), "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text };
}

// ---- SSE ----
async function openSse(srv) {
  const ctl = new AbortController();
  const res = await fetch(eventsUrl(srv), {
    headers: authHeaders(srv),
    signal: ctl.signal,
  });
  const events = [];
  let connectionId = null;
  let closed = false;
  const waiters = [];
  (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let name = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) name = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!name || name === "message") continue;
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {}
          if (name === "connection") connectionId = parsed.connection_id;
          events.push({ name, data: parsed });
          waiters.forEach((w) => w());
        }
      }
    } catch {}
    closed = true;
    waiters.forEach((w) => w());
  })();
  const waitFor = async (pred, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() > end) return null;
      await new Promise((r) => {
        waiters.push(r);
        setTimeout(r, 100);
      });
    }
  };
  await waitFor((e) => e.name === "connection");
  return {
    events,
    get connectionId() {
      return connectionId;
    },
    get closed() {
      return closed;
    },
    waitFor,
    close: () => ctl.abort(),
  };
}

async function waitState(srv, target, state, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await rpc(srv, "get_running_session", { target });
    if (r.json?.process_state === state) return r.json;
    await sleep(100);
  }
  return null;
}

const refOf = (dto) => ({ pid_domain: dto.target.pid_domain, pid: dto.target.pid, started_at: dto.target.started_at });

// コンソール API を呼ぶための小さな C#(PowerShell から使う)。
const consoleApi = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class K {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint p);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);
  [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g);
}
"@
`;

// Ctrl+C を、サーバのコンソールへ送る(送る側は無視する設定にしてから)。
function sendCtrlC(pid) {
  const script = `${consoleApi}
[K]::FreeConsole() | Out-Null
if (-not [K]::AttachConsole(${pid})) { Write-Output "attach-failed"; exit 2 }
[K]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
[K]::GenerateConsoleCtrlEvent(0, 0) | Out-Null
Start-Sleep -Milliseconds 300
`;
  return execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
}

async function main() {
  console.log(`使い捨ての場所: ${root}`);
  const srv = startServer();
  await waitHealthy(srv);
  if (viaNext) {
    await startNext();
    console.log(`  Next の中継(${nextBase})を通して確かめます`);
  }
  const log = () => srv.log.join("");
  check("サーバの起動(ジョブに入った)", log().includes("ジョブオブジェクトに入りました") && log().includes("確認済み"), log().split("\n").find((l) => l.includes("ジョブ")) ?? "");
  check("偽の claude に差し替えた", log().includes("偽の claude を使います"));

  // ---- 設定 ----
  const settings = await rpc(srv, "get_settings");
  const upd = await rpc(srv, "update_settings", {
    input: {
      repository_path: slash(dirs.repo),
      github_project: null,
      selected_project_folders: [],
      claude_projects_dir: slash(projects),
    },
    expectedRevision: settings.json.revision,
  });
  check("設定(リポジトリ・会話フォルダ)の保存", upd.status === 200, upd.text);

  // ---- 2 つのタブ(接続) ----
  const tabA = await openSse(srv);
  const tabB = await openSse(srv);
  check("接続の ID が別々に配られる", tabA.connectionId && tabB.connectionId && tabA.connectionId !== tabB.connectionId, `${tabA.connectionId}, ${tabB.connectionId}`);

  // ---- 起動の防御 ----
  let r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "bogus", name: null } });
  check("守り: 権限モードは列挙だけ(不正値は 400)", r.status === 400 || r.status === 422, `${r.status}`);
  r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: "a\nb", sync_origin_main: false } });
  check("守り: 表示名の制御文字は 400", r.status === 400, `${r.status} ${r.text}`);
  r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: null, model: "../../x", sync_origin_main: false } });
  check("守り: モデルは別名の列挙だけ(自由な文字列は 400)", r.status === 400 || r.status === 422, `${r.status}`);
  r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: null, worktree: { kind: "existing", worktree_id: "../../etc" }, sync_origin_main: false } });
  check("守り: 台帳に無い worktree の ID は断る", r.status >= 400 && r.status < 500, `${r.status} ${r.text}`);
  r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: null, worktree: { kind: "branch", branch_name: "--upload-pack=calc" }, sync_origin_main: false } });
  check("守り: ブランチ名の先頭 `-` は断る", r.status >= 400 && r.status < 500, `${r.status} ${r.text}`);
  r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: null, cwd: "C:/Windows", repository_path: "C:/Windows", sync_origin_main: false } });
  check("守り: クライアントのパスは使われない(余分な項目は無視され、起動先はプロファイルのリポジトリ)", r.status === 200 && slash(r.json.cwd ?? "").toLowerCase().startsWith(slash(dirs.repo).toLowerCase()), `${r.status} cwd=${r.json?.cwd}`);
  if (r.status === 200) await rpc(srv, "stop_running_session", { target: refOf(r.json) });

  r = await rpc(srv, "subscribe_running_session_progress", { target: { pid_domain: "x", pid: 1, started_at: 1 }, connectionId: 999999 });
  check("守り: 無い接続への購読は 404", r.status === 404, `${r.status}`);

  // ---- 新規セッションの起動 ----
  r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: "e2e-a", sync_origin_main: false } });
  check("新規セッションの起動", r.status === 200 && r.json.process_state, `${r.status} ${r.text.slice(0, 200)}`);
  const session = r.json;
  const target = refOf(session);
  const idle = await waitState(srv, target, "idle");
  check("起動 → 待機(idle)", !!idle);
  const claudePids = descendants(srv.child.pid);
  check("claude(node)がサーバの子孫にいる", claudePids.length > 0, `子孫 PID: ${claudePids.join(",")}`);

  const dup = await rpc(srv, "start_running_session", { request: { kind: "resume", project: projectName, session_id: session.session_id, mode: "default", name: null, sync_origin_main: false } });
  check("守り: 動いている同じ会話の二重起動は 409(session_busy)", dup.status === 409 && dup.json?.code === "session_busy", `${dup.status} ${dup.text}`);

  // ---- 購読(2 つのタブ) ----
  const subA = (await rpc(srv, "subscribe_running_session_progress", { target, connectionId: tabA.connectionId })).json;
  const subB = (await rpc(srv, "subscribe_running_session_progress", { target, connectionId: tabB.connectionId })).json;
  check("購読 ID が返る", Number.isInteger(subA) && Number.isInteger(subB) && subA !== subB, `${subA}, ${subB}`);

  // ---- 送信 → 途中経過 ----
  r = await rpc(srv, "send_to_running_session", { target, text: "hello", images: [] });
  check("送信", r.status === 200, r.text);
  const gotA = await tabA.waitFor((e) => e.name === "running-session:progress" && e.data.subscription_id === subA && e.data.progress.event?.kind === "text_delta");
  const gotB = await tabB.waitFor((e) => e.name === "running-session:progress" && e.data.subscription_id === subB && e.data.progress.event?.kind === "text_delta");
  check("2 つのタブの両方に途中経過が届く", !!gotA && !!gotB);
  const doneA = await tabA.waitFor((e) => e.name === "running-session:progress" && e.data.progress.event?.kind === "turn_finished");
  check("ターン終了の途中経過が届く(順序: 断片 → 終了)", !!doneA && tabA.events.indexOf(gotA) < tabA.events.indexOf(doneA));
  check("running-session:changed の通知が全タブに届く", !!(await tabB.waitFor((e) => e.name === "running-session:changed")));
  await waitState(srv, target, "idle");

  // ---- タブ B を閉じても、A は止まらない / claude も止まらない ----
  tabB.close();
  await sleep(500);
  r = await rpc(srv, "send_to_running_session", { target, text: "after close", images: [] });
  const gotA2 = await tabA.waitFor((e) => e.name === "running-session:progress" && e.data.progress.event?.kind === "text_delta" && JSON.stringify(e.data).includes("after close"));
  check("1 つのタブを閉じても、もう一方は途中経過を受け取り続ける", r.status === 200 && !!gotA2);
  r = await rpc(srv, "unsubscribe_running_session_progress", { subscriptionId: subA, connectionId: tabB.connectionId });
  r = await rpc(srv, "send_to_running_session", { target, text: "still A", images: [] });
  check("守り: 他の接続の購読は外せない(購読 ID だけでは外れない)", !!(await tabA.waitFor((e) => JSON.stringify(e.data).includes("still A"))));
  await waitState(srv, target, "idle");

  // ---- 権限の問い合わせ ----
  r = await rpc(srv, "send_to_running_session", { target, text: "PERM", images: [] });
  const waiting = await waitState(srv, target, "awaiting_permission");
  check("権限の問い合わせで答え待ちになる", !!waiting && waiting.permission_requests.length === 1);
  r = await rpc(srv, "respond_permission", { target, requestId: waiting.permission_requests[0].request_id, behavior: "allow" });
  check("権限に答える(許可)", r.status === 200, r.text);
  check("答えたあと待機へ戻る", !!(await waitState(srv, target, "idle")));

  // ---- 中断 ----
  await rpc(srv, "send_to_running_session", { target, text: "SLOW", images: [] });
  check("実行中(running)になる", !!(await waitState(srv, target, "running")));
  r = await rpc(srv, "interrupt_running_session", { target });
  check("中断", r.status === 200 && !!(await waitState(srv, target, "idle")), r.text);

  // ---- 切り替え ----
  r = await rpc(srv, "switch_running_session", { target, switch: { kind: "permission_mode", mode: "accept_edits" } });
  await sleep(400);
  const sw = (await rpc(srv, "get_running_session", { target })).json;
  check("権限モードの切り替え", r.status === 200 && sw.current_permission_mode === "acceptEdits", `${sw.current_permission_mode}`);
  r = await rpc(srv, "switch_running_session", { target, switch: { kind: "model", model: "haiku" } });
  check("モデルの切り替え", r.status === 200, r.text);
  r = await rpc(srv, "switch_running_session", { target, switch: { kind: "model", model: "x y;&" } });
  check("守り: モデル名の不正な文字は 400", r.status === 400, `${r.status}`);

  // ---- 本文の大きさ ----
  const big = "x".repeat(2.5 * 1024 * 1024);
  r = await rpc(srv, "get_running_session", {}, { raw: JSON.stringify({ target, pad: big }) });
  check("守り: ふつうの command は 2MB 超で 413", r.status === 413, `${r.status}`);
  const huge = "x".repeat(27 * 1024 * 1024);
  r = await rpc(srv, "send_to_running_session", {}, { raw: JSON.stringify({ target, text: huge, images: [] }) });
  check("守り: send_to_running_session も 26MB 超で 413", r.status === 413, `${r.status}`);
  r = await rpc(srv, "send_to_running_session", {}, { raw: JSON.stringify({ target, text: "y".repeat(3 * 1024 * 1024), images: [] }) });
  check("send_to_running_session は 2MB を超える本文を受け付ける(3MB)", r.status === 200, `${r.status}`);
  await waitState(srv, target, "idle");
  r = await rpc(srv, "send_to_running_session", {}, { raw: JSON.stringify({ target, text: "z".repeat(24 * 1024 * 1024), images: [] }) });
  check("send_to_running_session は 24MB(画像の上限に近い大きさ)も通る(中継でも切られない)", r.status === 200, `${r.status}`);
  await waitState(srv, target, "idle", 30000);

  // ---- 利用状況・一覧 ----
  r = await rpc(srv, "list_running_sessions");
  check("一覧に載る", r.status === 200 && r.json.some((s) => s.session_id === session.session_id));
  r = await rpc(srv, "get_claude_usage");
  check("利用状況の取得(まだ無ければ空の値)", r.status === 200, r.text.slice(0, 80));

  // ---- ブラウザを全部閉じても claude は動き続け、開き直すと状態が見える ----
  tabA.close();
  await sleep(500);
  const stillAlive = claudePids.filter(alive);
  check("ブラウザ(全タブ)を閉じても claude は動き続ける", stillAlive.length === claudePids.length, `${stillAlive.length}/${claudePids.length}`);
  const tabC = await openSse(srv);
  const seen = (await rpc(srv, "get_running_session", { target })).json;
  check("開き直すと状態が見える", seen?.process_state === "idle" && tabC.connectionId);
  tabC.close();

  // ---- 停止(利用者の操作)→ 控えから外れる ----
  r = await rpc(srv, "stop_running_session", { target });
  check("停止", r.status === 200 && !!(await waitState(srv, target, "exited")), r.text);
  const saved1 = JSON.parse(fs.readFileSync(path.join(dirs.data, "running-sessions.json"), "utf8"));
  check("停止したものは再開の控えから外れる", !(saved1.sessions ?? []).some((s) => s.session_id === session.session_id));

  // ---- 再開(Resume)と、同時の二重再開 ----
  const convId = "3a392392-0000-4000-8000-0000000000aa";
  fs.writeFileSync(
    path.join(projects, projectName, `${convId}.jsonl`),
    JSON.stringify({ type: "user", sessionId: convId, cwd: dirs.repo, message: { role: "user", content: "hi" } }) + "\n",
  );
  const resumeBody = { request: { kind: "resume", project: projectName, session_id: convId, mode: "default", name: "e2e-r", sync_origin_main: false } };
  const [p1, p2] = await Promise.all([rpc(srv, "start_running_session", resumeBody), rpc(srv, "start_running_session", resumeBody)]);
  const codes = [p1.status, p2.status].sort();
  check("守り: 同時の二重再開は 1 本だけ通り、もう 1 本は 409", codes[0] === 200 && codes[1] === 409, `${codes}`);
  const resumed = [p1, p2].find((x) => x.status === 200).json;
  const rtarget = refOf(resumed);
  check("再開 → 待機", !!(await waitState(srv, rtarget, "idle")));

  // ---- Ctrl+C: 穏やかに止まり、claude は残らない ----
  // 標準入力を閉じても終了しない claude(HANG)でも、残らない(穏やかに止められなければ強制終了する)。
  await rpc(srv, "send_to_running_session", { target: rtarget, text: "HANG", images: [] });
  await waitState(srv, rtarget, "idle");
  const before = descendants(srv.child.pid);
  console.log(`  Ctrl+C の前の子孫: ${before.join(",") || "(なし)"}`);
  const sent = sendCtrlC(srv.child.pid);
  const code = await Promise.race([srv.exited, sleep(15000).then(() => "timeout")]);
  check("Ctrl+C でサーバが終了する", code !== "timeout", `exit=${code} ${sent}`);
  await sleep(500);
  check("Ctrl+C のあと、claude(子孫)が 0 件", before.filter(alive).length === 0, `残り: ${before.filter(alive).join(",") || 0}`);
  check("終了の合図の対応(ログ)", log().includes("終了します(Ctrl+C)") || log().includes("終了します"), log().split("\n").find((l) => l.includes("終了します")) ?? "");
  const saved2 = JSON.parse(fs.readFileSync(path.join(dirs.data, "running-sessions.json"), "utf8"));
  check("終了しても、再開の控えは残る", (saved2.sessions ?? []).some((s) => s.session_id === convId));

  // ---- 再起動 → 自動再開 ----
  const srv2 = startServer();
  await waitHealthy(srv2);
  let restored = null;
  for (let i = 0; i < 100 && !restored; i++) {
    const l = await rpc(srv2, "list_running_sessions");
    restored = (l.json ?? []).find((s) => s.session_id === convId && s.process_state === "idle");
    if (!restored) await sleep(150);
  }
  check("サーバの再起動で、前回のセッションが自動で再開される", !!restored);
  const tabD = await openSse(srv2);
  check("再起動後の接続にも状態が見える(リロード不要で取り直せる)", !!tabD.connectionId && !!restored);
  tabD.close();

  // ---- 二重起動(同じデータフォルダ) ----
  const tokenBefore = fs.readFileSync(path.join(dirs.data, "server-token"), "utf8");
  const portBefore = fs.readFileSync(path.join(dirs.data, "server-port"), "utf8");
  const second = runServerOnce();
  const secondCode = await Promise.race([second.exited, sleep(8000).then(() => "timeout")]);
  check("守り: 同じデータフォルダの 2 つ目のサーバは断られる", secondCode === 1 && second.log.join("").includes("このデータフォルダはほかのサーバが使っています"), `exit=${secondCode} ${second.log.join("").trim().split("\n").pop()}`);
  check("守り: 断られた 2 つ目はトークン・ポートを書き換えていない", fs.readFileSync(path.join(dirs.data, "server-token"), "utf8") === tokenBefore && fs.readFileSync(path.join(dirs.data, "server-port"), "utf8") === portBefore);
  check("1 つ目は無事", (await fetch(`${srv2.base}/health`)).ok);

  // ---- 強制終了: 子孫が残らない(ジョブオブジェクト) ----
  // 標準入力が閉じても終了しない claude(HANG)にしておく(でないと、サーバが死んだ時点で標準入力が
  // 閉じて、claude が自分で終わってしまい、ジョブの効き目を確かめられない)。
  await rpc(srv2, "send_to_running_session", { target: { pid_domain: restored.target.pid_domain, pid: restored.target.pid, started_at: restored.target.started_at }, text: "HANG", images: [] });
  await waitState(srv2, restored.target, "idle");
  const snapshot = descendants(srv2.child.pid);
  console.log(`  強制終了の前の子孫: ${snapshot.join(",") || "(なし)"}`);
  execFileSync("taskkill", ["/PID", String(srv2.child.pid), "/F"], { stdio: "pipe" });
  await srv2.exited;
  await sleep(1500);
  const left = snapshot.filter(alive);
  check("強制終了のあと、子孫が 0 件(ジョブオブジェクトが止めた)", snapshot.length > 0 && left.length === 0, `前 ${snapshot.length} 件 → 残り ${left.length} 件`);

  // ---- 対照実験: ジョブの外では、親を殺しても子が残る ----
  // (親に node は使えない: node 自身が子を「親が死ぬと一緒に止まる」ジョブへ入れるため。PowerShell を親にする。)
  const parent = spawn(
    "powershell",
    ["-NoProfile", "-Command", "$k = Start-Process node -ArgumentList '-e','setInterval(()=>{},1000)' -PassThru -WindowStyle Hidden; Write-Output $k.Id; Start-Sleep 600"],
    { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  const kidPid = await new Promise((resolve) => parent.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
  startedPids.push(parent.pid, kidPid);
  execFileSync("taskkill", ["/PID", String(parent.pid), "/F"], { stdio: "pipe" });
  await sleep(500);
  check("対照: ジョブの外の親を殺すと、子は残る(この確認は「残る」を検出できる)", alive(kidPid), `子 PID ${kidPid} は ${alive(kidPid) ? "残った" : "消えた"}`);
}

try {
  await main();
} catch (e) {
  console.error("スクリプトの失敗:", e);
  process.exitCode = 1;
} finally {
  // 後始末: このスクリプトが起動したサーバだけを、PID 指定で止める(名前一致の一括終了はしない)。
  for (const pid of startedPids) {
    if (alive(pid)) {
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "pipe" });
      } catch {}
    }
  }
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 件が通りました`);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
}
