// 台帳(`git-ledger.json`)が壊れて作り直されても、worktree で動いていた会話が自動で再開されることの確認。
// **使い捨て**のデータフォルダ・ホーム・リポジトリで、偽の claude を使う。
//
//   worktree で会話を再開(worktree を作って起動) → サーバを止める → 台帳を壊す → サーバを起動し直す
//   → worktree の ID が振り直されていても、覚えていたフォルダで引き直されて、同じ worktree で自動再開される
//   → 壊れた台帳を退避したことが、保留中の警告に出る(フルパスなし)
//   → 台帳に無いフォルダの控えは、警告を 1 回出して、控えから外れる(次の起動でくり返さない)
//
// 使い方(`apps/native` で `cargo build -p server` のあと):
//   node server/scripts/e2e-ledger.mjs [サーバの exe のパス]
//
// 止めるのは、このスクリプトが起動した PID とその子孫だけ。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  alive, cleanupStarted, check, dirs, projectName, projects, results, root, rpc, sendCtrlC, sleep, slash, startedPids, startServer,
  waitHealthy,
} from "./e2e-lib.mjs";

const convId = "3a392392-0000-4000-8000-0000000000e1";
const orphanConvId = "3a392392-0000-4000-8000-0000000000e2";

async function stopServer(srv) {
  sendCtrlC(srv.child.pid);
  for (let i = 0; i < 100 && alive(srv.child.pid); i++) await sleep(100);
}

async function findRunning(srv, sessionId, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const list = await rpc(srv, "list_running_sessions");
    const hit = (list.json ?? []).find((s) => s.session_id === sessionId && s.process_state === "idle");
    if (hit) return hit;
    await sleep(200);
  }
  return null;
}

async function main() {
  // origin の無い使い捨てのリポジトリなので、worktree 用のブランチを先に作っておく(あれば、それで worktree を作る)。
  execFileSync("git", ["branch", "ledger-test"], { cwd: dirs.repo, stdio: "pipe" });
  fs.writeFileSync(
    path.join(projects, projectName, `${convId}.jsonl`),
    JSON.stringify({ type: "user", sessionId: convId, cwd: dirs.repo, message: { role: "user", content: "hi" } }) + "\n",
  );
  const srv = startServer();
  await waitHealthy(srv);
  const settings = await rpc(srv, "get_settings");
  await rpc(srv, "update_settings", {
    input: { repository_path: slash(dirs.repo), github_project: null, selected_project_folders: [projectName], claude_projects_dir: slash(projects) },
    profileId: settings.json.active_profile_id,
    expectedRevision: settings.json.revision,
    expectedGlobalRevision: settings.json.global_revision,
  });
  const started = await rpc(srv, "start_running_session", {
    request: { kind: "resume", project: projectName, session_id: convId, mode: "default", name: "ledger", worktree: { kind: "branch", branch_name: "ledger-test" }, sync_origin_main: false },
  });
  check("worktree を作って再開できる", started.status === 200 && started.json.worktree_id && !["main-worktree", "outside-repository"].includes(started.json.worktree_id), `${started.status} ${started.text.slice(0, 160)}`);
  const oldId = started.json.worktree_id;
  const worktreeCwd = started.json.cwd;
  const saved = JSON.parse(fs.readFileSync(path.join(dirs.data, "running-sessions.json"), "utf8"));
  const entry = saved.sessions.find((s) => s.session_id === convId);
  check("控えに worktree の ID とフォルダが残る", entry?.worktree_id === oldId && !!entry?.worktree_path, JSON.stringify(entry ?? null).slice(0, 200));

  // 古い形の控え(フォルダが無い)と、台帳に無いフォルダの控え(引き直せない)も入れておく。
  fs.writeFileSync(
    path.join(projects, projectName, `${orphanConvId}.jsonl`),
    JSON.stringify({ type: "user", sessionId: orphanConvId, cwd: dirs.repo, message: { role: "user", content: "hi" } }) + "\n",
  );
  await stopServer(srv);
  saved.sessions.push({ ...entry, session_id: orphanConvId, name: "orphan", worktree_id: "no-such-id", worktree_path: slash(path.join(dirs.repo, ".claude", "worktrees", "no-such-worktree")) });
  fs.writeFileSync(path.join(dirs.data, "running-sessions.json"), JSON.stringify(saved, null, 2));

  // 台帳を壊す(退避されて、空から作り直される。worktree の ID は振り直される)。
  fs.writeFileSync(path.join(dirs.data, "git-ledger.json"), "{ これは JSON ではない");
  const srv2 = startServer();
  await waitHealthy(srv2);
  const resumed = await findRunning(srv2, convId);
  check("台帳が壊れて ID が振り直されても、worktree の会話が自動で再開される", !!resumed, srv2.log.join("").slice(-300));
  if (resumed) {
    check("再開したのは、同じ worktree(作業フォルダが同じ)", slash(resumed.cwd ?? "").toLowerCase() === slash(worktreeCwd).toLowerCase(), `${resumed.cwd}`);
    const dto = (await rpc(srv2, "get_running_session", { target: { pid_domain: resumed.target.pid_domain, pid: resumed.target.pid, started_at: resumed.target.started_at } })).json;
    check("worktree の ID は、振り直された新しい ID になっている", dto.worktree_id !== oldId && dto.worktree_id !== "outside-repository", `${oldId} → ${dto.worktree_id}`);
  }
  const warnings = ((await rpc(srv2, "list_pending_warnings")).json ?? []).map((w) => w.message);
  check("壊れた台帳を退避したことが、警告に出る(フルパスなし)", warnings.some((m) => m.includes("git-ledger.json") && m.includes(".corrupt.") && !m.includes(root)), JSON.stringify(warnings).slice(0, 300));
  await sleep(1500);
  const after = JSON.parse(fs.readFileSync(path.join(dirs.data, "running-sessions.json"), "utf8"));
  check("引き直せなかった控えは、外れる(同じ警告をくり返さない)", !after.sessions.some((s) => s.session_id === orphanConvId), after.sessions.map((s) => s.session_id).join(","));
  check("引き直せたものは、控えに残る(新しい ID で)", after.sessions.some((s) => s.session_id === convId));
  await stopServer(srv2);
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
