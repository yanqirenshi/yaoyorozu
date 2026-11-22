// `/ws`(通知と途中経過の WebSocket)の守りの確認。**使い捨て**のデータフォルダ・ホーム・リポジトリで、実際のサーバ(exe)へ
// 直接つないで、結果を表で出す(issue #636 の完了条件)。
//
// 守りの表: 券なし(5 秒何も送らない)・でたらめな券・期限切れ・使用済みの券・最初のメッセージが券でない・券の前の購読・
// 大きすぎるメッセージ・Origin が違う・Origin 無し・Host が違う・券をクエリに付けた場合。
// さらに: 券をもらう rpc は、トークン無し・間違ったトークン・Host 違いを断る(`--next` なら、中継の Origin の確かめも)。サーバのログに券が出ない。
//
// 使い方(`apps/native` で `cargo build -p server` のあと):
//   node server/scripts/e2e-ws.mjs [サーバの exe のパス]
//
// 止めるのは、このスクリプトが起動した PID とその子孫だけ。期限切れの確認で 31 秒待つ。

import fs from "node:fs";
import net from "node:net";
import {
  cleanupStarted, check, consoleOrigin, dirs, nextBase, openWs, projects, results, root, rpc, sleep, slash, startNext, startServer, token, viaNext,
  waitHealthy,
} from "./e2e-lib.mjs";

const usedTickets = [];
const table = [];

/** 券を 1 枚もらう(直接のサーバの rpc。トークンつき)。 */
async function newTicket(srv) {
  const r = await rpc(srv, "issue_ws_ticket", {});
  usedTickets.push(r.json.ticket);
  return r.json.ticket;
}

