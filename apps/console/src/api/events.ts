// 通知と途中経過の接続管理(Rust サーバへ直接つなぐ WebSocket。タブごとに 1 本)。
//
// なぜ WebSocket か: Next の中継は HTTP/1.1 だけで、同じ接続先への接続が 6 本までなので、タブごとの SSE が 6 本になると、
// 全部のタブの操作と新しいタブの読み込みが止まった(#629・#633)。WebSocket はその枠を使わない。
// 操作(`/rpc`)は、今までどおり Next が中継する(トークンはブラウザへ渡さない)。
//
// つなぎ方(守りは `server/README.md` と `server/src/ws.rs`):
// 1. 中継を通して、使い捨ての「券」とつなぐ先のポートをもらう(`issue_ws_ticket`)。
// 2. `ws://127.0.0.1:<ポート>/ws` へつなぎ、**最初のメッセージ**で券を送る(券を URL に入れない)。
// 3. サーバが `ready` を返したら、つながった。通知(`event`)・途中経過(`progress`)・`ping` が届く。
//    購読・購読解除は、この接続の上のメッセージで行う(`subscribe` → `subscribed`)。
//
// 形:
// - 購読者(`listen`・`onConnectionChange`・`onReconnected`・途中経過の購読)が 1 人でもいる間だけ接続を持つ。
//   0 人になったら閉じ、つなぎ直しの予約も取り消す。
// - 切れたら接続状態を "disconnected" にし、間隔を空けて(1 秒から始めて 2 倍ずつ、最大 10 秒)作り直す。
//   つなぎ直すたびに、新しい券をもらう(券は 1 回しか使えない)。ブラウザ任せの再接続には頼らない。
// - つながったら "connected"。それが「切れたあとのつなぎ直し」なら、`onReconnected` の合図を出す。
//   切れている間の通知・途中経過は失われているので、画面はこの合図で表示を取り直す(Query を取り直す)。
//   サーバが止まっている間に画面を開き、あとでサーバを起動した場合(初回の接続が失敗していた)も同じ合図が出る。
// - 凍結されたタブ・スリープから戻ったタブは、接続が切れている(ブラウザが閉じる)。サーバの ping に pong が返らない接続は
//   サーバが閉じ、こちらも、一定時間サーバから何も届かなければ切れたとみなして、つなぎ直す。
// - 途中経過は、接続ごとの待ち行列(サーバ側)から、会話ごとの連番つきで届く。つなぎ直したときは、購読し直す
//   (サーバの購読は接続とともに消えている)。**接続の持ち方は、このファイルの中に閉じる**:
//   画面側は `openProgressSubscription` だけを使い、接続も券も知らない。

export type ConnectionState = "connecting" | "connected" | "disconnected";

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;
const TICKET_URL = "/api/rpc/issue_ws_ticket";
/** サーバの ping(10 秒ごと)が届かないまま、これだけ経ったら、切れたとみなす。 */
const SILENCE_LIMIT_MS = 35000;
const WATCHDOG_INTERVAL_MS = 5000;
/** 購読の要求への返事を待つ上限。 */
const REQUEST_TIMEOUT_MS = 10000;

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
const stateListeners = new Set<(state: ConnectionState) => void>();
const reconnectedListeners = new Set<() => void>();
/** つながった(`ready`)たびに呼ぶ(途中経過の購読が、購読し直す)。 */
const readyListeners = new Set<() => void>();

let subscribers = 0;
let socket: WebSocket | null = null;
let ready = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let lastHeard = 0;
let delay = INITIAL_DELAY_MS;
let state: ConnectionState = "connecting";
// 接続に失敗した(切れた)あと、まだつながり直していないか。
let hadFailure = false;
// つなぎ直しのたびに進める(古い試みの遅れて来た結果を捨てる)。
let attempt = 0;

