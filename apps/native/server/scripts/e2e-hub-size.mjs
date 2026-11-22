// `get_pc` の大きさと時間の測定(issue #639 の A。数字を見て、差分・圧縮・進捗の間は取り直さない、のどれを行うかを決めるため)。
// **使い捨て**のデータフォルダ・ホーム・会話フォルダに、会話ファイルを N 件(5 件に 1 件は、サブエージェントのファイル 2 つつき)置いて、
// 実際のサーバ(exe)と `next start` を起動し、次を測る:
//   - 起動時の読み込みが終わったあとの `get_pc` の応答の大きさ・サーバの時間(直接)・中継を通した時間(Next 経由)
//   - 全件の走査(`reconcile_git_state`)の最中の、ハブと同じ取り直し(進捗の通知のたびに、300ms の間引きで `get_pc`)の回数と合計の転送量
//
// 使い方(`apps/native` で `cargo build -p server`、`apps/console` で `next build` のあと):
//   $env:HUB_SIZES = "500,2000,5000"; node server/scripts/e2e-hub-size.mjs
//
// 止めるのは、このスクリプトが起動した PID とその子孫だけ。

import fs from "node:fs";
import path from "node:path";
import {
  alive, cleanupStarted, dirs, nextBase, openWs, projects, results, root, rpc, sendCtrlC, sleep, slash, startNext, startServer, token, waitHealthy,
} from "./e2e-lib.mjs";

const SIZES = (process.env.HUB_SIZES ?? "500,2000,5000").split(",").map(Number);
const PROJECTS = 10;
const line = (o) => JSON.stringify(o) + "\n";

function generate(count) {
  fs.rmSync(projects, { recursive: true, force: true });
  let subagents = 0;
  for (let i = 0; i < count; i++) {
    const project = path.join(projects, `proj-${i % PROJECTS}`);
    fs.mkdirSync(project, { recursive: true });
    const id = `3a392392-${String(Math.floor(i / 65536)).padStart(4, "0")}-4000-8000-${String(i).padStart(12, "0")}`;
    let text = "";
    for (let n = 0; n < 6; n++) {
      const ts = new Date(Date.UTC(2026, 10, 1, 0, 0, i % 3600, n)).toISOString();
      text += line({ type: "user", uuid: `u${n}`, sessionId: id, cwd: dirs.repo, gitBranch: `feature/b${i % 40}`, timestamp: ts, message: { role: "user", content: `質問 ${i}-${n}: ${"あ".repeat(80)}` } });
      text += line({ type: "assistant", uuid: `a${n}`, sessionId: id, cwd: dirs.repo, gitBranch: `feature/b${i % 40}`, timestamp: ts, message: { role: "assistant", content: [{ type: "text", text: `返事 ${i}-${n}: ${"い".repeat(120)}` }] } });
    }
    fs.writeFileSync(path.join(project, `${id}.jsonl`), text);
    if (i % 5 === 0) {
      const dir = path.join(project, id, "subagents");
      fs.mkdirSync(dir, { recursive: true });
      for (const k of ["a", "b"]) {
        fs.writeFileSync(path.join(dir, `agent-${k}${i}.jsonl`), line({ type: "user", uuid: "s1", sessionId: id, isSidechain: true, cwd: dirs.repo, timestamp: new Date().toISOString(), message: { role: "user", content: "調べて" } }));
        fs.writeFileSync(path.join(dir, `agent-${k}${i}.meta.json`), JSON.stringify({ agentType: "Explore", description: `調査 ${k}` }));
        subagents += 1;
      }
    }
  }
  return subagents;
}

const kb = (n) => `${Math.round(n / 1024)}KB`;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timedGetPc(srv) {
  const t0 = performance.now();
  const direct = await fetch(`${srv.base}/rpc/get_pc`, { method: "POST", headers: { authorization: `Bearer ${token(srv)}`, "content-type": "application/json" }, body: "{}" });
  const body = await direct.arrayBuffer();
  const directMs = performance.now() - t0;
  const t1 = performance.now();
  const relayed = await fetch(`${nextBase}/api/rpc/get_pc`, { method: "POST", headers: { origin: nextBase, "content-type": "application/json" }, body: "{}" });
  const relayedBody = await relayed.arrayBuffer();
  const relayedMs = performance.now() - t1;
  return { bytes: body.byteLength, relayedBytes: relayedBody.byteLength, directMs, relayedMs, json: JSON.parse(new TextDecoder().decode(body)) };
}

