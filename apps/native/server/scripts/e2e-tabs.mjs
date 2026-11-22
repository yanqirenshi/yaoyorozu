// 実際の画面(`next start`)と実際のサーバ(exe・偽の claude)で、タブ 10 個以上を同時に開き、通知と途中経過の WebSocket を確かめる
// (issue #636 の完了条件)。Chrome / Edge(使い捨てのプロフィール・headless=new・CDP で操作)。
//
// 確かめること: 全タブがつながる・会話を表示する / 途中経過が全タブに届く / 操作(rpc)が全タブで同時でも遅くならない /
// 10 個つながったまま新しいタブを開ける / 凍結されたタブが戻ったときにつなぎ直す / サーバを再起動しても、リロード無しで戻る。
//
// 使い方(`apps/native` で `cargo build -p server` と、`apps/console` で `next build` のあと):
//   $env:TABS_BROWSER = "chrome"; $env:TABS_COUNT = 10; node server/scripts/e2e-tabs.mjs
//
// 起動したブラウザ・サーバ・next は、PID と開始時刻を控え(proc-safety.mjs)、その子孫だけを止める(名前一致の一括終了はしない)。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendCtrlC, alive, cleanupStarted, dirs, nextBase, projectName, projects, results, root, rpc, sleep, slash, startedPids, startNext, startServer, waitHealthy, refOf, waitState } from "./e2e-lib.mjs";
import { killTreeIfMine, recordIdentity } from "./proc-safety.mjs";

const browserName = process.env.TABS_BROWSER ?? "chrome";
const TABS = Number(process.env.TABS_COUNT ?? 10);
const exe = browserName === "edge" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "C:/Program Files/Google/Chrome/Application/chrome.exe";
const convId = "3a392392-0000-4000-8000-000000000001";
const line = (o) => JSON.stringify(o) + "\n";
const CDP_PORT = 9400 + Math.floor(Math.random() * 90);

let browser = null;
// 使い捨てのブラウザのプロフィール(ブラウザを止めてから消す)。
let profileDir = null;
let cdp;
let id = 0;
const pending = new Map();
const sessionHandlers = new Map();

async function connectCdp() {
  for (let i = 0; i < 100; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      cdp = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => { cdp.onopen = res; cdp.onerror = rej; });
      cdp.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        else if (m.method && m.sessionId) sessionHandlers.get(m.sessionId)?.(m);
      };
      return v.Browser;
    } catch { await sleep(200); }
  }
  throw new Error("CDP につながりません");
}
const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); cdp.send(JSON.stringify({ id: i, method, params, sessionId })); });

async function newTab(url) {
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  const tab = { targetId, sessionId, created: 0, closed: 0, frames: 0, progressFrames: 0, errors: [] };
  sessionHandlers.set(sessionId, (m) => {
    if (m.method === "Network.webSocketCreated") tab.created += 1;
    if (m.method === "Network.webSocketClosed") tab.closed += 1;
    if (m.method === "Network.webSocketFrameReceived") {
      tab.frames += 1;
      if (String(m.params.response?.payloadData).includes('"type":"progress"')) tab.progressFrames += 1;
    }
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400) tab.errors.push("HTTP " + m.params.response.status + " " + m.params.response.url);
    if (m.method === "Runtime.exceptionThrown") tab.errors.push(m.params.exceptionDetails?.text);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") tab.errors.push(m.params.entry.text);
  });
  await send("Network.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", { url }, sessionId);
  return tab;
}
const evalIn = async (tab, expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, tab.sessionId)).result?.result?.value;

