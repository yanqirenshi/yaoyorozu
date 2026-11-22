// ハブの command(段階 4 A)の確認。**使い捨て**のデータフォルダ・ホーム・リポジトリで、実際のサーバ(exe・偽の claude)と
// `next start`(中継)を起動して確かめる。
//
// 確かめること: 守り(トークン・Host・Origin)/ `expectedRevision` の省略は 400・古い版は 409 / `profileId` の省略は 400 /
// 2 つの接続(直接と中継)から同時に `save_hub_layout` して、通るのは 1 本で、ファイルが壊れない /
// `reconcile_git_state` がすぐ応え、二重に走らない / worktree を新しく作って起動したとき `pc:sessions_updated` が出る。
//
// 使い方(`apps/native` で `cargo build -p server`、`apps/console` で `next build` のあと):
//   node server/scripts/e2e-hub.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  cleanupStarted, check, dirs, nextBase, openWs, projectName, projects, refOf, results, root, rpc, sleep, slash, startNext, startServer, token,
  waitHealthy, waitState,
} from "./e2e-lib.mjs";

const line = (o) => JSON.stringify(o) + "\n";

function writeSessions(count) {
  const dir = path.join(projects, projectName);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const id = `3a392392-0000-4000-8000-${String(i).padStart(12, "0")}`;
    fs.writeFileSync(
      path.join(dir, `${id}.jsonl`),
      line({ type: "user", uuid: "u1", sessionId: id, cwd: dirs.repo, timestamp: "2026-11-01T00:00:01.000Z", message: { role: "user", content: `質問 ${i}` } }) +
        line({ type: "assistant", uuid: "a1", sessionId: id, cwd: dirs.repo, timestamp: "2026-11-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "返事" }] } }),
    );
  }
}

/** Host を自由に決めて、トークンつきの POST を送り、状態行を返す(fetch は Host を変えられない)。 */
function rawPost(srv, command, { host, bearer }) {
  return new Promise((resolve) => {
    const socket = net.connect(srv.port, "127.0.0.1", () => {
      const headers = [`POST /rpc/${command} HTTP/1.1`, `Host: ${host}`, "Content-Type: application/json", "Content-Length: 2", "Connection: close"];
      if (bearer !== null) headers.push(`Authorization: Bearer ${bearer}`);
      socket.write(headers.join("\r\n") + "\r\n\r\n{}");
    });
    let buf = "";
    socket.on("data", (d) => (buf += d.toString("latin1")));
    socket.on("close", () => resolve(buf.split("\r\n")[0] || "(応答なし)"));
    socket.on("error", () => resolve("(接続エラー)"));
  });
}

async function main() {
  writeSessions(30);
  const srv = startServer();
  await waitHealthy(srv);
  await startNext();
  const settings = await rpc(srv, "get_settings");
  const profileId = settings.json.active_profile_id;
  await rpc(srv, "update_settings", {
    input: { repository_path: slash(dirs.repo), github_project: null, selected_project_folders: [projectName], claude_projects_dir: slash(projects) },
    profileId,
    expectedRevision: settings.json.revision,
    expectedGlobalRevision: settings.json.global_revision,
  });
  const direct = (command, body = {}, headers = {}) =>
    fetch(`${srv.base}/rpc/${command}`, { method: "POST", headers: { authorization: `Bearer ${token(srv)}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const relay = (command, body = {}, headers = { origin: nextBase }) =>
    fetch(`${nextBase}/api/rpc/${command}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  // ---- 守り(トークン・Host・Origin) ----
  for (const command of ["get_pc", "get_hub_layout", "save_hub_layout", "get_hub_tuning", "save_hub_tuning", "reconcile_git_state"]) {
    const noToken = await fetch(`${srv.base}/rpc/${command}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const badToken = await fetch(`${srv.base}/rpc/${command}`, { method: "POST", headers: { authorization: "Bearer wrong", "content-type": "application/json" }, body: "{}" });
    const badHost = await rawPost(srv, command, { host: "evil.example", bearer: token(srv) });
    const evil = await relay(command, {}, { origin: "http://evil.example" });
    const noOrigin = await relay(command, {}, {});
    check(
      `守り: ${command}`,
      noToken.status === 401 && badToken.status === 401 && badHost.includes(" 403 ") && evil.status === 403 && noOrigin.status === 403,
      `トークン無し ${noToken.status}・違うトークン ${badToken.status}・Host 違い ${badHost}・中継の Origin 違い ${evil.status}・Origin 無し ${noOrigin.status}`,
    );
  }

  // ---- profileId の必須化 ----
  const required = [
    ["start_running_session", { request: { kind: "new", mode: "default", name: null, sync_origin_main: false } }],
    ["get_project_claude_md", {}],
    ["save_project_claude_md", { content: "x", expectedModifiedAtMs: null }],
    ["list_rules", {}],
    ["get_rule", { fileName: "a.md" }],
    ["list_skills", {}],
    ["get_skill", { name: "s" }],
    ["get_project_settings_file", { which: "settings" }],
    ["save_project_settings_file", { which: "settings", content: "{}", expectedModifiedAtMs: null }],
    ["get_yyz_scaffold_status", {}],
    ["create_yyz_scaffold", {}],
  ];
  let allRequired = true;
  const detail = [];
  for (const [command, body] of required) {
    const omitted = await direct(command, body);
    const isNull = await direct(command, { ...body, profileId: null });
    const ok = omitted.status === 400 && isNull.status === 400;
    allRequired &&= ok;
    detail.push(`${command}:${omitted.status}/${isNull.status}`);
  }
  check("profileId の省略・null は 400(11 の command)", allRequired, detail.join(" "));
  const withId = await direct("get_yyz_scaffold_status", { profileId });
  check("profileId を付ければ通る(対照)", withId.status === 200 || withId.status === 400 || withId.status === 404, `${withId.status}`);
  const gs = await rpc(srv, "get_settings", {});
  check("get_settings だけは、省略を残す", gs.status === 200 && typeof gs.json.active_profile_id === "string", `${gs.status}`);

  // ---- 版(レイアウト・チューニング) ----
  const layout0 = await (await direct("get_hub_layout")).json();
  const body = (revision, x) => ({ positions: { "node-a": { x, y: 1 } }, camera: { x: 0, y: 0, k: 1 }, moves: {}, ...(revision === undefined ? {} : { expectedRevision: revision }) });
  const omitted = await direct("save_hub_layout", body(undefined, 1));
  check("expectedRevision の省略は 400", omitted.status === 400, `${omitted.status}`);
  const first = await direct("save_hub_layout", body(layout0.revision, 1));
  const firstBody = await first.json();
  check("合う版なら保存でき、新しい版が返る", first.status === 200 && firstBody.revision !== layout0.revision, `${first.status} ${JSON.stringify(firstBody)}`);
  const stale = await direct("save_hub_layout", body(layout0.revision, 9));
  const staleBody = await stale.json();
  check("古い版は 409(hub_conflict)", stale.status === 409 && staleBody.code === "hub_conflict", `${stale.status} ${staleBody.code}`);
  const tuning0 = await (await direct("get_hub_tuning")).json();
  const tuningBody = (revision) => ({ tuning: { link_distance: 111, link_strength: null, charge_strength: -250, collide_radius: 18 }, ...(revision === undefined ? {} : { expectedRevision: revision }) });
  check("チューニング: 版の省略は 400", (await direct("save_hub_tuning", tuningBody(undefined))).status === 400);
  const tuningSaved = await direct("save_hub_tuning", tuningBody(tuning0.revision));
  check("チューニング: 保存でき、古い版は 409", tuningSaved.status === 200 && (await direct("save_hub_tuning", tuningBody(tuning0.revision))).status === 409);

  // ---- 2 つの接続(直接と中継)から同時に保存 ----
  const current = await (await direct("get_hub_layout")).json();
  const attempts = [];
  for (let i = 0; i < 10; i++) {
    attempts.push((i % 2 === 0 ? direct : relay)("save_hub_layout", { positions: { [`n${i}`]: { x: i, y: 0 } }, camera: null, moves: {}, expectedRevision: current.revision }));
  }
  const statuses = (await Promise.all(attempts)).map((r) => r.status);
  const winners = statuses.filter((s) => s === 200).length;
  const conflicts = statuses.filter((s) => s === 409).length;
  const layoutFile = path.join(dirs.data, "hub-layout.json");
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(layoutFile, "utf8"));
  } catch {}
  const leftovers = fs.readdirSync(dirs.data).filter((f) => f.includes(".tmp"));
  check("同時の保存(直接 5・中継 5): 通るのは 1 本・残りは 409・ファイルは壊れない", winners === 1 && conflicts === 9 && !!parsed && Object.keys(parsed.positions).length === 1 && leftovers.length === 0, `200 が ${winners}・409 が ${conflicts}・一時ファイル ${leftovers.length}`);

  // ---- reconcile: すぐ応え、二重に走らない ----
  const tab = await openWs(srv);
  const before = tab.events.length;
  // 起動時の読み込みが終わっているのを待つ。
  for (let i = 0; i < 100; i++) {
    const pc = await (await direct("get_pc")).json();
    if (pc.data_loaded) break;
    await sleep(100);
  }
  const t0 = performance.now();
  const [r1, r2] = await Promise.all([direct("reconcile_git_state"), direct("reconcile_git_state")]);
  const answeredIn = Math.round(performance.now() - t0);
  await sleep(300);
  const loadedAt = Date.now();
  for (let i = 0; i < 200; i++) {
    if (tab.events.slice(before).some((e) => e.name === "pc:data_loaded")) break;
    await sleep(100);
  }
  await sleep(500);
  const seen = tab.events.slice(before).map((e) => e.name);
  const loadingCount = seen.filter((n) => n === "pc:data_loading").length;
  const loadedCount = seen.filter((n) => n === "pc:data_loaded").length;
  check("reconcile_git_state: 2 回同時に呼んでも、すぐ応え、走るのは 1 回", r1.status === 200 && r2.status === 200 && answeredIn < 2000 && loadingCount === 1 && loadedCount === 1, `応答 ${answeredIn}ms・pc:data_loading ${loadingCount} 回・pc:data_loaded ${loadedCount} 回`);
  void loadedAt;
  const pc = await (await direct("get_pc")).json();
  check("get_pc: 走査した会話が入っている", pc.data_loaded === true && pc.users[0].sessions.length === 30, `data_loaded=${pc.data_loaded}・会話 ${pc.users[0].sessions.length} 件`);

  // ---- worktree を新しく作って起動したとき ----
  // 新しい worktree は origin/main から作る: 使い捨てのリポジトリに、origin/main の参照を足す(リモートは無い)。
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: dirs.repo, stdio: "pipe" });
  const mark = tab.events.length;
  const started = await rpc(srv, "start_running_session", { profileId, request: { kind: "new", mode: "default", name: "wt", worktree: { kind: "branch", branch_name: "hub-e2e-branch" }, sync_origin_main: false } });
  if (started.status === 200) {
    await sleep(1500);
    const got = tab.events.slice(mark).some((e) => e.name === "pc:sessions_updated");
    check("worktree を新しく作って起動すると、pc:sessions_updated が出る", got, `起動 ${started.status}`);
    await rpc(srv, "stop_running_session", { target: refOf(started.json) });
    await waitState(srv, refOf(started.json), "exited", 15000);
  } else {
    check("worktree を新しく作って起動できる", false, `${started.status} ${started.text}`);
  }
  tab.close();
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
  if (failed) process.exitCode = 1;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
}
