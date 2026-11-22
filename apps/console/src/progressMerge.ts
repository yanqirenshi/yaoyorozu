// 途中経過(返答中の表示の断片)と、取り直し(`get_running_session`)の合わせ方を、**番号で決める**(1 か所)。
//
// サーバは、会話(実行中セッション)ごとに、途中経過へ 1 からの連番(`seq`)を付けて流し、取り直しの応答には
// 「ここまで」の番号(`progress_seq`)を載せる。画面は次の決まりで合わせる:
//
// - 取り直しの「ここまで」以下の断片は捨てる(取り直しより前のもの。切り替える前の購読から遅れて届いた分や、
//   つなぎ直しの前の分が、続きの前に割り込んで、重なる・順番が崩れるのを防ぐ)。続きだけを足す。
// - 一度渡した番号以下(重なり・順番が前後して遅れて届いたもの)は渡さない。
// - 番号が飛んだとき(抜け)は、届いたものをそのまま渡す(失われた断片は戻せない)。抜けた数は `missed` で返す。
// - 「ここまで」が分かる前に届いた断片(購読のほうが先に張れたとき)は、ためておき、「ここまで」が分かったら、
//   続きの分だけを番号の順に渡す。
//
// - 取り直しの応答が、進行中のターンのここまでの途中経過(`turn_events`)を持っているときは、「ここまで」を決めるとき、
//   それを先頭に番号の順で返す(凍結・切り替えのあと、ターンの途中から表示を始められる)。
//
// 会話の切り替え・つなぎ直しのたびに `begin()` で最初からにする。「ここまで」は、その直後の最初の取り直し 1 回だけを使う
// (返答の最中に状態が変わるたびの取り直しで、まだ届いていない断片まで捨てないため)。

export type Merged<T> = { item: T; seq: number; missed: number };

const BUFFER_LIMIT = 1024;

export function createProgressMerger<T>() {
  // 「ここまで」が分かっているか(null = まだ)。
  let floor: number | null = null;
  // 最後に渡した番号。
  let last = 0;
  let buffer: { seq: number; item: T }[] = [];

  const take = (seq: number, item: T): Merged<T>[] => {
    if (seq <= last) return [];
    const missed = last > 0 && seq > last + 1 ? seq - last - 1 : 0;
    last = seq;
    return [{ item, seq, missed }];
  };

  return {
    /** 会話の切り替え・つなぎ直しのとき。最初から(「ここまで」が分かるまで、届いた分はためる)。 */
    begin() {
      floor = null;
      last = 0;
      buffer = [];
    },
    /** 途中経過 1 件が届いた。いま渡してよいものを、順に返す。 */
    push(seq: number, item: T): Merged<T>[] {
      if (floor === null) {
        if (buffer.length < BUFFER_LIMIT) buffer.push({ seq, item });
        return [];
      }
      return take(seq, item);
    },
    /** 「ここまで」がまだ分かっていないか(`begin` のあと、最初の `setFloor` の前)。 */
    awaitingFloor(): boolean {
      return floor === null;
    },
    /**
     * 取り直しの「ここまで」の番号。最初の 1 回だけ使う(`begin` のあと)。`replay`(進行中のターンのここまでの途中経過。
     * 番号が「ここまで」以下のもの)があれば、それを先頭に、番号の順に返す。そのあと、ためてあった分のうち、「ここまで」より
     * 後のものを、番号の順に返す。
     */
    setFloor(progressSeq: number, replay: { seq: number; item: T }[] = []): Merged<T>[] {
      if (floor !== null) return [];
      floor = progressSeq;
      last = 0;
      const replayed = [...replay]
        .filter((r) => r.seq <= progressSeq)
        .sort((a, b) => a.seq - b.seq)
        .flatMap((r) => take(r.seq, r.item));
      last = Math.max(last, progressSeq);
      const pending = buffer.sort((a, b) => a.seq - b.seq);
      buffer = [];
      return [...replayed, ...pending.flatMap((p) => take(p.seq, p.item))];
    },
  };
}
