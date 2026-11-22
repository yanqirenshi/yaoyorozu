// 途中経過の待ち行列の大きさの上限(`progress.rs`)の確認。**使い捨て**のデータフォルダ・ホーム・リポジトリで、
// 偽の claude を動かし、**読まない接続**(ソケットを読み止めた SSE)を 1 本つなぎ、大きい送信(2MB)をくり返して、
// サーバのメモリ(プライベートバイト)の増え方を測る。
//
// 確かめること:
//   - 読まない接続があっても、サーバのメモリが上限(16MB)の近くで止まる(送信の回数に比例して増え続けない)
//   - 上限を超えて接続が外れたあと、メモリが戻る
//   - ほかの(読む)接続は、影響を受けない(途中経過が最後まで届く)
//
// 使い方(`apps/native` で `cargo build -p server` のあと):
//   node server/scripts/e2e-queue.mjs [サーバの exe のパス]
//
// 止めるのは、このスクリプトが起動した PID とその子孫だけ。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import {
  alive, cleanupStarted, check, dirs, openSse, projects, refOf, results, root, rpc, sleep, slash, startedPids, startServer,
  token, waitHealthy, waitState,
} from "./e2e-lib.mjs";

const mb = (n) => Math.round((n / 1024 / 1024) * 10) / 10;
const privateBytes = (pid) =>
  Number(
    execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).PrivateMemorySize64`], { encoding: "utf8" }).trim(),
  );

/** 読まない SSE 接続を張る(最初のイベントだけ読んで、接続の ID を得たあと、読み止める)。 */
function openStalledSse(srv) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(srv.port, "127.0.0.1", () => {
      socket.write(`GET /events HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nAuthorization: Bearer ${token(srv)}\r\nAccept: text/event-stream\r\n\r\n`);
    });
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const m = buf.match(/"connection_id":"([0-9a-f-]{36})"/);
      if (m) {
        socket.pause(); // ここから読まない(カーネルの受信バッファがいっぱいになり、サーバの送信が詰まる)
        resolve({ socket, connectionId: m[1] });
      }
    });
    socket.on("error", () => {});
    setTimeout(() => reject(new Error("接続の ID が届かない")), 8000);
  });
}

async function main() {
  const srv = startServer();
  await waitHealthy(srv);
  const settings = await rpc(srv, "get_settings");
  await rpc(srv, "update_settings", {
    input: { repository_path: slash(dirs.repo), github_project: null, selected_project_folders: [], claude_projects_dir: slash(projects) },
    profileId: settings.json.active_profile_id,
    expectedRevision: settings.json.revision,
    expectedGlobalRevision: settings.json.global_revision,
  });
  const r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: "queue", sync_origin_main: false } });
  const target = refOf(r.json);
  await waitState(srv, target, "idle");

  const reader = await openSse(srv); // 読む接続
  await rpc(srv, "subscribe_running_session_progress", { target, connectionId: reader.connectionId });
  const stalled = await openStalledSse(srv); // 読まない接続
  await rpc(srv, "subscribe_running_session_progress", { target, connectionId: stalled.connectionId });

  const base = privateBytes(srv.child.pid);
  console.log(`  基準のメモリ: ${mb(base)}MB`);
  const text = "x".repeat(2 * 1024 * 1024);
  const samples = [];
  let peak = base;
  for (let i = 1; i <= 24; i++) {
    const sent = await rpc(srv, "send_to_running_session", { target, text, images: [] });
    if (sent.status !== 200) throw new Error(`送信に失敗: ${sent.status} ${sent.text}`);
    await waitState(srv, target, "idle", 20000);
    await sleep(150);
    const now = privateBytes(srv.child.pid);
    peak = Math.max(peak, now);
    samples.push(mb(now - base));
  }
  console.log(`  送信ごとの増え(MB。基準との差): ${samples.join(", ")}`);
  console.log(`  最大の増え: ${mb(peak - base)}MB`);

  // 上限(16MB)に、受け取りの途中の分・直列化の一時的な分を足しても、送信回数に比例しては増えない。
  check("読まない接続があっても、メモリは上限の近くで止まる(24 回 × 約 4MB = 約 96MB を送っても、増えは 48MB 未満)", peak - base < 48 * 1024 * 1024, `最大 +${mb(peak - base)}MB`);
  const received = reader.events.filter((e) => e.name === "running-session:progress" && e.data.progress?.event?.kind === "turn_finished").length;
  check("読む接続には、24 回ぶんのターン終了がすべて届く(影響を受けない)", received === 24, `${received}/24`);

  // 外れたあと(メモリが戻る)。
  await sleep(1500);
  const after = privateBytes(srv.child.pid);
  console.log(`  外れたあとのメモリ: +${mb(after - base)}MB(基準との差)`);
  check("外れたあと、メモリは最大の増えより下がる", after < peak, `最大 +${mb(peak - base)}MB → +${mb(after - base)}MB`);
  check("読まない接続は外れている(購読が 404 になる)", (await rpc(srv, "subscribe_running_session_progress", { target, connectionId: stalled.connectionId })).status === 404);
  stalled.socket.destroy();
  reader.close();
}

try {
  await main();
} catch (e) {
  console.error("スクリプトの失敗:", e);
  process.exitCode = 1;
} finally {
  // 後片付け: PID と開始時刻の組が控えと一致する、自分が起動したものだけを止める(`proc-safety.mjs`)。
  cleanupStarted();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 件が通りました`);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
}
