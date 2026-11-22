// 入力欄の下書きと、貼り付けた画像を、会話ごとに(このタブのメモリの中で)持つ。
//
// 会話を切り替えると、その会話の下書きが出る。戻ると、元の下書きが戻る。保存はしない(タブを閉じれば消える)。
// 業務状態ではなく、入力途中の UI 状態(native.md §2)。

export type Draft<A> = { text: string; attachments: A[] };

export function createDraftStore<A>() {
  const drafts = new Map<string, Draft<A>>();
  return {
    /** `from` の会話を離れるとき: いまの入力を控え、`to` の会話の入力を返す(無ければ空)。 */
    switch(from: string | null, current: Draft<A>, to: string | null): Draft<A> {
      if (from === to) return current;
      if (from !== null && (current.text !== "" || current.attachments.length > 0)) {
        drafts.set(from, current);
      } else if (from !== null) {
        drafts.delete(from);
      }
      const restored = to === null ? undefined : drafts.get(to);
      if (to !== null) drafts.delete(to);
      return restored ?? { text: "", attachments: [] };
    },
    size: () => drafts.size,
  };
}
