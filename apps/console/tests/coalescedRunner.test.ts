// 通知の間引き(`src/coalescedRunner.ts`)のテスト。時計とタイマーを差し替えて、本物の時間を待たない。

import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoalescedRunner } from "../src/coalescedRunner.ts";

/** 手で進める時計。 */
function fakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimer: (handle: unknown) => void timers.delete(handle as number),
    },
    /** 時間を進めて、期限が来たタイマーを順に動かす。 */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
    },
    pendingTimers: () => timers.size,
  };
}

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("最初の通知はすぐ実行する", async () => {
  const c = fakeClock();
  const calls: string[][] = [];
  const r = createCoalescedRunner<string>((items) => void calls.push([...items]), 1000, c.clock);
  r.trigger("a");
  await tick();
  assert.deepEqual(calls, [["a"]]);
});

test("取り直し中・間隔の内に来た通知は、まとめて 1 回(最短の間隔を空ける)", async () => {
  const c = fakeClock();
  const calls: string[][] = [];
  let release: () => void = () => {};
  const r = createCoalescedRunner<string>(
    (items) => {
      calls.push([...items]);
      return new Promise<void>((resolve) => (release = resolve));
    },
    1000,
    c.clock,
  );
  r.trigger("a");
  await tick();
  // 取り直しの最中に、0.1 秒ごとの通知が 30 件来る。
  for (let i = 0; i < 30; i++) {
    r.trigger(i % 2 === 0 ? "a" : "b");
    await c.advance(100);
  }
  assert.equal(calls.length, 1, "取り直しが終わるまで、次は始まらない");
  release();
  await tick();
  // 3 秒たっているので、終わったらすぐ、溜まった分を 1 回で実行する(同じ対象は 1 つ)。
  assert.equal(calls.length, 2);
  assert.deepEqual([...calls[1]].sort(), ["a", "b"]);
  release();
  await tick();
  assert.equal(calls.length, 2, "溜まったものが無ければ、続けて実行しない");
});

test("連続する通知でも、実行の開始は最短の間隔(1 秒)以上あく", async () => {
  const c = fakeClock();
  const starts: number[] = [];
  const r = createCoalescedRunner<number>(
    () => void starts.push(c.clock.now()),
    1000,
    c.clock,
  );
  for (let i = 0; i < 50; i++) {
    r.trigger(i);
    await c.advance(100); // 0.1 秒ごとに通知(5 秒間)
  }
  await c.advance(2000);
  assert.ok(starts.length <= 7, `5 秒間の通知が ${starts.length} 回の取り直しに収まる`);
  assert.ok(starts.length >= 4);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] - starts[i - 1] >= 1000, `間隔: ${starts[i] - starts[i - 1]}ms`);
  }
});

test("通知が止まったあとの最後の変更も、必ず取り直す(取りこぼさない)", async () => {
  const c = fakeClock();
  const seen = new Set<string>();
  const r = createCoalescedRunner<string>((items) => void items.forEach((i) => seen.add(i)), 1000, c.clock);
  r.trigger("first");
  await tick();
  await c.advance(200);
  r.trigger("last"); // 間隔の内に来た最後の通知
  await c.advance(5000);
  await tick();
  assert.ok(seen.has("first") && seen.has("last"));
});

test("cancel すると、予約も溜めた分も捨てて、以後の通知は何もしない", async () => {
  const c = fakeClock();
  let count = 0;
  const r = createCoalescedRunner<string>(() => void count++, 1000, c.clock);
  r.trigger("a");
  await tick();
  r.trigger("b"); // 間隔の内: タイマーが予約される
  assert.equal(c.pendingTimers(), 1);
  r.cancel();
  assert.equal(c.pendingTimers(), 0);
  await c.advance(5000);
  r.trigger("c");
  await c.advance(5000);
  await tick();
  assert.equal(count, 1);
});

test("取り直しが失敗しても、次の通知でまたやり直せる", async () => {
  const c = fakeClock();
  let count = 0;
  const r = createCoalescedRunner<string>(async () => {
    count++;
    if (count === 1) throw new Error("失敗");
  }, 1000, c.clock);
  r.trigger("a");
  await tick();
  await c.advance(1500);
  r.trigger("b");
  await tick();
  assert.equal(count, 2);
});
