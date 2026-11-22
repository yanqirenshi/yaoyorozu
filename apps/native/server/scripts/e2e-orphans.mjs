// 会話ごとのジョブ(`jobbed_process.rs`)の確認。**使い捨て**のデータフォルダ・ホーム・リポジトリで、偽の claude に
// 「切り離した子」と「親が先に終わった孫」を作らせ(`ORPHAN`)、1 つの会話を止めたあと、それらが残らないことを確かめる。
// もう 1 つの会話(止めない)の子孫は、止めた会話の停止で巻き込まれない。
//
// 使い方(`apps/native` で `cargo build -p server` のあと):
//   node server/scripts/e2e-orphans.mjs [サーバの exe のパス]
//
// 止めるのは、このスクリプトが起動した PID とその子孫だけ(作らせた孫など、残ったものも PID を指定して止める)。

import fs from "node:fs";
import path from "node:path";
import {
  alive, aliveMany, cleanupStarted, recordIdentity, check, dirs, openSse, projects, refOf, results, root, rpc, sendCtrlC, sleep, slash, startedPids, startServer,
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
  // 見つけた直後に、PID と開始時刻の組を控える(あとの生死の判定・後片付けが、PID の再利用に惑わされない)。
  pids.forEach((p) => recordIdentity(p));
  spawned.push(...pids);
  return pids;
}

async function main() {
  // 異常終了する会話(EXIT)の偽の claude は、このファイルができるまで終わらない(サーバの環境を通って渡る)。
  const exitSignal = path.join(root, "exit-signal");
  process.env.FAKE_CLAUDE_EXIT_SIGNAL_FILE = exitSignal;
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
  check("作らせた子と孫が、どちらの会話でも生きている", aliveMany([aChild, aGrand, bChild, bGrand]).every(Boolean), `a: ${aChild},${aGrand} b: ${bChild},${bGrand}`);

  // 会話 a だけを止める。
  const stopped = await rpc(srv, "stop_running_session", { target: a });
  check("会話 a を止める", stopped.status === 200 && !!(await waitState(srv, a, "exited", 15000)), stopped.text);
  await sleep(800);
  const [aChildAlive, aGrandAlive, bChildAlive, bGrandAlive] = aliveMany([aChild, aGrand, bChild, bGrand]);
  check("止めた会話の、切り離した子が残らない", !aChildAlive, `PID ${aChild}`);
  check("止めた会話の、親のいない孫が残らない", !aGrandAlive, `PID ${aGrand}`);
  check("止めていない会話の子孫は、巻き込まれない", bChildAlive && bGrandAlive, `b: ${bChild},${bGrand}`);

  // 会話 b も止めると、b の分も 0 件。
  await rpc(srv, "stop_running_session", { target: b });
  await waitState(srv, b, "exited", 15000);
  await sleep(800);
  check("会話 b を止めると、b の子孫も 0 件", aliveMany([bChild, bGrand]).every((x) => !x), `b: ${bChild},${bGrand}`);
  tab.close();

  // ---- claude が自分で(異常終了で)終わったときも、子孫が残らない ----
  const tab2 = await openSse(srv);
  const c = await start("orphans-c");
  const [cChild, cGrand] = await makeOrphans(srv, tab2, c, "EXIT");
  // 偽の claude は、合図のファイルができるまで終わらない: 子と孫が生きているのを確かめ終えてから、合図を出す。
  check("(異常終了する会話)子と孫が、生きている", aliveMany([cChild, cGrand]).every(Boolean), `${cChild},${cGrand}`);
  fs.writeFileSync(exitSignal, "go");
  check("claude が自分で終わった(終了状態になる)", !!(await waitState(srv, c, "exited", 15000)));
  await sleep(1000);
  tab2.close();
  check("claude が自分で終わったあと、切り離した子と孫も残らない", aliveMany([cChild, cGrand]).every((x) => !x), `${cChild},${cGrand}`);

  // ---- 起動の直後に子を作る偽の claude(会話用のジョブへ入れられる前に作られた子)----
  // 起動したあとで PID をジョブへ入れるので、入れる前に作られた子は、会話のジョブの外(サーバのジョブの中)に残る。
  // その結果(事実)を出す: 停止のあと、その子が残るか。サーバが終わると、サーバのジョブが止める。
  sendCtrlC(srv.child.pid);
  for (let i = 0; i < 100 && alive(srv.child.pid); i++) await sleep(100);
  const earlyFile = path.join(root, "early-child.pid");
  process.env.FAKE_CLAUDE_EARLY_CHILD_FILE = earlyFile;
  const srv2 = startServer();
  await waitHealthy(srv2);
  const r2 = await rpc(srv2, "start_running_session", { request: { kind: "new", mode: "default", name: "early", sync_origin_main: false } });
  const t2 = refOf(r2.json);
  await waitState(srv2, t2, "idle");
  const early = Number(fs.readFileSync(earlyFile, "utf8"));
  recordIdentity(early);
  spawned.push(early);
  check("起動の直後に作られた子が、生きている", alive(early), `PID ${early}`);
  await rpc(srv2, "stop_running_session", { target: t2 });
  await waitState(srv2, t2, "exited", 15000);
  await sleep(800);
  console.log(`  事実: 起動の直後に作られた子は、会話を止めたあと ${alive(early) ? "残った(会話のジョブの外。サーバのジョブの中)" : "残らなかった(PID をジョブへ入れるのが先に間に合った)"}`);
  sendCtrlC(srv2.child.pid);
  for (let i = 0; i < 100 && alive(srv2.child.pid); i++) await sleep(100);
  await sleep(800);
  check("サーバが終わると、サーバのジョブが、残った子も止める", !alive(early), `PID ${early}`);
}

try {
  await main();
} catch (e) {
  console.error("スクリプトの失敗:", e);
  process.exitCode = 1;
} finally {
  // 残ったものも、作らせた PID を指して止める(名前一致の一括終了はしない)。
  // 後片付け: PID と開始時刻の組が控えと一致する、自分が起動したものだけを止める(`proc-safety.mjs`)。
  cleanupStarted(spawned);
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 件が通りました`);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
}
