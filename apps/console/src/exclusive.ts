// 同じ操作の二重実行を止める(同じ瞬間の操作: クリック 2 回 + Enter など)。
//
// 実行中かどうかは **state ではなく、ここで持つ集合**(ref 相当)で見る。state は次の描画まで古いままなので、
// 同じ描画の前に続けて呼ばれた 2 回目・3 回目を止められない。実行中の同じ鍵の呼び出しは、`run` を動かさず
// `fallback` をすぐ返す。終わったら(成功・失敗どちらでも)鍵を外す。鍵が違う操作は、互いに止めない。

export type Exclusive = {
  run<T>(key: string, fallback: T, work: () => Promise<T>): Promise<T>;
  /** その鍵の操作が実行中か。 */
  has(key: string): boolean;
};

export function createExclusive(): Exclusive {
  const inFlight = new Set<string>();
  return {
    async run<T>(key: string, fallback: T, work: () => Promise<T>): Promise<T> {
      if (inFlight.has(key)) return fallback;
      inFlight.add(key);
      try {
        return await work();
      } finally {
        inFlight.delete(key);
      }
    },
    has: (key) => inFlight.has(key),
  };
}
