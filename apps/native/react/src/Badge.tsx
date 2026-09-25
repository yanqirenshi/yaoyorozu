// バッジ(部品)。対象がいまどの状態にあるかを短い文字で示す。仕様の正は apps/web の
// `src/data/uiBadge.ts`(説明は `/ui?item=part-badge`)で、ここには値を持たない
// (見た目は App.css の `.badge*` が tokens.css を参照する)。仕様を変えたいときは
// apps/native 側で値を変えず、デザイン (UI) に相談する。
//
// - 押せない要素なので `<button>` にしない。操作は別にボタンで置く。
// - **境界を持たない**(塗りだけ。境界を持つボタンと形で区別する)。
// - トーンは**意味で選ぶ**(見た目で選ばない): idle = まだ始まっていない・終わって落ち着いている /
//   running = いま動いている・人の操作を待っている / done = 意図どおり終わった /
//   error = 意図どおり終わらなかった。迷ったら idle。既定値は無く、必ず指定する。
// - ラベルは短い名詞(文を入れない)。色だけで状態を示さないため、必ず文字を持つ。
// - 状態が変わったことは、バッジを含む領域に `role="status"` を持たせて伝える(呼び出し側の責務。
//   バッジ自体は役割を持たない。一覧に並べるときに、行ごとに読み上げないため)。
// - 導入: issue #411。

export type BadgeTone = "idle" | "running" | "done" | "error";
export type BadgeSize = "small" | "medium";

export type BadgeProps = {
  /** 状態の種類。意味で選ぶ。 */
  tone: BadgeTone;
  /** 状態を表す短い名詞。 */
  label: string;
  /** small = 一覧の行・ツールバー・文章の行の中 / medium(既定)= 周囲に余裕がある箇所。 */
  size?: BadgeSize;
};

export default function Badge({ tone, label, size = "medium" }: BadgeProps) {
  return <span className={`badge badge-${tone} badge-${size}`}>{label}</span>;
}