// 購読 ID → 途中経過の受け取り口。
type ProgressMessage = { seq: number; progress: unknown };
const progressSinks = new Map<number, (message: ProgressMessage) => void>();
// 返事待ちの購読の要求(request_id → 返事の受け口)。
const pendingRequests = new Map<
  number,
  { resolve: (subscriptionId: number) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
let requestSeq = 0;

function setState(next: ConnectionState) {
  if (state === next) return;
  state = next;
  stateListeners.forEach((fn) => fn(next));
}

function rejectPending(reason: string) {
  pendingRequests.forEach((p) => {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  });
  pendingRequests.clear();
}

function stopWatchdog() {
  if (watchdog !== null) clearInterval(watchdog);
  watchdog = null;
}

function sendJson(ws: WebSocket, message: unknown): boolean {
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

/** 今の接続が使えなくなった(切れた・券がもらえなかった・黙った)。つなぎ直す。 */
function lost(ws: WebSocket | null) {
  if (ws !== null && socket !== ws) return; // 古い接続の知らせは無視する。
  if (ws !== null) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // すでに閉じている。
    }
  }
  socket = null;
  ready = false;
  stopWatchdog();
  rejectPending("接続が切れました");
  hadFailure = true;
  setState("disconnected");
  scheduleReconnect();
}

function handleMessage(ws: WebSocket, raw: unknown) {
  if (socket !== ws || typeof raw !== "string") return;
  lastHeard = Date.now();
  let message: { type?: string; [key: string]: unknown };
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  switch (message.type) {
    case "ready":
      ready = true;
      delay = INITIAL_DELAY_MS;
      setState("connected");
      if (hadFailure) {
        hadFailure = false;
        reconnectedListeners.forEach((fn) => fn());
      }
      readyListeners.forEach((fn) => fn());
      break;
    case "event": {
      const name = message.name;
      if (typeof name === "string") listeners.get(name)?.forEach((fn) => fn(message.data));
      break;
    }
    case "progress": {
      const body = message.data as { subscription_id?: number; seq?: number; progress?: unknown } | undefined;
      if (!body || typeof body.subscription_id !== "number" || typeof body.seq !== "number") return;
      progressSinks.get(body.subscription_id)?.({ seq: body.seq, progress: body.progress });
      break;
    }
    case "subscribed":
    case "subscribe_failed": {
      const id = message.request_id;
      if (typeof id !== "number") return;
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);
      clearTimeout(pending.timer);
      if (message.type === "subscribed" && typeof message.subscription_id === "number") {
        pending.resolve(message.subscription_id);
      } else {
        pending.reject(new Error(String(message.message ?? "購読できませんでした")));
      }
      break;
    }
    case "ping":
      sendJson(ws, { type: "pong" });
      break;
  }
}

async function fetchTicket(): Promise<{ ticket: string; port: number }> {
  const response = await fetch(TICKET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`券をもらえません(${response.status})`);
  const body = (await response.json()) as { ticket?: unknown; port?: unknown };
  if (typeof body.ticket !== "string" || typeof body.port !== "number") {
    throw new Error("券の形が違います");
  }
  return { ticket: body.ticket, port: body.port };
}

function connect() {
  timer = null;
  if (subscribers === 0) return;
  const mine = ++attempt;
  fetchTicket()
    .then(({ ticket, port }) => {
      if (mine !== attempt || subscribers === 0) return;
      // CSP の `connect-src` に足してあるのは `ws://127.0.0.1:<ポート>` だけ(画面を localhost で開いていても、ここは 127.0.0.1)。
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socket = ws;
      lastHeard = Date.now();
      ws.onopen = () => {
        if (socket !== ws) return;
        // 券は最初のメッセージで送る(URL には入れない)。
        sendJson(ws, { type: "ticket", ticket });
      };
      ws.onmessage = (event) => handleMessage(ws, event.data);
      ws.onclose = () => lost(ws);
      ws.onerror = () => lost(ws);
      stopWatchdog();
      watchdog = setInterval(() => {
        if (socket === ws && Date.now() - lastHeard > SILENCE_LIMIT_MS) lost(ws);
      }, WATCHDOG_INTERVAL_MS);
    })
    .catch(() => {
      if (mine !== attempt) return;
      lost(null);
    });
}

function scheduleReconnect() {
  if (timer !== null || subscribers === 0) return;
  timer = setTimeout(connect, delay);
  delay = Math.min(delay * 2, MAX_DELAY_MS);
}

