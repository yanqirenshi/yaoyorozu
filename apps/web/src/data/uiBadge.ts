/**
 * 部品「バッジ」の仕様。
 *
 * 対象がいまどの状態にあるかを、短い文字で示す部品。
 * 押せないこと(操作ではないこと)を形で示すため、境界を持たず塗りだけで描く
 * (ボタンは境界を持つ)。
 *
 * 色はセマンティックカラー(uiDesign.ts の SEMANTIC_COLORS)と同じ組み合わせを使う。
 * 状態の意味と色の対応を1か所で決めることが、この部品のいちばんの仕事である。
 */

export type BadgeTone = "idle" | "running" | "done" | "error";

export type BadgeToneSpec = {
  key: BadgeTone;
  label: string;
  /** 文字。 */
  fg: string;
  /** 背景。 */
  bg: string;
  /** どういう意味のときに使うか。 */
  meaning: string;
  /** apps/native での例。 */
  examples: string;
  /** 文字と背景のコントラスト比。 */
  contrast: string;
};

/**
 * 状態の種類と色の対応。
 * 迷ったら idle にする。色を増やすほど、色そのものの意味が薄れる。
 */
export const BADGE_TONES: BadgeToneSpec[] = [
  {
    key: "idle",
    label: "待機",
    fg: "text.secondary",
    bg: "墨-100",
    meaning:
      "まだ始まっていない、または終わって落ち着いている状態。良し悪しを持たない。",
    examples: "未起動、停止中、下書き。",
    contrast: "5.71:1",
  },
  {
    key: "running",
    label: "進行中",
    fg: "金茶-800",
    bg: "金茶-100",
    meaning:
      "いま動いている、または人の操作を待っている状態。画面の中で目を引かせたい状態。",
    examples: "起動中、実行中、権限待ち、保存中。",
    contrast: "6.41:1",
  },
  {
    key: "done",
    label: "完了",
    fg: "草色-800",
    bg: "草色-100",
    meaning: "意図したとおりに終わった状態。",
    examples: "完了、成功、検証通過。",
    contrast: "6.03:1",
  },
  {
    key: "error",
    label: "失敗",
    fg: "蘇芳-700",
    bg: "蘇芳-100",
    meaning: "意図したとおりに終わらなかった状態。人が何かを判断する必要がある。",
    examples: "失敗、異常終了、接続できない。",
    contrast: "7.01:1",
  },
];

export type BadgeSize = "small" | "medium";

export type BadgeSizeSpec = {
  key: BadgeSize;
  /** 高さ(CSS px)。 */
  heightPx: number;
  /** 左右のパディング(余白トークン)。 */
  paddingX: string;
  /** ラベルのテキストスタイル。 */
  textStyle: string;
  usage: string;
};

export const BADGE_SIZES: BadgeSizeSpec[] = [
  {
    key: "small",
    heightPx: 20,
    paddingX: "sp-2",
    textStyle: "UI-14N-100",
    usage:
      "一覧の行、ツールバー、文章の行の中。高さ 20px は行内アイコン(16px)と並べても行が膨らまない。",
  },
  {
    key: "medium",
    heightPx: 24,
    paddingX: "sp-2",
    textStyle: "UI-14N-100",
    usage:
      "既定値。パネルのヘッダ、カードの見出しの横など、周囲に余裕がある箇所。",
  },
];

/** 形。すべてのトーン・サイズで共通。 */
export const BADGE_SHAPE = {
  radius: "radius-4",
  border: "なし",
  note: "境界を持たず塗りだけで描く。境界を持つボタンと形で区別でき、押せないことが伝わる。角丸はボタン・タブと同じ radius-4 にそろえ、丸ピルにはしない。",
};

export type BadgeAnatomyPart = {
  no: number;
  name: string;
  description: string;
};

export const BADGE_ANATOMY: BadgeAnatomyPart[] = [
  {
    no: 1,
    name: "面",
    description:
      "トーンごとの背景。高さと左右のパディングを持ち、境界は持たない。",
  },
  {
    no: 2,
    name: "ラベル",
    description:
      "状態を表す短い名詞。アイコンは付けず、文字だけで状態を伝える。1行に収める。",
  },
];

export const BADGE_RULES = [
  {
    title: "状態を色だけで示さない",
    body: "バッジは必ず文字を持つ。色の点だけ、色の丸だけで状態を示さない。色の判別が難しい環境では、何も示していないのと同じになる。",
  },
  {
    title: "トーンは意味で選ぶ",
    body: "色の見た目で選ばず、上の表の意味で選ぶ。「実行中」を完了の色(草色)にすると、同じ色が画面によって違う意味を持ってしまう。迷ったら待機(墨)にする。",
  },
  {
    title: "ラベルは短い名詞にする",
    body: "「実行中」「権限待ち」のように、状態を表す短い名詞にする。文を入れない。長くなるなら、バッジではなく本文で書く。",
  },
  {
    title: "1つの対象に1つ",
    body: "同じ対象に複数のバッジを並べない。状態が複数あるように見える。示したいことが複数あるなら、どれが主かを決めて1つにする。",
  },
  {
    title: "操作はバッジにしない",
    body: "バッジは押せない。押して何かが起きるものはボタンにする。バッジが境界を持たないのは、境界を持つボタンと形で区別するためである。",
  },
  {
    title: "状態が変わったことを伝える",
    body: "画面を見ていなくても状態の変化が分かるよう、バッジを含む領域に role=\"status\" を持たせるか、変化を別途知らせる。色が変わっただけでは、支援技術に何も伝わらない。",
  },
];

export const BADGE_ANTIPATTERNS = [
  {
    pattern: "色の点だけで状態を示す",
    problem: "色の判別が難しい環境では、何も示していないのと同じになる。",
    instead: "文字のラベルを必ず持たせる。",
  },
  {
    pattern: "バッジを押せるようにする",
    problem:
      "押せるものと押せないものが同じ見た目になり、画面全体で何が操作なのか読めなくなる。",
    instead: "操作はボタンにする(部品「ボタン」)。",
  },
  {
    pattern: "見た目の好みでトーンを選ぶ",
    problem:
      "同じ色が画面によって違う意味を持ち、色から状態を読み取れなくなる。",
    instead: "上の表の意味で選ぶ。当てはまらないなら待機(墨)にする。",
  },
  {
    pattern: "バッジに文を入れる",
    problem:
      "幅が伸びて一覧の並びが崩れ、それでも読みきれない。",
    instead: "短い名詞にし、詳しいことは本文に書く。",
  },
];
