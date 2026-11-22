// 途中経過の購読(`src/api/events.ts` の `openProgressSubscription`)のテスト。EventSource を偽物に差し替える。
// 確かめること: 接続 ID で購読する / 購読 ID より先に届いた途中経過をためて渡す / 購読ごとに振り分ける /
// つなぎ直したら新しい接続 ID で購読し直す / やめたら外して接続も閉じる。

import assert from "node:assert/strict";
import { test } from "node:test";

type Handler = (event: { data: string }) => void;

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  handlers = new Map<string, Handler[]>();
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, handler: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(name: string, data: unknown) {
    this.handlers.get(name)?.forEach((h) => h({ data: JSON.stringify(data) }));
  }
}

(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;

const { openProgressSubscription } = await import("../src/api/events.ts");

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("接続 ID で購読し、購読 ID より先に届いた途中経過もためて渡し、購読ごとに振り分ける", async () => {
  const registered: string[] = [];
  const got: unknown[] = [];
  let release: (id: number) => void = () => {};
  const stop = openProgressSubscription(
    (connectionId) => {
      registered.push(connectionId);
      return new Promise<number>((resolve) => {
        release = resolve; // 購読 ID の応答を、あとで返す。
      });
    },
    async () => {},
    (p) => got.push(p),
  );
  const es = FakeEventSource.instances.at(-1)!;
  es.emit("connection", { connection_id: "conn-7" });
  await tick();
  assert.deepEqual(registered, ["conn-7"]);

  // 購読 ID の応答より先に、途中経過が届く。
  es.emit("running-session:progress", { subscription_id: 100, seq: 1, progress: { n: 1 } });
  es.emit("running-session:progress", { subscription_id: 999, seq: 1, progress: { other: true } });
  release(100);
  await tick();
  assert.deepEqual(got, [{ n: 1 }]);

  // 登録のあとに届くものは、そのまま渡る。ほかの購読 ID のものは渡らない。
  es.emit("running-session:progress", { subscription_id: 100, seq: 1, progress: { n: 2 } });
  es.emit("running-session:progress", { subscription_id: 999, seq: 1, progress: { other: true } });
  assert.deepEqual(got, [{ n: 1 }, { n: 2 }]);
  stop();
});

test("つなぎ直したら、新しい接続 ID で購読し直す。やめたら外して、接続も閉じる", async () => {
  const registered: string[] = [];
  const unregistered: [number, string][] = [];
  const got: unknown[] = [];
  let nextSub = 200;
  const stop = openProgressSubscription(
    async (connectionId) => {
      registered.push(connectionId);
      return nextSub++;
    },
    async (subscriptionId, connectionId) => {
      unregistered.push([subscriptionId, connectionId]);
    },
    (p) => got.push(p),
  );
  const first = FakeEventSource.instances.at(-1)!;
  first.emit("connection", { connection_id: "conn-1" });
  await tick();
  assert.deepEqual(registered, ["conn-1"]);

  // 切れて(CLOSED)、自分でつなぎ直す(タイマー)。新しい接続の ID で購読し直す。
  first.readyState = FakeEventSource.CLOSED;
  first.onerror?.();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = FakeEventSource.instances.at(-1)!;
  assert.notEqual(second, first);
  second.emit("connection", { connection_id: "conn-1" });
  await tick();
  assert.deepEqual(registered, ["conn-1", "conn-1"]);

  // 古い接続のほうへ遅れて届いたものは、使わない。新しい接続の新しい購読 ID のものだけが渡る。
  first.emit("running-session:progress", { subscription_id: 200, seq: 1, progress: { old: true } });
  second.emit("running-session:progress", { subscription_id: 201, seq: 1, progress: { fresh: true } });
  assert.deepEqual(got, [{ fresh: true }]);

  stop();
  await tick();
  assert.deepEqual(unregistered, [[201, "conn-1"]]);
  assert.equal(second.closed, true);
});
