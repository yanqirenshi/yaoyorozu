// 二重実行の防止(`src/exclusive.ts`)のテスト。同じ刻み(待たずに続けて呼ぶ)でも、1 回しか動かない。

import assert from "node:assert/strict";
import { test } from "node:test";
import { createExclusive } from "../src/exclusive.ts";

test("同じ刻みで 3 回呼んでも、実行は 1 回だけ(2 回目以降は fallback をすぐ返す)", async () => {
  const ex = createExclusive();
  let runs = 0;
  let release: () => void = () => {};
  const work = () =>
    new Promise<boolean>((resolve) => {
      runs += 1;
      release = () => resolve(true);
    });
  // クリック 2 回 + Enter: await せずに続けて呼ぶ。
  const results = [ex.run("send", false, work), ex.run("send", false, work), ex.run("send", false, work)];
  release();
  assert.deepEqual(await Promise.all(results), [true, false, false]);
  assert.equal(runs, 1);
});

test("終わったら(失敗しても)次を受け付ける。鍵が違う操作は互いに止めない", async () => {
  const ex = createExclusive();
  await assert.rejects(ex.run("stop", undefined, async () => Promise.reject(new Error("失敗"))));
  assert.equal(ex.has("stop"), false);
  assert.equal(await ex.run("stop", "x", async () => "again"), "again");

  let release: () => void = () => {};
  const first = ex.run("respond:1", undefined, () => new Promise<undefined>((r) => (release = () => r(undefined))));
  assert.equal(ex.has("respond:1"), true);
  assert.equal(await ex.run("respond:2", "no", async () => "other"), "other");
  release();
  await first;
  assert.equal(ex.has("respond:1"), false);
});
