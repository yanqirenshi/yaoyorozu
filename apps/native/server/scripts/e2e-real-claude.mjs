// 本物の claude を **1 セッションだけ** 起動して確かめる(偽の claude では分からない、実物との噛み合わせ)。
//
//   起動(新規) → 1 往復 → 停止 → 再開 → サーバを Ctrl+C → 子孫が残らない → サーバの再起動 → 自動再開
//
// 使い捨てのデータフォルダ・リポジトリ(一時フォルダ)だけを使う。ほかの会話・ほかのセッションの claude には
// 触れない: 新しく作る会話は 1 つだけで、サーバが読む控え(`running-sessions.json`)は使い捨てのデータフォルダのもの。
// 本物の claude は `~/.claude` の認証が要るため、ホームは差し替えない(`--real`)。
// 実行すると、`~/.claude/projects/` に使い捨てのリポジトリ用のフォルダが 1 つできる。終わりに、そのフォルダ
// (このスクリプトが作った会話 1 つだけが入っている)を消す。
//
// 使い方(`apps/native` で `cargo build -p server` のあと):
//   node server/scripts/e2e-real-claude.mjs --real
//
// 止めるのは、このスクリプトが起動した PID とその子孫だけ。


import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  alive, cleanupStarted, check, descendants, dirs, openSse, real, refOf, results, root, rpc, sendCtrlC, sleep, slash, startServer,
  startedPids, waitHealthy, waitState,
} from "./e2e-lib.mjs";

const realProjects = path.join(os.homedir(), ".claude", "projects");

