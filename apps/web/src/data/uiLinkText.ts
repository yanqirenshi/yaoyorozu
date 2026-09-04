/**
 * 基本デザイン「リンクテキスト」の仕様。
 * 色は uiDesign.ts の FUNCTIONAL_COLORS(link.*)を参照する。
 */

import { tone } from "./uiDesign";

export type LinkState = {
  state: string;
  color: string;
  source: string;
  decoration: string;
  note: string;
};

/** リンクのステート。 */
export const LINK_STATES: LinkState[] = [
  {
    state: "通常(未訪問)",
    color: tone("京紫", 700),
    source: "京紫-700",
    decoration: "下線 1px",
    note: "地の色に対して 7.39:1。本文の墨-900 とも色相で区別できる。",
  },
  {
    state: "ホバー",
    color: tone("京紫", 800),
    source: "京紫-800",
    decoration: "下線 2px",
    note: "色を1段濃くし、下線を太くする。カーソルは pointer。",
  },
  {
    state: "アクティブ(押下中)",
    color: tone("京紫", 900),
    source: "京紫-900",
    decoration: "下線 2px",
    note: "押している間だけの状態。",
  },
  {
    state: "訪問済",
    color: tone("京紫", 900),
    source: "京紫-900",
    decoration: "下線 1px",
    note: "明度差のみでの区別になるため、下線は必ず維持する。",
  },
  {
    state: "フォーカス",
    color: tone("京紫", 700),
    source: "京紫-700 + 金茶-600",
    decoration: "下線 1px + フォーカスリング",
    note: "金茶-600 の 2px リングを 2px 離して描く。:focus-visible にのみ適用する。",
  },
];

/** リンクテキストの基本ルール。 */
export const LINK_RULES = [
  {
    title: "下線は外さない",
    body: "リンクを色だけで示すと、色の判別が難しい環境で本文と区別できない。本文中のリンクは常に下線を持つ。ナビゲーションやボタンのように、位置と形でリンクだと分かる箇所に限り下線を省略できる。",
  },
  {
    title: "リンク文言はリンク先を表す",
    body: "「こちら」「詳しくはこちら」のように、前後の文を読まないと行き先が分からない文言を使わない。リンク文言だけを抜き出しても目的地が分かる状態にする。",
  },
  {
    title: "同じ文言は同じ行き先へ",
    body: "画面内に同じリンク文言が複数あるとき、行き先は同じでなければならない。行き先が違うなら文言を変える。",
  },
  {
    title: "隣り合うリンクは離す",
    body: "リンクが連続する場合、クリック領域が重ならないよう最低 24px の高さと sp-2 の間隔を確保する。",
  },
  {
    title: "新しいタブで開くことを予告する",
    body: "target=\"_blank\" を使う場合は、外部リンクアイコンか「(新しいタブで開く)」の文言で、リンクを押す前に分かるようにする。rel=\"noopener\" を必ず付ける。",
  },
  {
    title: "ウェブページ以外は形式を書く",
    body: "PDF・ZIP など、ブラウザでの表示以外が起きるリンクは、文言に形式とファイルサイズを併記する。例: 仕様書(PDF / 2.1MB)",
  },
];

export type LinkKind = {
  kind: string;
  marker: string;
  example: string;
  note: string;
};

/** リンクの種類と表記。 */
export const LINK_KINDS: LinkKind[] = [
  {
    kind: "内部リンク(同一サービス内)",
    marker: "なし",
    example: "カラー",
    note: "Next.js の Link を使い、ページ遷移として扱う。",
  },
  {
    kind: "同一ページ内リンク(アンカー)",
    marker: "なし",
    example: "リンクのステート",
    note: "移動先には scroll-margin を確保し、見出しが画面上端に隠れないようにする。",
  },
  {
    kind: "外部リンク",
    marker: "外部リンクアイコン(icon-16)",
    example: "デジタル庁デザインシステム",
    note: 'target="_blank" rel="noopener"。アイコンは aria-hidden、文言側で「新しいタブで開く」を補う。',
  },
  {
    kind: "ファイルへのリンク",
    marker: "形式とサイズを併記",
    example: "リリース手順(PDF / 2.1MB)",
    note: "ダウンロードが始まる場合は download 属性を付ける。",
  },
];
