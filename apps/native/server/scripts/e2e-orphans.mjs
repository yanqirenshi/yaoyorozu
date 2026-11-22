// 会話ごとのジョブ(`jobbed_process.rs`)の確認。**使い捨て**のデータフォルダ・ホーム・リポジトリで、偽の claude に
// 「切り離した子」と「親が先に終わった孫」を作らせ(`ORPHAN`)、1 つの会話を止めたあと、それらが残らないことを確かめる。
// もう 1 つの会話(止めない)の子孫は、止めた会話の停止で巻き込まれない。
//
// 使い方(`apps/native` で `cargo build -p server` のあと):
//   node server/scripts/e2e-orphans.mjs [サーバの exe のパス]
//
// 止めるのは、このスクリプトが起動した PID とその子孫だけ(作らせた孫など、残ったものも PID を指定して止める)。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  alive, check, dirs, openSse, projects, refOf, results, root, rpc, sleep, slash, startedPids, startServer,
  waitHealthy, waitState,
} from "./e2e-lib.mjs";

const spawned = [];

/** 偽の claude に ORPHAN を送り、作られた 2 つの PID(切り離した子・孫)を返す。 */
async function makeOrphans(srv, tab, target, label) {
  const sub = (await rpc(srv, "subscribe_running_session_progress", { target, connectionId: tab.connectionId })).json;
  const before = tab.events.length;
  await rpc(srv, "send_to_running_session", { target, text: `ORPHAN ${label}`, images: [] });
  const hit = await tab.waitFor(
    (e, i) => i >= before && e.name === "running-session:progress" && e.data.progress?.event?.kind === "text_delta" && /orphans: \d+,\d+/.test(e.data.progress.event.text),
    10000,
  );
  const m = hit?.data.progress.event.text.match(/orphans: (\d+),(\d+)/);
  void sub;
  if (!m) throw new Error("孫の PID が届きません");
  const pids = [Number(m[1]), Number(m[2])];
  spawned.push(...pids);
  return pids;
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
  const tab = await openSse(srv);
  const start = async (name) => {
    const r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name, sync_origin_main: false } });
    if (r.status !== 200) throw new Error(`起動に失敗: ${r.status} ${r.text}`);
    const target = refOf(r.json);
    await waitState(srv, target, "idle");
    return target;
  };
  const a = await start("orphans-a");
  const b = await start("orphans-b");
  const [aChild, aGrand] = await makeOrphans(srv, tab, a, "a");
  const [bChild, bGrand] = await makeOrphans(srv, tab, b, "b");
  check("作らせた子と孫が、どちらの会話でも生きている", [aChild, aGrand, bChild, bGrand].every(alive), `a: ${aChild},${aGrand} b: ${bChild},${bGrand}`);

  // 会話 a だけを止める。
  const stopped = await rpc(srv, "stop_running_session", { target: a });
  check("会話 a を止める", stopped.status === 200 && !!(await waitState(srv, a, "exited", 15000)), stopped.text);
  await sleep(800);
  check("止めた会話の、切り離した子が残らない", !alive(aChild), `PID ${aChild}`);
  check("止めた会話の、親のいない孫が残らない", !alive(aGrand), `PID ${aGrand}`);
  check("止めていない会話の子孫は、巻き込まれない", alive(bChild) && alive(bGrand), `b: ${bChild},${bGrand}`);

  // 会話 b も止めると、b の分も 0 件。
  await rpc(srv, "stop_running_session", { target: b });
  await waitState(srv, b, "exited", 15000);
  await sleep(800);
  check("会話 b を止めると、b の子孫も 0 件", !alive(bChild) && !alive(bGrand), `b: ${bChild},${bGrand}`);
  tab.close();
}

try {
  await main();
} catch (e) {
  console.error("スクリプトの失敗:", e);
  process.exitCode = 1;
} finally {
  // 残ったものも、作らせた PID を指して止める(名前一致の一括終了はしない)。
  for (const pid of [...spawned, ...startedPids]) {
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
