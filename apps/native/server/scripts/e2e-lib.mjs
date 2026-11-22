// 実行中セッションの確認スクリプトの共通部分(使い捨ての場所・サーバの起動・HTTP・SSE・プロセスの木)。
// `e2e-running.mjs`(偽の claude)と `e2e-real-claude.mjs`(本物の claude 1 件)が使う。
//
// 止めるのは、**起動した PID とその子孫だけ**(名前一致の一括終了はしない)。

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alive, descendantsOf, isMine, killIfMine, killTreeIfMine, recordIdentity } from "./proc-safety.mjs";

// プロセスの生死の判定・子孫の取得・停止は、`proc-safety.mjs`(PID と開始時刻の組で、自分が起動したものか確かめる)を使う。
export { alive, killIfMine, recordIdentity };

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(here, "..", "..");
const serverExe = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? path.join(nativeDir, "target", "debug", "server.exe");
const fakeClaude = path.join(nativeDir, "crates", "infra", "tests", "fake_claude.cjs");

export const results = [];
export const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const slash = (p) => p.replaceAll("\\", "/");

// ---- 使い捨ての場所 ----
export const root = fs.mkdtempSync(path.join(os.tmpdir(), "yyz-e2e-"));
export const dirs = {
  data: path.join(root, "data"),
  home: path.join(root, "home"),
  repo: path.join(root, "repo"),
};
export const projects = path.join(dirs.home, ".claude", "projects");
export const projectName = "e2e-project";
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
// 子孫(確かめたものだけ。親より前に始まったものは、親 PID が一致しても子とみなさない)。見つけたものは、PID と
// 開始時刻の組を控える(あとの生死の判定が、PID の再利用に惑わされない)。コンソールのホスト(conhost.exe)は入れない。
export function descendants(pid) {
  const found = descendantsOf(pid);
  found.forEach((p) => recordIdentity(p));
  return found;
}

// ---- サーバの起動 ----
export const startedPids = [];
let nextPort = 14300 + Math.floor(Math.random() * 400);
// `--real`: 本物の claude を使う(`e2e-real-claude.mjs`)。本物の claude は `~/.claude` の認証が要るので、
// ホーム(USERPROFILE/HOME)は差し替えない。データフォルダ・リポジトリだけが使い捨て。
export const real = process.argv.includes("--real");
const serverEnv = (dataDir, port) => {
  const env = { ...process.env, YAOYOROZU_DATA_DIR: dataDir, YAOYOROZU_SERVER_PORT: String(port) };
  if (real) {
    delete env.YAOYOROZU_SERVER_FAKE_CLAUDE;
    return env;
  }
  return { ...env, YAOYOROZU_SERVER_FAKE_CLAUDE: fakeClaude, USERPROFILE: dirs.home, HOME: dirs.home };
};
// 自分専用の(非表示の)コンソールで起動する。Ctrl+C をそのコンソールへだけ送るため
// (このスクリプトや他のセッションのコンソールへは届かない)。出力はファイルへ。
export function startServer({ dataDir = dirs.data, port = nextPort++ } = {}) {
  const out = path.join(root, `server-${port}.out`);
  const err = path.join(root, `server-${port}.err`);
  const pidFile = path.join(root, `server-${port}.pid`);
  const command = `${consoleApi}
[K]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) | Out-Null
$p = Start-Process -FilePath '${serverExe}' -WindowStyle Hidden -PassThru -RedirectStandardOutput '${out}' -RedirectStandardError '${err}'; $p.Id | Out-File -Encoding ascii '${pidFile}'`;
  // 標準入出力は捨てる(つながったままだと、子のサーバがパイプを持ち続けて、この呼び出しが終わらない)。
  execFileSync("powershell", ["-NoProfile", "-Command", command], { env: serverEnv(dataDir, port), stdio: "ignore" });
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  // 起動した直後に、PID と開始時刻の組を控える(止める前に、自分が起動したものか確かめるため)。
  recordIdentity(pid);
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
export function runServerOnce({ dataDir = dirs.data, port = nextPort++ } = {}) {
  const child = spawn(serverExe, [], { env: serverEnv(dataDir, port), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  recordIdentity(child.pid);
  startedPids.push(child.pid);
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, log, exited };
}
export async function waitHealthy(srv) {
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
export const token = (srv) => fs.readFileSync(path.join(srv.dataDir, "server-token"), "utf8").trim();

// `--next`: ブラウザと同じ道(Next の中継 `/api/*`。トークンは中継が付ける)を通して確かめる。
// 先に `apps/console` で `npx next build` しておく。
export const viaNext = process.argv.includes("--next");
const consolePort = 3300 + Math.floor(Math.random() * 90);
export const nextBase = `http://127.0.0.1:${consolePort}`;
const rpcUrl = (srv, command) => (viaNext ? `${nextBase}/api/rpc/${command}` : `${srv.base}/rpc/${command}`);
const eventsUrl = (srv) => (viaNext ? `${nextBase}/api/events` : `${srv.base}/events`);
const authHeaders = (srv) => (viaNext ? { origin: nextBase } : { authorization: `Bearer ${token(srv)}` });

export async function startNext() {
  const consoleDir = path.join(nativeDir, "..", "console");
  const nextBin = path.join(nativeDir, "..", "..", "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(consolePort)], {
    cwd: consoleDir,
    env: { ...process.env, YAOYOROZU_DATA_DIR: dirs.data, NODE_ENV: "production" },
    windowsHide: true,
    stdio: "ignore",
  });
  recordIdentity(child.pid);
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

export async function rpc(srv, command, body = {}, { raw } = {}) {
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
export async function openSse(srv) {
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

export async function waitState(srv, target, state, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await rpc(srv, "get_running_session", { target });
    if (r.json?.process_state === state) return r.json;
    await sleep(100);
  }
  return null;
}

export const refOf = (dto) => ({ pid_domain: dto.target.pid_domain, pid: dto.target.pid, started_at: dto.target.started_at });

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
export function sendCtrlC(pid) {
  // 自分が起動したものでなければ送らない(PID が別のプロセスへ再利用されていると、そのコンソールへ Ctrl+C を送ってしまう)。
  if (!isMine(pid)) return "refused(自分が起動したものか確かめられない)";
  const script = `${consoleApi}
[K]::FreeConsole() | Out-Null
if (-not [K]::AttachConsole(${pid})) { Write-Output "attach-failed"; exit 2 }
[K]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
[K]::GenerateConsoleCtrlEvent(0, 0) | Out-Null
Start-Sleep -Milliseconds 300
`;
  return execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
}


/**
 * 後片付け: このスクリプトが起動したもの(`startedPids` と、`extra`)を止める。**PID と開始時刻の組が控えと一致するものだけ**を、
 * 確かめた子孫ごと、1 つずつ止める(一致しないものは止めず、ログに出す。名前一致・`/T` の一括終了はしない)。
 * `extra` の PID は、見つけた直後に `recordIdentity` で控えたもの(控えが無ければ止めない)。
 */
export function cleanupStarted(extra = []) {
  for (const pid of new Set([...extra, ...startedPids])) {
    killTreeIfMine(pid);
  }
}
