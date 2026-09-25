import { Ring } from "loading-dev";

// ローディングアイコン(部品)。読み込み中であることを示す。仕様の正は apps/web の
// `src/data/uiLoading.ts`(説明は `/ui?item=part-loading`)で、ここには値を持たない
// (寸法は App.css の `.loading-icon*` が tokens.css の `--icon-*` を参照する)。
// 仕様を変えたいときは apps/native 側で値を変えず、デザイン (UI) に相談する。
//
// - 図形と動きは loading.dev(`loading-dev`)の **Ring だけ**を使う(27種のうち)。ほかの図形は
//   使わない。CSS をライブラリから書き写して自前で描かない(版を上げたときに食い違う)。
// - Ring が描く SVG は `aria-hidden` で、そのまま置くと支援技術には何も存在しないことに
//   なるので、必ず `role="status"` / `aria-live="polite"` / 名前を持つ要素で包む。
// - 色は指定しない(置いた場所の文字色を継ぐ)。Ring に `color` を渡すと継承が切れるので渡さない。
//   機能カラー(蘇芳など)も使わない(失敗していないのに失敗したように見える)。
// - 大きさは Ring の `size`(px の数値)を使わず、CSS の `--ld-size` を `--icon-*` トークンで
//   上書きする(App.css)。px の直書きを持たないため。
// - 導入: issue #393。適用先の画面は、必要になった時点で別に決める。

export type LoadingIconSize = "small" | "medium" | "large";

export type LoadingIconProps = {
  /** small = 行の中 / medium(既定)= 画面の一部 / large = 領域の全体(1画面に1つまで)。 */
  size?: LoadingIconSize;
  /** 何を読み込んでいるかを表す名前。省略時は「読み込み中」。 */
  label?: string;
  /**
   * 止める必要がある場面のためだけに渡す。通常は渡さない(回転は進行中であることを
   * 示す唯一の手がかり)。
   */
  playState?: "paused" | "running";
};

/** 1周にかける時間(ミリ秒)。仕様 `LOADING_VARIANT.durationMs`(Ring の既定値そのまま)。 */
const DURATION_MS = 800;

export default function LoadingIcon({
  size = "medium",
  label = "読み込み中",
  playState,
}: LoadingIconProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`loading-icon loading-icon-${size}`}
    >
      <Ring cap="round" easing="linear" duration={DURATION_MS} playState={playState} />
    </span>
  );
}