function retain() {
  subscribers += 1;
  if (subscribers === 1) {
    delay = INITIAL_DELAY_MS;
    hadFailure = false;
    state = "connecting";
    connect();
  }
}

function release() {
  subscribers -= 1;
  if (subscribers > 0) return;
  subscribers = 0;
  attempt += 1;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  stopWatchdog();
  rejectPending("接続を閉じました");
  if (socket) {
    const ws = socket;
    socket = null;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // すでに閉じている。
    }
  }
  ready = false;
}

/** サーバのイベントを購読する。戻り値の関数で購読をやめる(0 人になれば接続も閉じる)。 */
export function listen<T>(
  name: string,
  callback: (payload: T) => void,
): Promise<() => void> {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  const handler: Listener = (payload) => callback(payload as T);
  set.add(handler);
  retain();
  let done = false;
  return Promise.resolve(() => {
    if (done) return;
    done = true;
    listeners.get(name)?.delete(handler);
    release();
  });
}

/** 接続状態の変化を購読する。登録直後に、今の状態を 1 回返す。 */
export function onConnectionChange(
  callback: (state: ConnectionState) => void,
): Promise<() => void> {
  stateListeners.add(callback);
  retain();
  callback(state);
  let done = false;
  return Promise.resolve(() => {
    if (done) return;
    done = true;
    stateListeners.delete(callback);
    release();
  });
}

/**
 * 「つなぎ直せた」合図を購読する。切れている間のイベントは失われているので、
 * 画面はこの合図で表示(Query)を取り直す。
 */
export function onReconnected(callback: () => void): Promise<() => void> {
  reconnectedListeners.add(callback);
  retain();
  let done = false;
  return Promise.resolve(() => {
    if (done) return;
    done = true;
    reconnectedListeners.delete(callback);
    release();
  });
}

/** この接続の上で、購読を頼む(返事の購読 ID を返す)。つながっていなければ失敗する。 */
function requestSubscription(target: unknown): Promise<number> {
  const ws = socket;
  if (!ws || !ready) return Promise.reject(new Error("接続していません"));
  const id = ++requestSeq;
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("購読の返事が来ません"));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer: timeout });
    if (!sendJson(ws, { type: "subscribe", request_id: id, target })) {
      pendingRequests.delete(id);
      clearTimeout(timeout);
      reject(new Error("送れませんでした"));
    }
  });
}

function sendUnsubscribe(subscriptionId: number) {
  if (socket && ready) sendJson(socket, { type: "unsubscribe", subscription_id: subscriptionId });
}

/**
 * 実行中セッション 1 つ(`target`)の途中経過の購読を持つ。戻り値の関数で購読をやめる(接続も、ほかに使う人が
 * いなければ閉じる)。
 *
 * - つながったら(つなぎ直したときも)、この接続の上で購読を頼む。サーバの購読は接続とともに消えているので、
 *   つなぎ直したときは、外す必要は無く、頼み直すだけ。切れている間の途中経過は失われる(画面は `onReconnected` で取り直す)。
 * - 購読に失敗しても例外は出さない(状態と確定した行は Query で取れる。表示が劣化するだけ)。
 */
export function openProgressSubscription(
  target: unknown,
  onProgress: (progress: unknown, seq: number) => void,
): () => void {
  let cancelled = false;
  let current: number | null = null;
  let generation = 0;

  const setup = () => {
    generation += 1;
    const mine = generation;
    if (current !== null) {
      progressSinks.delete(current);
      current = null;
    }
    requestSubscription(target)
      .then((subscriptionId) => {
        if (cancelled || mine !== generation) {
          sendUnsubscribe(subscriptionId);
          return;
        }
        current = subscriptionId;
        progressSinks.set(subscriptionId, (m) => onProgress(m.progress, m.seq));
      })
      .catch(() => {
        // 購読できなくても、表示が劣化するだけ。
      });
  };

  readyListeners.add(setup);
  retain();
  if (ready) setup();

  return () => {
    if (cancelled) return;
    cancelled = true;
    generation += 1;
    readyListeners.delete(setup);
    if (current !== null) {
      progressSinks.delete(current);
      sendUnsubscribe(current);
      current = null;
    }
    release();
  };
}
