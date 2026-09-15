/**
 * 画面のワイヤーフレーム(d3.wireframe で描く)。サイトマップのサイトごとに
 * `<サイトの id>.ts` を置き、下の WIREFRAMES に登録する。サイトの詳細ページ
 * (/sitemap/sites/:id)に描く。
 *
 * データは画面から取り出す(scripts/wireframe/extract-web.js)。取り出すのは画面の
 * 大きな区切り(ナビゲーション・メイン・メニュー・タブ・図の領域)まで。色や文字の
 * 大きさは持たず、描くときに基本デザインから付ける。形は d3.wireframe の入力そのもの
 * ではなく、描くときに変換する(ライブラリの形が変わってもデータを書き直さないため)。
 */

import deploymentDiagram from "./20";

/** d3.wireframe 0.1.1 が描ける要素。README にある tabs・table・input 等は未実装。 */
export type WireframeElementType =
  | "frame"
  | "image"
  | "button"
  | "modal"
  | "dialog";

export type WireframeElement = {
  type: WireframeElementType;
  /** 要素の中に書く文字。 */
  label?: string;
  /** 位置と大きさ(px)。位置は親からの相対(最上位はページの左上から)。 */
  rect: { x: number; y: number; w: number; h: number };
  children?: WireframeElement[];
};

export type Wireframe = {
  /** サイトマップのサイトの id(src/data/sitemap.ts)。 */
  siteId: number;
  /** 取り出したときの画面。 */
  source: {
    path: string;
    viewport: { w: number; h: number };
    /** 取り出した日(YYYY-MM-DD)。 */
    capturedAt: string;
  };
  elements: WireframeElement[];
};

/** サイトの id → ワイヤーフレーム。 */
export const WIREFRAMES: Record<number, Wireframe> = Object.fromEntries(
  [deploymentDiagram].map((wireframe) => [wireframe.siteId, wireframe]),
);

export function findWireframe(siteId: number): Wireframe | undefined {
  return WIREFRAMES[siteId];
}