async function measure(count) {
  const subagents = generate(count);
  const srv = startServer();
  await waitHealthy(srv);
  const settings = await rpc(srv, "get_settings");
  await rpc(srv, "update_settings", {
    input: { repository_path: slash(dirs.repo), github_project: null, selected_project_folders: [], claude_projects_dir: slash(projects) },
    profileId: settings.json.active_profile_id,
    expectedRevision: settings.json.revision,
    expectedGlobalRevision: settings.json.global_revision,
  });
  const tab = await openWs(srv);
  // 起動時の読み込みが終わるのを待つ(終わっていても、もう一度走らせて、走査の最中の取り直しを測る)。
  const ready = async () => {
    for (let i = 0; i < 600; i++) {
      const r = await timedGetPc(srv);
      if (r.json.data_loaded) return r;
      await sleep(200);
    }
    throw new Error("読み込みが終わりません");
  };
  await ready();

  // 終わったあとの get_pc(5 回の中央値)。
  const samples = [];
  for (let i = 0; i < 5; i++) samples.push(await timedGetPc(srv));
  const settled = samples[0];
  const sessions = settled.json.users[0].sessions;
  const settledRow = {
    sessions: sessions.length,
    subagentFiles: subagents,
    bytes: settled.bytes,
    directMs: Math.round(median(samples.map((s) => s.directMs))),
    relayedMs: Math.round(median(samples.map((s) => s.relayedMs))),
  };

  // 走査だけ(取り直しなし)の時間と、進捗の通知の数・タイミング(比べるための基準)。
  const baseStart = tab.events.length;
  const tBase = performance.now();
  await rpc(srv, "reconcile_git_state", {});
  const answeredMs = Math.round(performance.now() - tBase);
  for (let i = 0; i < 6000; i++) {
    if (tab.events.slice(baseStart).some((e) => e.name === "pc:data_loaded")) break;
    await sleep(50);
  }
  const baseline = {
    scanOnlyMs: Math.round(performance.now() - tBase),
    reconcileAnsweredMs: answeredMs,
    progressEvents: tab.events.slice(baseStart).filter((e) => e.name === "pc:data_progress").length,
  };

  // 走査の最中: reconcile を始め、進捗の通知のたびに(300ms の間引きで)get_pc を取り直す。
  const startAt = tab.events.length;
  let fetches = 0;
  let bytes = 0;
  let relayedBytes = 0;
  let inFlight = false;
  let lastFetch = 0;
  let pending = false;
  let loaded = false;
  const t0 = performance.now();
  let stopped = false;
  const refetch = async () => {
    if (stopped) return;
    if (inFlight) { pending = true; return; }
    inFlight = true;
    lastFetch = performance.now();
    try {
      const r = await timedGetPc(srv);
      fetches += 1;
      bytes += r.bytes;
      relayedBytes += r.relayedBytes;
    } catch {
      // 止まったあとの取り直しは数えない。
    }
    inFlight = false;
    if (pending && !stopped) { pending = false; setTimeout(refetch, Math.max(0, 300 - (performance.now() - lastFetch))); }
  };
  await rpc(srv, "reconcile_git_state", {});
  let seen = startAt;
  let progressEvents = 0;
  while (!loaded && performance.now() - t0 < 400000) {
    await sleep(25);
    for (; seen < tab.events.length; seen++) {
      const name = tab.events[seen].name;
      if (name === "pc:data_progress") {
        progressEvents += 1;
        if (!inFlight && performance.now() - lastFetch >= 300) void refetch();
        else pending = true;
      }
      if (name === "pc:data_loaded") loaded = true;
    }
    if (pending && !inFlight && performance.now() - lastFetch >= 300) { pending = false; void refetch(); }
  }
  stopped = true;
  const scanMs = Math.round(performance.now() - t0);
  await sleep(500);
  tab.close();
  const scan = { scanMs, progressEvents, fetches, totalBytes: bytes, perFetchBytes: fetches ? Math.round(bytes / fetches) : 0, relayedTotalBytes: relayedBytes };
  // 後始末(サーバと next はここで止める。次の N のため)。
  return { count, settledRow, baseline, scan, srv };
}

const rows = [];
try {
  await startNext();
  for (const count of SIZES) {
    console.log(`\n== 会話ファイル ${count} 件(サブエージェント つきが 5 件に 1 件)を測ります…`);
    const { srv, ...row } = await measure(count);
    rows.push(row);
    console.log(JSON.stringify(row));
    // 次の N のために、サーバだけを止める(next は使い回す。データフォルダも同じ)。
    sendCtrlC(srv.child.pid);
    for (let i = 0; i < 100 && alive(srv.child.pid); i++) await sleep(100);
  }
  console.log("\n| 会話ファイル | get_pc の大きさ | サーバの時間(直接) | 中継を通した時間 | 走査だけの時間(取り直しなし) | reconcile の応答 | 進捗の通知 | 走査の時間(ハブと同じ取り直しをしながら) | 取り直しの回数 | 取り直しの合計の転送量 |\n|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.count} | ${kb(r.settledRow.bytes)} | ${r.settledRow.directMs}ms | ${r.settledRow.relayedMs}ms | ${r.baseline.scanOnlyMs}ms | ${r.baseline.reconcileAnsweredMs}ms | ${r.baseline.progressEvents} 件 | ${r.scan.scanMs}ms | ${r.scan.fetches} 回 | ${kb(r.scan.totalBytes)}(1 回 ${kb(r.scan.perFetchBytes)}) |`);
  }
} catch (e) {
  console.error("スクリプトの失敗:", e);
  process.exitCode = 1;
} finally {
  cleanupStarted();
  await sleep(1000);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
}
void results;
