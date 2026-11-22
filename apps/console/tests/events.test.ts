// 通知と途中経過の接続(`src/api/events.ts`。Rust サーバへ直接つなぐ WebSocket)のテスト。WebSocket と fetch(券)を偽物に差し替える。
// 確かめること: 券をもらってから、つないだあとの最初のメッセージで券を送る(URL に入れない) / `ready` で接続済みになる /
// 購読はその接続の上で頼む / 購読ごとに振り分ける / つなぎ直すたびに新しい券をもらい、購読し直す / 通知を渡す /
// ping に pong を返す / やめたら外して接続も閉じる / 券がもらえなくてもつなぎ直す。

import assert from "node:assert/strict";
import { test } from "node:test";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  // サーバから
  open() {
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    this.onclose?.();
  }
}

let tickets: string[] = [];
let ticketCalls = 0;
let failTickets = false;
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: { method?: string }) => {
  assert.equal(url, "/api/rpc/issue_ws_ticket");
  assert.equal(init?.method, "POST");
  ticketCalls += 1;
  if (failTickets) return { ok: false, status: 503, json: async () => ({}) };
  const ticket = `ticket-${ticketCalls}`;
  tickets.push(ticket);
  return { ok: true, status: 200, json: async () => ({ ticket, port: 14210 }) };
};

const { listen, onConnectionChange, onReconnected, openProgressSubscription } = await import("../src/api/events.ts");

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const last = () => FakeWebSocket.instances.at(-1)!;
const TARGET = { pid_domain: "windows:x", pid: 1, started_at: 1 };

/** 券をもらって、つなぎ、`ready` までを進める。 */
async function establish(): Promise<FakeWebSocket> {
  await tick();
  const ws = last();
  ws.open();
  ws.receive({ type: "ready" });
  await tick();
  return ws;
}

test("券は、つないだあとの最初のメッセージで送る(URL には入れない)。ready で接続済みになる", async () => {
  FakeWebSocket.instances = [];
  tickets = [];
  const states: string[] = [];
  const unlisten = await onConnectionChange((s) => states.push(s));
  await tick();
  const ws = last();
  assert.equal(ws.url, "ws://127.0.0.1:14210/ws", "ポートは券と一緒にもらったもの。クエリは付けない");
  assert.equal(ws.sent.length, 0, "つながるまで何も送らない");
  ws.open();
  assert.deepEqual(ws.sent, [{ type: "ticket", ticket: tickets[0] }], "最初のメッセージが券");
  assert.deepEqual(states, ["connecting"], "ready の前は、まだつながっていない");
  ws.receive({ type: "ready" });
  assert.deepEqual(states, ["connecting", "connected"]);
  unlisten();
  assert.equal(ws.closed, true, "使う人がいなくなったら閉じる");
});

test("購読はその接続の上で頼み、購読 ID ごとに振り分ける。やめたら購読解除を送り、接続も閉じる", async () => {
  FakeWebSocket.instances = [];
  const got: unknown[] = [];
  const stop = openProgressSubscription(TARGET, (p, seq) => got.push([p, seq]));
  const ws = await establish();
  const subscribe = ws.sent.find((m) => m.type === "subscribe")!;
  assert.deepEqual(subscribe.target, TARGET);

  // 返事の前の途中経過(別の購読 ID)は渡らない。
  ws.receive({ type: "progress", data: { subscription_id: 999, seq: 1, progress: { other: true } } });
  ws.receive({ type: "subscribed", request_id: subscribe.request_id, subscription_id: 100 });
  await tick(); // 返事を受けて、振り分け先を登録するのは、次の処理(実際は、次のメッセージより前に済む)
  ws.receive({ type: "progress", data: { subscription_id: 100, seq: 3, progress: { n: 1 } } });
  ws.receive({ type: "progress", data: { subscription_id: 999, seq: 1, progress: { other: true } } });
  assert.deepEqual(got, [[{ n: 1 }, 3]]);

  stop();
  assert.deepEqual(ws.sent.at(-1), { type: "unsubscribe", subscription_id: 100 });
  assert.equal(ws.closed, true);
});

test("つなぎ直すたびに、新しい券をもらって購読し直す。再接続の合図が出て、古い接続のものは使わない", async () => {
  FakeWebSocket.instances = [];
  ticketCalls = 0;
  const got: unknown[] = [];
  let reconnected = 0;
  const unlistenReconnected = await onReconnected(() => (reconnected += 1));
  const stop = openProgressSubscription(TARGET, (p) => got.push(p));
  const first = await establish();
  const sub1 = first.sent.find((m) => m.type === "subscribe")!;
  first.receive({ type: "subscribed", request_id: sub1.request_id, subscription_id: 200 });
  await tick();
  assert.equal(reconnected, 0, "最初のつなぎは、つなぎ直しではない");

  // 切れる → 自分でつなぎ直す(1 秒)。新しい券で。
  first.drop();
  await new Promise((resolve) => setTimeout(resolve, 1150));
  const second = last();
  assert.notEqual(second, first);
  second.open();
  assert.equal(second.sent[0]?.ticket, tickets.at(-1));
  assert.notEqual(second.sent[0]?.ticket, first.sent[0]?.ticket, "券は使い回さない");
  second.receive({ type: "ready" });
  await tick();
  assert.equal(reconnected, 1);
  const sub2 = second.sent.find((m) => m.type === "subscribe")!;
  second.receive({ type: "subscribed", request_id: sub2.request_id, subscription_id: 201 });
  await tick();

  // 古い接続へ遅れて届いたものは使わない。新しい購読のものだけが渡る。
  first.receive({ type: "progress", data: { subscription_id: 200, seq: 1, progress: { old: true } } });
  second.receive({ type: "progress", data: { subscription_id: 201, seq: 1, progress: { fresh: true } } });
  assert.deepEqual(got, [{ fresh: true }]);

  stop();
  unlistenReconnected();
});

test("通知は、イベント名ごとに渡る。ping には pong を返す", async () => {
  FakeWebSocket.instances = [];
  const received: unknown[] = [];
  const unlisten = await listen("settings:updated", (p) => received.push(p));
  const ws = await establish();
  ws.receive({ type: "event", name: "settings:updated", data: { a: 1 } });
  ws.receive({ type: "event", name: "other:event", data: { b: 2 } });
  assert.deepEqual(received, [{ a: 1 }]);
  ws.receive({ type: "ping" });
  assert.deepEqual(ws.sent.at(-1), { type: "pong" });
  unlisten();
});

test("券がもらえなくても、切れた扱いにして、あとでつなぎ直す", async () => {
  FakeWebSocket.instances = [];
  ticketCalls = 0;
  failTickets = true;
  const states: string[] = [];
  const unlisten = await onConnectionChange((s) => states.push(s));
  await tick();
  assert.deepEqual(states, ["connecting", "disconnected"]);
  assert.equal(FakeWebSocket.instances.length, 0, "券が無ければ、つながない");
  failTickets = false;
  await new Promise((resolve) => setTimeout(resolve, 1150));
  assert.equal(FakeWebSocket.instances.length, 1);
  last().open();
  last().receive({ type: "ready" });
  assert.deepEqual(states, ["connecting", "disconnected", "connected"]);
  unlisten();
});
