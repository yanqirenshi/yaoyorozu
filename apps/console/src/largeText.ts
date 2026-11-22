// とても大きい発言は、Markdown として描かず、先頭だけを素の文字で出す(描画が空になる・例外が出るのを避ける)。
//
// 目安は 1MB(文字数)。超えたら、先頭 `PREVIEW_CHARS` 文字だけを素の文字で出し、「大きいため省略しました」と添える。

/** これより長い(文字数)発言は、Markdown として描かない。 */
export const LARGE_TEXT_CHARS = 1_000_000;

/** 大きい発言で出す、先頭の文字数。 */
export const PREVIEW_CHARS = 2_000;

export type LargeTextView = { large: false } | { large: true; preview: string; note: string };

/** 発言の表示の仕方を決める(純粋。`MessageText` が使う)。 */
export function viewOfText(text: string): LargeTextView {
  if (text.length <= LARGE_TEXT_CHARS) return { large: false };
  const megabytes = (text.length / 1_000_000).toFixed(1);
  return {
    large: true,
    // サロゲートペアの途中で切らない。
    preview: Array.from(text.slice(0, PREVIEW_CHARS)).join(""),
    note: `大きいため省略しました(全体で約 ${megabytes}M 文字。先頭 ${PREVIEW_CHARS} 文字だけを出しています)`,
  };
}
