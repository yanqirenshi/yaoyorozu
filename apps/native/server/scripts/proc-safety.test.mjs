// `proc-safety.mjs` のテスト(`node --test server/scripts/proc-safety.test.mjs`)。
// **このテストが起動したプロセスだけ**を使う(止めるのも、自分で spawn したものだけ)。PID が別のプロセスへ再利用された形は、
// 控えの開始時刻を書き換えて作る(実際のほかのプロセスには触れない)。

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import {
  alive, hasIdentity, isMine, killIfMine, killTreeIfMine, recordIdentity, setIdentityForTest, verifiedDescendants,
} from "./proc-safety.mjs";

const FOREVER = "setInterval(() => {}, 1000)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const spawnForever = () => spawn(process.execPath, ["-e", FOREVER], { stdio: "ignore", windowsHide: true });

test("開始時刻が違う(PID が別のプロセスに再利用された形)なら、止めない。一致すれば止める", async () => {
  const child = spawnForever();
  try {
    assert.equal(recordIdentity(child.pid), true);
    assert.equal(isMine(child.pid), true);
    // PID が再利用された形: 控えの開始時刻が、いまのものと違う。
    setIdentityForTest(child.pid, "1");
    assert.equal(isMine(child.pid), false);
    assert.equal(alive(child.pid), false, "控えと違う開始時刻のものは、自分の生きているものとみなさない");
    const logs = [];
    assert.equal(killIfMine(child.pid, { log: (m) => logs.push(m) }), false);
    assert.equal(exists(child.pid), true, "止めていない");
    assert.equal(logs.length, 1, "止めなかったことをログに出す");
    // 開始時刻が一致すれば止める。
    assert.equal(recordIdentity(child.pid), true);
    assert.equal(killIfMine(child.pid), true);
    await sleep(500);
    assert.equal(exists(child.pid), false);
  } finally {
    child.kill();
  }
});

test("控えが無いプロセスは、止めない", () => {
  const child = spawnForever();
  try {
    assert.equal(hasIdentity(child.pid), false);
    assert.equal(killIfMine(child.pid, { log: () => {} }), false);
    assert.equal(killTreeIfMine(child.pid, { log: () => {} }).length, 0);
    assert.equal(exists(child.pid), true);
  } finally {
    child.kill();
  }
});

test("子孫は、親より前に始まったもの(親 PID が一致しただけ)を子とみなさない", () => {
  const ROOT = 4_000_001;
  setIdentityForTest(ROOT, "1000");
  const table = new Map([
    [ROOT, { ppid: 1, created: "1000", name: "root.exe" }],
    [4_000_002, { ppid: ROOT, created: "2000", name: "child.exe" }], // 本物の子
    [4_000_003, { ppid: 4_000_002, created: "3000", name: "grandchild.exe" }], // 本物の孫
    [4_000_004, { ppid: ROOT, created: "500", name: "impostor.exe" }], // 親より前に始まった(別のもの。ppid だけ一致)
    [4_000_005, { ppid: 4_000_004, created: "600", name: "impostor-child.exe" }], // その子(たどらない)
    [4_000_006, { ppid: ROOT, created: "2500", name: "conhost.exe" }], // コンソールのホストは数えない
  ]);
  const found = verifiedDescendants(ROOT, table).map((d) => d.pid);
  assert.deepEqual(found.sort(), [4_000_002, 4_000_003]);
  // 親の PID が再利用されている(控えの開始時刻と違う)ときは、何も返さない。
  setIdentityForTest(ROOT, "999");
  assert.deepEqual(verifiedDescendants(ROOT, table), []);
});

test("止めるのは、確かめた木だけ(同じ時期に起動した、木の外のプロセスは止めない)", async () => {
  // 親 → 子(長く生きる)。子の PID は、親の標準出力で受け取る。
  const parent = spawn(
    process.execPath,
    ["-e", `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','${FOREVER}'],{stdio:'ignore'});console.log(c.pid);${FOREVER}`],
    { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  const outsider = spawnForever(); // 木の外(自分が起動したが、このテストでは止めない対象)
  try {
    const childPid = await new Promise((resolve) => parent.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
    assert.equal(recordIdentity(parent.pid), true);
    await sleep(300);
    const killed = killTreeIfMine(parent.pid);
    assert.ok(killed.includes(parent.pid) && killed.includes(childPid), `止めたもの: ${killed}`);
    await sleep(500);
    assert.equal(exists(parent.pid), false);
    assert.equal(exists(childPid), false);
    assert.equal(exists(outsider.pid), true, "木の外は止めない");
  } finally {
    parent.kill();
    outsider.kill();
  }
});
