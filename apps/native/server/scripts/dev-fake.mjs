// 画面(`apps/console`)を、偽の claude で目で確かめるための、使い捨ての環境を起動する。
//
//   使い捨てのデータフォルダ・ホーム・リポジトリ・会話 1 つ → サーバ(偽の claude)→ `next start`(本番の起動)
//
// 先に `cargo build -p server`(`apps/native`)と、`next build`(`apps/console`)をしておく。
// 起動したら、画面の URL を含む JSON を `dev-fake-state.json`(使い捨てのフォルダの中)へ書く(標準出力にも出す)。
// サーバだけを再起動するときは `restart` ファイル、止めるときは `stop` ファイルを、同じフォルダに作る
// (このスクリプトが、自分が起動した PID とその子孫だけを止める)。
// 偽の claude は、会話ファイルへ送信した行と返答を追記する(実物の claude と同じ。`FAKE_CLAUDE_SESSION_FILE`)。
//
// 使い方(`apps/native` で):
//   node server/scripts/dev-fake.mjs [サーバの exe のパス]
//
// 本物の `%APPDATA%\com.yaoyorozu.native`・`~/.claude` には触れない(USERPROFILE/HOME も使い捨ての場所へ差し替える)。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  alive, dirs, nextBase, projectName, projects, root, rpc, sendCtrlC, sleep, slash, startedPids, startNext, startServer,
  token, waitHealthy,
} from "./e2e-lib.mjs";

const convId = "3a392392-0000-4000-8000-000000000001";
const line = (obj) => JSON.stringify(obj) + "\n";
const at = (n) => new Date(Date.UTC(2026, 10, 22, 0, 0, n)).toISOString();

async function main() {
  const convFile = path.join(projects, projectName, `${convId}.jsonl`);
  process.env.FAKE_CLAUDE_SESSION_FILE = convFile;
  let srv = startServer();
  await waitHealthy(srv);
  const settings = await rpc(srv, "get_settings");
  const upd = await rpc(srv, "update_settings", {
    input: {
      repository_path: slash(dirs.repo),
      github_project: null,
      selected_project_folders: [projectName],
      claude_projects_dir: slash(projects),
    },
    profileId: settings.json.active_profile_id,
    expectedRevision: settings.json.revision,
  });
  if (upd.status !== 200) throw new Error(`設定の保存に失敗: ${upd.text}`);

  // 会話 1 つ(記録された cwd = 使い捨てのリポジトリ)。
  fs.writeFileSync(
    path.join(projects, projectName, `${convId}.jsonl`),
    line({ type: "user", uuid: "u-1", sessionId: convId, cwd: dirs.repo, timestamp: at(1), message: { role: "user", content: "最初の質問です" } }) +
      line({ type: "assistant", uuid: "a-1", sessionId: convId, cwd: dirs.repo, timestamp: at(2), message: { role: "assistant", content: [{ type: "text", text: "最初の返事です" }] } }),
  );

  await startNext();
  const state = { console: nextBase, serverPort: srv.port, serverPid: srv.child.pid, root, project: projectName, conversation: convId, profileId: settings.json.active_profile_id, token: token(srv) };
  // トークンは状態ファイルへ書かない(画面は中継経由で使うので不要)。
  delete state.token;
  fs.writeFileSync(path.join(root, "dev-fake-state.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));

  const stopFile = path.join(root, "stop");
  const restartFile = path.join(root, "restart");
  while (!fs.existsSync(stopFile)) {
    if (fs.existsSync(restartFile)) {
      fs.rmSync(restartFile);
      sendCtrlC(srv.child.pid);
      for (let i = 0; i < 100 && alive(srv.child.pid); i++) await sleep(100);
      srv = startServer({ port: srv.port });
      await waitHealthy(srv);
      console.log("サーバを再起動しました");
    }
    await sleep(500);
  }
  sendCtrlC(srv.child.pid);
  for (let i = 0; i < 100 && alive(srv.child.pid); i++) await sleep(100);
}

try {
  await main();
} catch (e) {
  console.error("スクリプトの失敗:", e);
  process.exitCode = 1;
} finally {
  for (const pid of startedPids) {
    if (alive(pid)) {
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "pipe" });
      } catch {}
    }
  }
  console.log(`使い捨てのフォルダ: ${root}(確認が終わったら削除してよい)`);
}