async function main() {
  // ---- サーバ・画面 ----
  const convFile = path.join(projects, projectName, `${convId}.jsonl`);
  process.env.FAKE_CLAUDE_SESSION_FILE = convFile;
  const srv = startServer();
  await waitHealthy(srv);
  await startNext();
  const settings = await rpc(srv, "get_settings");
  await rpc(srv, "update_settings", {
    input: { repository_path: slash(dirs.repo), github_project: null, selected_project_folders: [projectName], claude_projects_dir: slash(projects) },
    profileId: settings.json.active_profile_id, expectedRevision: settings.json.revision, expectedGlobalRevision: settings.json.global_revision,
  });
  fs.writeFileSync(convFile,
    line({ type: "user", uuid: "u-1", sessionId: convId, cwd: dirs.repo, timestamp: "2026-11-22T00:00:01.000Z", message: { role: "user", content: "最初の質問です" } }) +
    line({ type: "assistant", uuid: "a-1", sessionId: convId, cwd: dirs.repo, timestamp: "2026-11-22T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "最初の返事です" }] } }));
  const started = await rpc(srv, "start_running_session", { request: { kind: "resume", project: projectName, session_id: convId, mode: "default", name: null, sync_origin_main: false } });
  const target = refOf(started.json);
  await waitState(srv, target, "idle");

  // ---- ブラウザ ----
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tabs10-"));
  profileDir = profile;
  browser = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore", windowsHide: true });
  recordIdentity(browser.pid);
  const version = await connectCdp();
  console.log(`== ${browserName}: ${version} / タブ ${TABS} 個(画面 ${nextBase} / サーバ ${srv.port})`);

  const url = `${nextBase}/profiles/default?project=${projectName}&session=${convId}`;
  const tabs = [];
  const t0 = Date.now();
  for (let i = 0; i < TABS; i++) tabs.push(await newTab(url));
  // 全部が、つながるまで。
  for (let i = 0; i < 100; i++) {
    if (tabs.every((t) => t.frames > 0)) break;
    await sleep(200);
  }
  console.log(`全タブがつながって最初のメッセージ(ready)を受けるまで: ${Date.now() - t0} ms(つながったタブ ${tabs.filter((t) => t.frames > 0).length}/${TABS})`);

  // 全タブが、会話を表示し、途中経過の購読を済ませる時間。
  await sleep(2500);
  const shown = (await Promise.all(tabs.map((t) => evalIn(t, "document.body.innerText.includes('最初の質問です')")))).filter(Boolean).length;
  console.log(`会話の内容を表示したタブ: ${shown}/${TABS}`);

  // ---- 途中経過: SLOW(100ms ごとに断片)を 4 秒流し、全タブに届くか ----
  const before = tabs.map((t) => t.progressFrames);
  await rpc(srv, "send_to_running_session", { target, text: "SLOW", images: [] });
  await sleep(4000);
  const got = tabs.map((t, i) => t.progressFrames - before[i]);
  console.log(`途中経過のフレーム(4 秒): 最少 ${Math.min(...got)} / 最大 ${Math.max(...got)}(届いたタブ ${got.filter((n) => n > 10).length}/${TABS})`);
  const live = (await Promise.all(tabs.map((t) => evalIn(t, "/\\d{2,}/.test(document.body.innerText)")))).filter(Boolean).length;
  console.log(`返答の途中の表示(断片の数字)が出ているタブ: ${live}/${TABS}`);

  // ---- 操作(rpc): 全タブで同時に 10 回ずつ ----
  const latencies = (await Promise.all(tabs.map((t) => evalIn(t, `(async()=>{const r=[];for(let i=0;i<10;i++){const s=performance.now();const x=await fetch('/api/rpc/list_running_sessions',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await x.text();r.push(Math.round(performance.now()-s));}return r;})()`)))).flat();
  latencies.sort((a, b) => a - b);
  console.log(`操作(rpc)${latencies.length} 回(全タブ同時): 中央値 ${latencies[Math.floor(latencies.length / 2)]} ms・最大 ${latencies.at(-1)} ms`);

  // ---- 新しいタブの読み込み(10 個つながったまま) ----
  const t1 = Date.now();
  const extra = await newTab(url);
  for (let i = 0; i < 200; i++) {
    if ((await evalIn(extra, "document.body?.innerText.includes('最初の質問です')")) === true) break;
    await sleep(50);
  }
  console.log(`${TABS + 1} 個目のタブが会話を表示するまで: ${Date.now() - t1} ms`);

  // ---- 凍結 → 復帰 ----
  const victim = tabs[0];
  const createdBefore = victim.created;
  await send("Page.setWebLifecycleState", { state: "frozen" }, victim.sessionId);
  await sleep(12000);
  const framesBeforeThaw = victim.progressFrames;
  await send("Page.setWebLifecycleState", { state: "active" }, victim.sessionId);
  await sleep(6000);
  console.log(`凍結 12 秒のあと: 新しい接続 ${victim.created - createdBefore} 本・閉じた ${victim.closed} 回・戻ったあとの途中経過 ${victim.progressFrames - framesBeforeThaw} フレーム`);

  // ---- サーバの再起動(リロード無しで戻る) ----
  await rpc(srv, "interrupt_running_session", { target });
  const createdAt = tabs.map((t) => t.created);
  sendCtrlC(srv.child.pid);
  for (let i = 0; i < 100 && alive(srv.child.pid); i++) await sleep(100);
  const srv2 = startServer({ port: srv.port });
  await waitHealthy(srv2);
  let restored = null;
  for (let i = 0; i < 100 && !restored; i++) {
    const l = await rpc(srv2, "list_running_sessions");
    restored = (l.json ?? []).find((x) => x.session_id === convId && x.process_state === "idle");
    if (!restored) await sleep(150);
  }
  await sleep(4000);
  const reconnected = tabs.filter((t, i) => t.created > createdAt[i]).length;
  console.log("サーバを再起動: 前回のセッションの自動再開 " + (restored ? "あり" : "なし") + "・自分でつなぎ直したタブ " + reconnected + "/" + TABS + "(リロードはしていない)");
  const target2 = restored ? refOf(restored) : target;
  const before2 = tabs.map((t) => t.progressFrames);
  await rpc(srv2, "send_to_running_session", { target: target2, text: "SLOW", images: [] });
  await sleep(4000);
  const got2 = tabs.map((t, i) => t.progressFrames - before2[i]);
  console.log("再起動のあとの途中経過(4 秒): 最少 " + Math.min(...got2) + " / 最大 " + Math.max(...got2) + "(届いたタブ " + got2.filter((n) => n > 10).length + "/" + TABS + ")");
  await rpc(srv2, "stop_running_session", { target: target2 });
  // 止める(SLOW を終わらせる)。
  await rpc(srv, "stop_running_session", { target });
  const errors = tabs.flatMap((t) => t.errors).filter(Boolean);
  console.log("画面のエラー:", errors.length, JSON.stringify([...new Set(errors)]));
}

let failed = false;
try {
  await main();
} catch (e) {
  failed = true;
  console.error("失敗:", e);
} finally {
  try { cdp?.close(); } catch {}
  await sleep(500);
  // 使い捨てのプロフィールは、ブラウザを止めて(ファイルを持たなくなって)から消す(先に消すと EPERM になる)。
  if (browser) killTreeIfMine(browser.pid, { log: () => {} });
  cleanupStarted();
  await sleep(1500);
  for (const dir of [profileDir, root]) {
    if (!dir) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      failed = true;
      console.error("使い捨てのフォルダを消せません(" + dir + "): " + (e.code ?? e));
    }
  }
  // 失敗したら、0 以外で終わる。
  process.exit(failed ? 1 : 0);
}