/** アップグレードの要求だけを送って、応答の状態行を返す(ヘッダーを自由に決めるため、手で書く)。 */
function upgrade(srv, { path = "/ws", origin = consoleOrigin, host = `127.0.0.1:${srv.port}` } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(srv.port, "127.0.0.1", () => {
      const lines = [`GET ${path} HTTP/1.1`, `Host: ${host}`, "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13"];
      if (origin !== null) lines.push(`Origin: ${origin}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
    });
    let buf = "";
    socket.on("data", (d) => {
      buf += d.toString("latin1");
      if (buf.includes("\r\n")) {
        resolve(buf.split("\r\n")[0]);
        socket.destroy();
      }
    });
    socket.on("error", () => resolve("(接続エラー)"));
    setTimeout(() => {
      resolve("(応答なし)");
      socket.destroy();
    }, 5000);
  });
}

/** 券の rpc を、ヘッダーを自由に決めて(Host を変える)送り、状態行を返す(fetch は Host を変えられないので、手で書く)。 */
function rawTicketPost(srv, { host, bearer }) {
  return new Promise((resolve) => {
    const socket = net.connect(srv.port, "127.0.0.1", () => {
      socket.write(
        [`POST /rpc/issue_ws_ticket HTTP/1.1`, `Host: ${host}`, `Authorization: Bearer ${bearer}`, "Content-Type: application/json", "Content-Length: 2", "Connection: close", "", "{}"].join("\r\n"),
      );
    });
    let buf = "";
    socket.on("data", (d) => (buf += d.toString("latin1")));
    socket.on("close", () => resolve(buf.split("\r\n")[0] || "(応答なし)"));
    socket.on("error", () => resolve("(接続エラー)"));
  });
}

/** 接続して最初のメッセージを送り、閉じられるまでの様子を返す。 */
async function tryFirst(srv, first, { origin = consoleOrigin, waitMs = 4000 } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { origin } });
  const received = [];
  let closed = false;
  ws.addEventListener("message", (e) => received.push(String(e.data)));
  ws.addEventListener("close", () => (closed = true));
  ws.addEventListener("error", () => (closed = true));
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  if (first !== null) ws.send(first);
  const end = Date.now() + waitMs;
  while (!closed && Date.now() < end) await sleep(50);
  const ready = received.some((m) => m.includes('"ready"'));
  try {
    ws.close();
  } catch {}
  return { closed, received, ready };
}

function record(name, expected, actual, ok) {
  table.push({ name, expected, actual, ok });
  check(`守り: ${name}`, ok, `期待: ${expected} / 結果: ${actual}`);
}

async function main() {
  const srv = startServer();
  await waitHealthy(srv);
  if (viaNext) await startNext(); // 中継を通す(ブラウザと同じ道)
  const settings = await rpc(srv, "get_settings");
  await rpc(srv, "update_settings", {
    input: { repository_path: slash(dirs.repo), github_project: null, selected_project_folders: [], claude_projects_dir: slash(projects) },
    profileId: settings.json.active_profile_id,
    expectedRevision: settings.json.revision,
    expectedGlobalRevision: settings.json.global_revision,
  });

  // 正しい券は通る(対照)。
  const good = await openWs(srv);
  record("(対照)正しい券", "ready になる", good.ready ? "ready" : "つながらない", good.ready);
  good.close();

  // 券をもらう rpc の守り(トークン)。
  const noToken = await fetch(`${srv.base}/rpc/issue_ws_ticket`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  record("券の rpc: トークン無し", "401", String(noToken.status), noToken.status === 401);
  const badToken = await fetch(`${srv.base}/rpc/issue_ws_ticket`, { method: "POST", headers: { authorization: "Bearer wrong", "content-type": "application/json" }, body: "{}" });
  record("券の rpc: 間違ったトークン", "401", String(badToken.status), badToken.status === 401);
  const badHost = await rawTicketPost(srv, { host: "evil.example", bearer: token(srv) });
  record("券の rpc: Host が違う", "403", badHost, badHost.includes(" 403 "));
  if (viaNext) {
    // 中継(ブラウザと同じ道): Origin が違う・無い要求は、中継が断る(ほかの rpc と同じ)。
    const post =(headers) => fetch(`${nextBase}/api/rpc/issue_ws_ticket`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
    const evil = await post({ origin: "http://evil.example" });
    record("券の rpc(中継): Origin が違う", "403", String(evil.status), evil.status === 403);
    const noOrigin = await post({});
    record("券の rpc(中継): Origin 無し", "403", String(noOrigin.status), noOrigin.status === 403);
    const ok = await post({ origin: nextBase });
    const body = await ok.json().catch(() => ({}));
    record("(対照)券の rpc(中継): 正しい Origin", "200・券とポート", `${ok.status}・ポート ${body.port}`, ok.status === 200 && typeof body.ticket === "string" && body.port === srv.port);
    if (body.ticket) usedTickets.push(body.ticket);
  }

  // 最初のメッセージが券でない。
  const target = JSON.stringify({ type: "subscribe", request_id: 1, target: { pid_domain: "x", pid: 1, started_at: 1 } });
  for (const [name, message] of [
    ["券の前の購読", target],
    ["最初のメッセージが pong", JSON.stringify({ type: "pong" })],
    ["最初のメッセージが壊れた JSON", "{"],
  ]) {
    const r = await tryFirst(srv, message);
    record(name, "ready なしで閉じる", `${r.closed ? "閉じた" : "開いたまま"}・受信 ${r.received.length} 件`, r.closed && !r.ready && r.received.length === 0);
  }
  // でたらめな券。
  {
    const r = await tryFirst(srv, JSON.stringify({ type: "ticket", ticket: "x".repeat(96) }));
    record("でたらめな券", "ready なしで閉じる", `${r.closed ? "閉じた" : "開いたまま"}・受信 ${r.received.length} 件`, r.closed && !r.ready && r.received.length === 0);
  }
  // 使用済みの券。
  {
    const ticket = await newTicket(srv);
    const first = await tryFirst(srv, JSON.stringify({ type: "ticket", ticket }), { waitMs: 800 });
    const second = await tryFirst(srv, JSON.stringify({ type: "ticket", ticket }));
    record("使用済みの券", "1 回目 ready・2 回目は閉じる", `1 回目 ${first.ready ? "ready" : "×"}・2 回目 ${second.closed && !second.ready ? "閉じた" : "通った"}`, first.ready && second.closed && !second.ready);
  }
  // 大きすぎるメッセージ(券の前・券のあと)。
  {
    const r = await tryFirst(srv, "x".repeat(64 * 1024));
    record("大きすぎるメッセージ(券の前)", "閉じる", r.closed ? "閉じた" : "開いたまま", r.closed && !r.ready);
    const ws = await openWs(srv);
    ws.send("x".repeat(64 * 1024));
    const end = Date.now() + 4000;
    while (!ws.closed && Date.now() < end) await sleep(50);
    record("大きすぎるメッセージ(券のあと)", "閉じる", ws.closed ? "閉じた" : "開いたまま", ws.closed);
  }
  // 券をクエリに付けた場合。
  {
    const ticket = await newTicket(srv);
    const status = await upgrade(srv, { path: `/ws?ticket=${ticket}` });
    record("券をクエリに付けた", "400(受け付けない)", status, status.includes(" 400 "));
    // 券は使われていない(クエリでは何も通らない)ので、正しい使い方ではまだ通る。
    const r = await tryFirst(srv, JSON.stringify({ type: "ticket", ticket }), { waitMs: 800 });
    record("(クエリで使われなかった券は、そのまま使える)", "ready", r.ready ? "ready" : "×", r.ready);
  }
  // Origin / Host。
  for (const [name, options, expected] of [
    ["Origin が違う(別のポート)", { origin: "http://127.0.0.1:3199" }, " 403 "],
    ["Origin が違う(別のホスト)", { origin: "http://evil.example:3200" }, " 403 "],
    ["Origin 無し", { origin: null }, " 403 "],
    ["Host が違う", { host: "evil.example" }, " 403 "],
  ]) {
    const status = await upgrade(srv, options);
    record(name, "403", status, status.includes(expected));
  }
  const okStatus = await upgrade(srv, {});
  record("(対照)正しい Origin と Host", "101", okStatus, okStatus.includes(" 101 "));
  // localhost の Origin も、同じ画面のポートなら通る。
  const localhostOrigin = consoleOrigin.replace("127.0.0.1", "localhost");
  const localhostStatus = await upgrade(srv, { origin: localhostOrigin });
  record("Origin が localhost(同じ画面のポート)", "101", localhostStatus, localhostStatus.includes(" 101 "));

  // 券の前に何も送らず 5 秒。
  {
    const t0 = Date.now();
    const r = await tryFirst(srv, null, { waitMs: 8000 });
    const took = Date.now() - t0;
    record("5 秒何も送らない", "約 5 秒で閉じる(ready なし)", `${r.closed ? "閉じた" : "開いたまま"}(${Math.round(took / 100) / 10} 秒)`, r.closed && !r.ready && took >= 4500 && took < 7500);
  }

  // 期限切れ(30 秒)。
  {
    const ticket = await newTicket(srv);
    console.log("  期限切れの確認のため 31 秒待ちます…");
    await sleep(31000);
    const r = await tryFirst(srv, JSON.stringify({ type: "ticket", ticket }));
    record("期限切れの券", "ready なしで閉じる", `${r.closed ? "閉じた" : "開いたまま"}・受信 ${r.received.length} 件`, r.closed && !r.ready && r.received.length === 0);
  }

  // サーバのログに、券が出ない。
  const log = srv.log.join();
  const leaked = usedTickets.filter((t) => log.includes(t));
  record("サーバのログに券が出ない", "0 件", `${leaked.length} 件(ログ ${log.length} 文字)`, leaked.length === 0);

  console.log("\n| 守り | 期待 | 結果 | 判定 |\n|---|---|---|---|");
  for (const row of table) console.log(`| ${row.name} | ${row.expected} | ${row.result ?? row.actual} | ${row.ok ? "○" : "×"} |`);
}

try {
  await main();
} catch (e) {
  console.error("スクリプトの失敗:", e);
  process.exitCode = 1;
} finally {
  cleanupStarted();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 件が通りました`);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
}