/** 作った会話(`<id>.jsonl`)の置き場所を、プロジェクトのフォルダ名だけを見て探す(中身は読まない)。 */
function findConversation(sessionId) {
  for (const name of fs.readdirSync(realProjects)) {
    const file = path.join(realProjects, name, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return { project: name, file };
  }
  return null;
}

async function main() {
  if (!real) throw new Error("本物の claude を起動します。確かめたうえで、--real を付けて実行してください");
  console.log(`使い捨ての場所: ${root}`);
  const srv = startServer();
  await waitHealthy(srv);
  const settings = await rpc(srv, "get_settings");
  const upd = await rpc(srv, "update_settings", {
    input: { repository_path: slash(dirs.repo), github_project: null, selected_project_folders: [], claude_projects_dir: null },
    profileId: settings.json.active_profile_id,
    expectedRevision: settings.json.revision,
    expectedGlobalRevision: settings.json.global_revision,
  });
  check("設定(使い捨てのリポジトリ)の保存", upd.status === 200, upd.text);

  const tab = await openSse(srv);
  let r = await rpc(srv, "start_running_session", { request: { kind: "new", mode: "default", name: "yyz-e2e-real", sync_origin_main: false } });
  check("本物の claude の新規セッションを起動", r.status === 200, `${r.status} ${r.text.slice(0, 300)}`);
  if (r.status !== 200) return;
  const session = r.json;
  const target = refOf(session);
  const sub = (await rpc(srv, "subscribe_running_session_progress", { target, connectionId: tab.connectionId })).json;
  const idle = await waitState(srv, target, "idle", 60000);
  check("起動 → 待機(idle)", !!idle, idle ? `モデル ${idle.current_model ?? "未報告"}・版 ${idle.cli_version ?? "?"}` : "");
  const tree = descendants(srv.child.pid);
  check("claude がサーバの子孫にいる", tree.length > 0, `子孫 PID: ${tree.join(",")}`);

  r = await rpc(srv, "send_to_running_session", { target, text: "Reply with exactly the single word OK and nothing else. Do not use any tools.", images: [] });
  check("送信", r.status === 200, r.text);
  const finished = await tab.waitFor((e) => e.name === "running-session:progress" && e.data.progress?.event?.kind === "turn_finished", 90000);
  const text = tab.events
    .filter((e) => e.name === "running-session:progress" && e.data.progress?.event?.kind === "text_delta")
    .map((e) => e.data.progress.event.text)
    .join("");
  check("1 往復(送信 → 途中経過 → ターン終了)が、サーバを通って届く", !!finished, `ターン終了: 成功=${finished?.data.progress.event.succeeded} 応答: ${JSON.stringify(text.slice(0, 40))}`);
  // モデルの応答そのものが成功したか(claude の認証が有効なときだけ成功する。切れていると、認証エラーの
  // 応答が返って失敗になる。サーバの不具合ではない)。
  check("モデルの応答が成功した(claude の認証が有効なとき)", finished?.data.progress.event.succeeded === true);
  const settled = await waitState(srv, target, "idle", 30000);
  check("往復のあと待機へ戻る", !!settled);

  const conv = findConversation(session.session_id);
  check("会話ファイルができた(使い捨てのリポジトリ用のフォルダ)", !!conv && conv.project.toLowerCase().includes("yyz-e2e"), conv ? conv.project : "見つからない");
  if (!conv) return;

  // 停止 → 控えから外れる。
  r = await rpc(srv, "stop_running_session", { target });
  check("停止", r.status === 200 && !!(await waitState(srv, target, "exited", 30000)), r.text);
  await sleep(500);
  check("停止のあと、claude(子孫)が 0 件", tree.filter(alive).length === 0, `残り: ${tree.filter(alive).join(",") || 0}`);

  // 一覧からの再開(Resume)。これが次の起動で自動再開される。
  r = await rpc(srv, "start_running_session", { request: { kind: "resume", project: conv.project, session_id: session.session_id, mode: "default", name: "yyz-e2e-real", sync_origin_main: false } });
  check("同じ会話の再開(resume)", r.status === 200, `${r.status} ${r.text.slice(0, 300)}`);
  if (r.status !== 200) return;
  const resumed = r.json;
  check("再開 → 待機", !!(await waitState(srv, refOf(resumed), "idle", 60000)));
  const before = descendants(srv.child.pid);
  console.log(`  Ctrl+C の前の子孫: ${before.join(",") || "(なし)"}`);

  // サーバを Ctrl+C で止める → claude は残らない。
  tab.close();
  const sent = sendCtrlC(srv.child.pid);
  const t0 = Date.now();
  while (alive(srv.child.pid) && Date.now() - t0 < 20000) await sleep(100);
  check("Ctrl+C でサーバが終了する", !alive(srv.child.pid), `${Math.round((Date.now() - t0) / 100) / 10} 秒 ${sent}`);
  await sleep(1000);
  check("Ctrl+C のあと、claude(子孫)が 0 件", before.filter(alive).length === 0, `残り: ${before.filter(alive).join(",") || 0}`);
  const saved = JSON.parse(fs.readFileSync(path.join(dirs.data, "running-sessions.json"), "utf8"));
  check("終了しても、再開の控えは残る", (saved.sessions ?? []).some((s) => s.session_id === session.session_id));

  // 再起動 → 自動再開。
  const srv2 = startServer();
  await waitHealthy(srv2);
  let restored = null;
  for (let i = 0; i < 400 && !restored; i++) {
    const l = await rpc(srv2, "list_running_sessions");
    restored = (l.json ?? []).find((s) => s.session_id === session.session_id && s.process_state === "idle");
    if (!restored) await sleep(150);
  }
  check("サーバの再起動で、前回のセッションが自動で再開される(本物の claude)", !!restored, restored ? "待機(idle)" : srv2.log.join("").slice(-300));

  // 終わり: 穏やかに止めて、子孫が残らないことを確かめる。
  const last = descendants(srv2.child.pid);
  sendCtrlC(srv2.child.pid);
  const t1 = Date.now();
  while (alive(srv2.child.pid) && Date.now() - t1 < 20000) await sleep(100);
  await sleep(1000);
  check("後始末: 最後の Ctrl+C のあと、子孫が 0 件", last.filter(alive).length === 0, `残り: ${last.filter(alive).join(",") || 0}`);

  // この実行が作った会話 1 つだけが入ったフォルダを消す(`yyz-e2e` を含む名前のものに限る)。
  if (conv.project.toLowerCase().includes("yyz-e2e")) {
    fs.rmSync(path.join(realProjects, conv.project), { recursive: true, force: true });
    console.log(`  使い捨ての会話フォルダを消しました: ${conv.project}`);
  }
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
