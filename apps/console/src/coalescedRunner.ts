// 通知(`session:changed` など)を受けるたびに取り直すと、書き込みが続く会話では 0.1 秒ごとに
// 一覧と会話を取り直してしまう。**取り直し中に来た通知はまとめて 1 回**にし、**最短の間隔**を設ける。
//
// 動き:
// - `trigger(item)`: 取り直しの対象(例: 変更のあったプロジェクト名)を溜める。
//   - 動いていなくて、前の開始から最短の間隔がたっていれば、すぐ実行する。
//   - 動いている最中・間隔の内なら、溜めておき、間隔が明けたあとに**まとめて 1 回**実行する。
// - 実行のたびに、溜めた対象をまとめて `task` へ渡す(同じ対象は 1 つ)。
// - `cancel()`: 予約を取り消す(画面を離れたとき・unmount のとき)。以後の `trigger` は何もしない。
//
// 時計とタイマーは差し替えられる(Node のテストで、本物の時間を待たずに確かめるため)。

export type CoalescedRunner<T> = {
  trigger: (item: T) => void;
  cancel: () => void;
};

type Clock = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

const realClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createCoalescedRunner<T>(
  task: (items: Set<T>) => Promise<unknown> | void,
  minIntervalMs = 1000,
  clock: Clock = realClock,
): CoalescedRunner<T> {
  let pending = new Set<T>();
  let running = false;
  let cancelled = false;
  let timer: unknown = null;
  // 前の実行を始めた時刻(まだ一度も実行していなければ、すぐ実行できる)。
  let lastStart = Number.NEGATIVE_INFINITY;

  const schedule = () => {
    if (cancelled || running || timer !== null || pending.size === 0) return;
    const wait = Math.max(0, lastStart + minIntervalMs - clock.now());
    if (wait === 0) {
      void run();
      return;
    }
    timer = clock.setTimer(() => {
      timer = null;
      schedule();
    }, wait);
  };

  const run = async () => {
    if (cancelled || running || pending.size === 0) return;
    const items = pending;
    pending = new Set<T>();
    running = true;
    lastStart = clock.now();
    try {
      await task(items);
    } catch {
      // 取り直しの失敗は、呼び出し側(task)が画面に出す。次の通知でまたやり直す。
    } finally {
      running = false;
      schedule();
    }
  };

  return {
    trigger(item) {
      if (cancelled) return;
      pending.add(item);
      schedule();
    },
    cancel() {
      cancelled = true;
      pending.clear();
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
    },
  };
}
