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

export function shouldShowStartError(
  error: unknown,
  afterRefresh: Pick<RunningSessionDto, "process_state"> | null,
): boolean {
  const busy = isSessionBusy(error);
  const alive = afterRefresh !== null && afterRefresh.process_state !== "exited";
  return !(busy && alive);
}
