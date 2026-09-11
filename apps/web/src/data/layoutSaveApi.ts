/**
 * 図のレイアウト調整(ノード座標・サイズ)を保存API
 * (`POST /api/layout/<diagram>`)経由でリポジトリ内ファイル
 * (`src/data/layout/<diagram>.json`)へ保存するための共通クライアント。
 * web.md §2 の例外規定に従う。実体はApp(Tauri)のローカルAPIへの
 * プロキシで、App未起動時のみ開発時に限りfsへ直接書き込む(issue #123)。
 *
 * 同じ図への保存は図ごとに1本の列に並べて送る(`createLatestWinsQueue`)。
 */

export const LAYOUT_DIAGRAMS = ["sitemap", "classes", "tm"] as const;
export type LayoutDiagram = (typeof LAYOUT_DIAGRAMS)[number];

export type LayoutSaveResult = {
  ok: boolean;
  status: number;
  /** 保存に失敗した場合、Appまたはサーバから返された具体的な理由。 */
  message?: string;
};

function extractErrorMessage(body: unknown): string | undefined {
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return undefined;
}

async function postLayout(
  diagram: LayoutDiagram,
  overrides: unknown,
): Promise<LayoutSaveResult> {
  try {
    const res = await fetch(`/api/layout/${diagram}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides),
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    const body: unknown = await res.json().catch(() => null);
    return { ok: false, status: res.status, message: extractErrorMessage(body) };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * 送信を1本の列に並べ、待っている間に来たものは最新だけを送る。
 *
 * レイアウトの保存は毎回ファイル全体を送り、サーバはファイルを丸ごと置き換える。
 * 並行して送ると到着順が入れ替わり、古い内容が後から書かれて勝つことがある
 * (例: TM でズームした直後に箱をドラッグすると、800ms 待ってから走る視点の保存と
 * ドラッグの保存が重なる)。そこで送信中は次を待たせ、待っている間に届いた内容は
 * 最新のもので上書きする。途中の内容は最新の内容に含まれるので捨ててよい。
 * 待っていた呼び出しには、自分の内容を含んだ送信の結果を返す。
 */
export function createLatestWinsQueue<T, R>(
  send: (payload: T) => Promise<R>,
): (payload: T) => Promise<R> {
  type Waiter = { resolve: (result: R) => void; reject: (error: unknown) => void };

  let sending = false;
  let pending: { payload: T; waiters: Waiter[] } | null = null;

  const drain = async () => {
    sending = true;
    while (pending) {
      const { payload, waiters } = pending;
      pending = null;
      try {
        const result = await send(payload);
        for (const waiter of waiters) waiter.resolve(result);
      } catch (error) {
        // 失敗しても列は止めない(次に待っている内容は送る)。
        for (const waiter of waiters) waiter.reject(error);
      }
    }
    sending = false;
  };

  return (payload) =>
    new Promise<R>((resolve, reject) => {
      if (pending) {
        pending.payload = payload;
        pending.waiters.push({ resolve, reject });
      } else {
        pending = { payload, waiters: [{ resolve, reject }] };
      }
      if (!sending) void drain();
    });
}

// 図ごとの列。画面の再マウントをまたいでも同じ列を使うよう、モジュールに置く。
const queues = new Map<LayoutDiagram, (overrides: unknown) => Promise<LayoutSaveResult>>();

export function saveLayoutToApi(
  diagram: LayoutDiagram,
  overrides: unknown,
): Promise<LayoutSaveResult> {
  let enqueue = queues.get(diagram);
  if (!enqueue) {
    enqueue = createLatestWinsQueue((payload: unknown) => postLayout(diagram, payload));
    queues.set(diagram, enqueue);
  }
  return enqueue(overrides);
}
