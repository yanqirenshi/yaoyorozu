// イベント(SSE)の接続管理。ブラウザ任せの再接続には頼らず、自分でつなぎ直す。
//
// なぜ: 中継はサーバに届かないとき `/api/events` を 503(application/json)で返す。EventSource は
// 仕様どおり、これを受けると再接続をやめて CLOSED になる(サーバを起動し直しても戻らない)。
//
// 形:
// - 購読者(`listen`・`onConnectionChange`・`onReconnected`)が 1 人でもいる間だけ接続を持つ。
//   0 人になったら閉じ、つなぎ直しの予約も取り消す(unlisten されたらつなぎ直しも止まる)。
// - 切れたら(CLOSED、または自動再接続の待ち)接続状態を "disconnected" にし、間隔を空けて
//   (1 秒から始めて 2 倍ずつ、最大 10 秒)作り直す。
// - つながったら "connected"。それが「切れたあとのつなぎ直し」なら、`onReconnected` の合図を出す。
//   切れている間のイベントは失われているので、画面はこの合図で表示を取り直す(Query を取り直す)。
//   サーバが止まっている間に画面を開き、あとでサーバを起動した場合(初回の接続が失敗していた)も
//   同じ合図が出る。

export type ConnectionState = "connecting" | "connected" | "disconnected";

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;
const EVENTS_URL = "/api/events";

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
const stateListeners = new Set<(state: ConnectionState) => void>();
const reconnectedListeners = new Set<() => void>();

let subscribers = 0;
let source: EventSource | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let delay = INITIAL_DELAY_MS;
let state: ConnectionState = "connecting";
// 接続に失敗した(切れた)あと、まだつながり直していないか。
let hadFailure = false;
// 今の EventSource に付けたイベント名(つなぎ直すたびに付け直す)。
let attached = new Set<string>();

function setState(next: ConnectionState) {
  if (state === next) return;
  state = next;
  stateListeners.forEach((fn) => fn(next));
}

function attach(es: EventSource, name: string) {
  if (attached.has(name)) return;
  attached.add(name);
  es.addEventListener(name, (event) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse((event as MessageEvent<string>).data);
    } catch {
      // 本文が JSON でなければ null として渡す。
    }
    listeners.get(name)?.forEach((fn) => fn(payload));
  });
}

function connect() {
  timer = null;
  if (subscribers === 0) return;
  const es = new EventSource(EVENTS_URL);
  source = es;
  attached = new Set();
  listeners.forEach((_, name) => attach(es, name));

  es.onopen = () => {
    if (source !== es) return;
    delay = INITIAL_DELAY_MS;
    setState("connected");
    if (hadFailure) {
      hadFailure = false;
      reconnectedListeners.forEach((fn) => fn());
    }
  };
  es.onerror = () => {
    if (source !== es) return;
    hadFailure = true;
    setState("disconnected");
    if (es.readyState === EventSource.CLOSED) {
      // ブラウザは再接続をやめた(503 など)。自分でつなぎ直す。
      es.close();
      source = null;
      scheduleReconnect();
    }
    // CONNECTING の間は、ブラウザが自分で再接続している(つながれば onopen が来る。
    // 失敗すれば CLOSED で再び onerror が来て、上の分岐に入る)。
  };
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
  if (timer !== null) clearTimeout(timer);
  timer = null;
  source?.close();
  source = null;
  attached = new Set();
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
  if (source) attach(source, name);
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
