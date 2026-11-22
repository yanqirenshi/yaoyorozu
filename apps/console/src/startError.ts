// 起動(送信での自動起動・「起動」ボタン)が失敗したときの、エラーを出すかどうかの判断(純粋)。
//
// 2 つのタブから同じ会話を同時に起動すると、負けたほうは 409(`session_busy`。「この会話は起動している最中です」)になる。
// 状態を取り直して、その会話がもう実行中(終了していない)なら、エラーは出さない(実際には起動できているため)。

import type { RunningSessionDto } from "@/api/types";

/** 起動が 409(`session_busy`。同じ会話を、ほかが起動している最中)で断られたか。 */
export function isSessionBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "session_busy"
  );
}

/**
 * 409(`session_busy`)の種類(サーバの文面で見分ける)。
 * - `starting`: 同じ会話を、ほかが起動している最中(待てば、実行中になる)
 * - `running`: 同じ会話が、すでに実行中(取り直せば、実行中として見える)
 * - `limit`: 同時に実行できる数の上限(待っても実行中にならない)
 * - `other`: そのほか(待たずにすぐ出す)
 * `session_busy` でなければ `null`。
 */
export type BusyKind = "starting" | "running" | "limit" | "other";

export function busyKind(error: unknown): BusyKind | null {
  if (!isSessionBusy(error)) return null;
  const message = String((error as { message?: unknown }).message ?? "");
  if (message.includes("起動している最中")) return "starting";
  if (message.includes("すでに実行中")) return "running";
  if (message.includes("同時に実行できる")) return "limit";
  return "other";
}

/** 実行中になるのを待つ価値があるか(待っても実行中にならない種類は、待たずにすぐ出す)。 */
export function shouldWaitForRunning(error: unknown): boolean {
  const kind = busyKind(error);
  return kind === "starting" || kind === "running";
}

export function shouldShowStartError(
  error: unknown,
  afterRefresh: Pick<RunningSessionDto, "process_state"> | null,
): boolean {
  const busy = isSessionBusy(error);
  const alive = afterRefresh !== null && afterRefresh.process_state !== "exited";
  return !(busy && alive);
}
