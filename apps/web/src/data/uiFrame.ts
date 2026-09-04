/**
 * コンポーネント「レイアウト > フレーム」の定義。
 *
 * フレームはページのトップレベルに置く骨格である。
 * 種類は先に設計せず、実装が増えた結果として汎化する方針を採る。
 */

export type FrameSizing = {
  item: string;
  value: string;
  note: string;
};

/** 寸法の規則。 */
export const FRAME_SIZING: FrameSizing[] = [
  {
    item: "幅",
    value: "100%",
    note: "親(body)の幅いっぱい。100vw は使わない。",
  },
  {
    item: "高さ",
    value: "ビューポートに固定",
    note: "html / body を 100% にし、フレームがその全部を占める。100vh は使わない。",
  },
  {
    item: "内側の配り方",
    value: "flex",
    note: "flex-col / flex-1 と min-h-0 で領域を配る。高さを計算しない。",
  },
  {
    item: "はみ出し",
    value: "overflow: hidden",
    note: "フレーム自身はスクロールしない。スクロールは内側の領域が持つ。",
  },
];

export type FrameAntipattern = {
  pattern: string;
  problem: string;
  instead: string;
};

/** 使わない書き方と、その理由。 */
export const FRAME_ANTIPATTERNS: FrameAntipattern[] = [
  {
    pattern: "width: 100vw",
    problem:
      "vw はスクロールバーの幅を含む。縦スクロールが出た瞬間に、その幅ぶんだけ横スクロールが生まれる。",
    instead: "width: 100%",
  },
  {
    pattern: "height: 100vh",
    problem:
      "モバイルブラウザの URL バーの伸縮に追随せず、画面下端が隠れる。",
    instead:
      "html / body を h-full にし、フレームを flex-1 で伸ばす(dvh を使う手もある)。",
  },
  {
    pattern: "子の高さを計測して calc(100% - Npx) する",
    problem:
      "計測 → 再レンダリングの順になるため1フレーム遅れ、初期表示とリサイズでちらつく。",
    instead:
      "flex-col の中で、固定部分は自動高、可変部分は flex-1 min-h-0 にする。",
  },
  {
    pattern: "position: absolute で領域を敷き詰める",
    problem:
      "内容の増減に追随せず、入れ子にすると座標の管理が破綻する。",
    instead: "flex または grid で配る。",
  },
];

export type FrameRule = {
  title: string;
  body: string;
};

export const FRAME_RULES: FrameRule[] = [
  {
    title: "構造だけを持つ",
    body: "フレームはデータを取得せず、業務状態も持たない。持ってよいのはナビゲーションの状態(現在のページ、メニューの開閉)までとする。",
  },
  {
    title: "1ページに1つ、入れ子にしない",
    body: "フレームはページのトップレベルに1つだけ置く。入れ子にすると高さの基準が二重になり、内側のスクロールが効かなくなる。",
  },
  {
    title: "領域は名前で受け取る",
    body: "領域が2つ以上あるフレームは、children ひとつではなく名前付きのスロット(nav / list / detail など)で受け取る。どこに何が入るかが呼び出し側から読めるようにする。",
  },
  {
    title: "区切りは1pxの罫線",
    body: "領域の区切りは border.default の1px罫線で表す。影や背景色の塗り分けを重ねない(基本デザイン「レイアウト」)。",
  },
  {
    title: "種類は汎化して増やす",
    body: "使いそうな型を先に用意しない。ページを実装した結果、同じ骨格が複数現れた時点で、そこからフレームとして切り出す。",
  },
];

export type FrameDefinition = {
  name: string;
  label: string;
  structure: string;
  usage: string;
};

/** 現在定義しているフレーム。 */
export const FRAMES: FrameDefinition[] = [
  {
    name: "Frame",
    label: "フレーム(無印)",
    structure: "幅100% / 高さビューポート固定 / 内側は flex",
    usage:
      "すべてのページの土台。領域の分割は行わず、内側の配り方はページ側に委ねる。",
  },
];
