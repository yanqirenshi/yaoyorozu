/**
 * 部品「ボタン」の仕様。
 *
 * 寸法・色はすべて基本デザインのトークン名で持つ。値ではなく名前で持つことで、
 * apps/web(MUI)と apps/native(素の CSS + tokens.css)の両方が同じ仕様から実装できる。
 * 色の参照は resolveColor()(uiDesign.ts)で値と CSS 変数名に解決する。
 */

export type ButtonSize = "small" | "medium" | "large";

export type ButtonSizeSpec = {
  key: ButtonSize;
  label: string;
  /** 高さ(CSS px)。 */
  heightPx: number;
  /** 左右のパディング(余白トークン)。 */
  paddingX: string;
  /** ラベルのテキストスタイル。 */
  textStyle: string;
  /** 角の形状(角丸トークン)。 */
  radius: string;
  usage: string;
};

export const BUTTON_SIZES: ButtonSizeSpec[] = [
  {
    key: "small",
    label: "small",
    heightPx: 32,
    paddingX: "sp-3",
    textStyle: "UI-14M-100",
    radius: "radius-4",
    usage:
      "表の行、ツールバー、カードの隅など、領域に制約がある箇所。WCAG 2.2 の操作対象サイズ(24px 以上)は満たす。",
  },
  {
    key: "medium",
    label: "medium",
    heightPx: 40,
    paddingX: "sp-4",
    textStyle: "UI-16M-100",
    radius: "radius-4",
    usage: "既定値。フォームの送信、パネルのヘッダ、ダイアログの操作。",
  },
  {
    key: "large",
    label: "large",
    heightPx: 48,
    paddingX: "sp-6",
    textStyle: "UI-18M-100",
    radius: "radius-4",
    usage:
      "空状態の中央など、画面の主要な操作を1つだけ目立たせたい箇所。1画面に1つまで。",
  },
];

/**
 * 幅の決め方。すべてのサイズ・種類で共通。
 * fit-content にしておくと、縦並びの flex(align-items: stretch)の中に置いても
 * 横に伸びない。置き場所ごとに左寄せの指定を足す必要がなくなる。
 */
export const BUTTON_WIDTH = {
  value: "fit-content",
  note: "幅はラベルの文字に合わせる。親の幅に合わせて横いっぱいに伸ばさない。",
};

export type ButtonState = "default" | "hover" | "active" | "disabled";

export type ButtonColors = {
  /** 背景。 */
  bg: string;
  /** 文字。 */
  fg: string;
  /** 境界。 */
  border: string;
};

export type ButtonKind = "add" | "save" | "edit";

/**
 * 塗りのボタンの配色。追加ボタンと保存ボタンで共通。
 * 「見た目を同じにする」ことが仕様なので、片方だけが変わらないよう定義を1つにしている。
 * 将来どちらかを変える必要が出たときは、ここを分けてから変える。
 *
 * 文字は白、陰なし(2026-09-23 決定)。見た目を優先した判断であり、
 * 通常の状態はコントラストの基準を満たさない(下の FILLED_CONTRAST を参照)。
 * 文字が白いので、ホバー・押下中は背景を暗くする方向に変える。
 * 押すほど文字が読みやすくなり、一般的な「押すと濃くなる」向きとも一致する。
 */
const FILLED_COLORS: Record<ButtonState, ButtonColors> = {
  default: { bg: "金茶-500", fg: "text.inverse", border: "金茶-500" },
  hover: { bg: "金茶-600", fg: "text.inverse", border: "金茶-600" },
  active: { bg: "金茶-700", fg: "text.inverse", border: "金茶-700" },
  disabled: {
    bg: "state.disabled",
    fg: "text.disabled",
    border: "state.disabled",
  },
};

const FILLED_CONTRAST =
  "白の文字は 金茶-500 に対して 2.61:1 で、本文の基準(4.5:1)も大きな文字・UI の基準(3:1)も満たさない。色味を優先して採用している(2026-09-23 決定)。ホバーの 金茶-600 は 3.27:1、押下中の 金茶-700 は 4.89:1 で、押すほど読みやすくなる。";

export type ButtonKindSpec = {
  key: ButtonKind;
  label: string;
  /** コンポーネント名。 */
  component: string;
  /** 既定のラベル。 */
  defaultLabel: string;
  /** 強調の度合い。 */
  emphasis: "filled" | "outlined";
  usage: string;
  colors: Record<ButtonState, ButtonColors>;
  /** 文字の読みやすさ(コントラスト比と、基準を満たすかどうか)。 */
  contrast: string;
};

/**
 * ボタンの種類。
 * 追加・保存は画面の主要な操作として塗り、変更は既存の対象への副次的な操作として線で描く。
 * 強調の差で「今この画面で一番押されるべきもの」を示す。
 */
export const BUTTON_KINDS: ButtonKindSpec[] = [
  {
    key: "add",
    label: "追加ボタン",
    component: "AddButton",
    defaultLabel: "追加",
    emphasis: "filled",
    usage:
      "新しい対象を作る操作。一覧の上部やパネルのヘッダに置き、その画面の主要な操作として扱う。",
    colors: FILLED_COLORS,
    contrast: FILLED_CONTRAST,
  },
  {
    key: "save",
    label: "保存ボタン",
    component: "SaveButton",
    defaultLabel: "保存",
    emphasis: "filled",
    usage:
      "編集した内容を確定する操作。フォームやエディタの下部に置き、その領域の主要な操作として扱う。見た目は追加ボタンと同じで、違いはラベルだけである。",
    colors: FILLED_COLORS,
    contrast: FILLED_CONTRAST,
  },
  {
    key: "edit",
    label: "変更ボタン",
    component: "EditButton",
    defaultLabel: "変更",
    emphasis: "outlined",
    usage:
      "既存の対象の内容を変える操作。対象の近く(行の末尾、詳細の見出しの横)に置く。追加ボタンより目立たせない。",
    colors: {
      // 金茶-500 の境界は 2.52:1 で境界の基準(3:1)に届かないため、1段濃い 金茶-600 にする。
      // 文字は色味を優先して金茶-500 とする(基準は満たさない。下の contrast を参照)。
      default: { bg: "surface.raised", fg: "金茶-500", border: "金茶-600" },
      hover: { bg: "金茶-50", fg: "金茶-500", border: "金茶-700" },
      active: { bg: "金茶-100", fg: "金茶-500", border: "金茶-800" },
      disabled: {
        bg: "surface.raised",
        fg: "text.disabled",
        border: "border.default",
      },
    },
    contrast:
      "金茶-500 の文字は白の背景に対して 2.61:1 で、本文の基準(4.5:1)を満たさない。色味を優先して採用している(2026-09-21 決定)。境界は真珠に対して 3.15:1 以上で、境界の基準(3:1)は満たす。",
  },
];

/** フォーカスの表示。すべての種類で共通。 */
export const BUTTON_FOCUS = {
  color: "focus.ring",
  width: "2px",
  offset: "2px",
  note: "キーボード操作のときだけ表示する(:focus-visible)。ポインタで押したときには出さない。",
};

export type ButtonAnatomyPart = {
  no: number;
  name: string;
  description: string;
};

/** ボタンの部位。 */
export const BUTTON_ANATOMY: ButtonAnatomyPart[] = [
  {
    no: 1,
    name: "コンテナ",
    description:
      "クリック領域そのもの。背景・境界・角丸・高さを持つ。見た目の大きさ = クリック領域とする。",
  },
  {
    no: 2,
    name: "ラベル",
    description:
      "操作の内容を表す文言。アイコンは付けず、文字だけで操作を伝える。",
  },
];

/** ボタンの運用ルール。 */
export const BUTTON_RULES = [
  {
    title: "ラベルだけで構成する",
    body: "追加・保存・変更のボタンはアイコンを付けず、文字だけで操作を伝える。何を追加するかが周囲から分からない場合は「プロファイルを追加」のように対象を書く。",
  },
  {
    title: "塗りのボタンは1つの領域に1つ",
    body: "塗りのボタン(追加・保存)は、その領域で最も押されるべき操作を示す。同じ領域に塗りのボタンを並べると、どれが主要な操作か読み取れなくなる。",
  },
  {
    title: "追加と保存はラベルで区別する",
    body: "新しい対象を作るときは追加、すでにある対象の編集内容を確定するときは保存とする。見た目は同じなので、区別はラベルが担う。どちらの操作かは、置き場所(一覧の上か、編集領域の下か)からも読み取れるようにする。",
  },
  {
    title: "幅は文字に合わせる",
    body: "ボタンの幅はラベルの文字に合わせ(width: fit-content)、置き場所の幅に合わせて伸ばさない。縦並びのレイアウトの中でも、横いっぱいのボタンにはしない。",
  },
  {
    title: "サイズは領域で選ぶ",
    body: "既定は medium。表やツールバーなど高密度な領域だけ small、画面の主要な操作を1つ目立たせる場合だけ large を使う。同じ並びの中でサイズを混ぜない。",
  },
  {
    title: "押せないことは状態で示す",
    body: "操作できないときは disabled にする。ボタンを消すと、その操作が存在すること自体が伝わらなくなる。ただし権限がなく今後も押せない操作は、表示しない。",
  },
  {
    title: "ボタンはボタン要素で作る",
    body: "<button type=\"button\"> で実装する。<div> に onClick を付けたものはキーボードで操作できない。画面遷移するものはボタンではなくリンクにする(基本デザイン「リンクテキスト」)。",
  },
];

/** 使わない書き方。 */
export const BUTTON_ANTIPATTERNS = [
  {
    pattern: "記号だけのボタン(+ や ✎ のみ)",
    problem: "何をするボタンかが伝わらない。支援技術では名前のないボタンになる。",
    instead: "文字のラベルにする。場所が狭いときは size: small にする。",
  },
  {
    pattern: "横幅いっぱいに伸びたボタン",
    problem:
      "画面ごとにボタンの大きさが変わり、同じ操作が同じ見た目に見えなくなる。縦並びの flex に置くと、既定(align-items: stretch)でこうなる。",
    instead:
      "部品側で width: fit-content を持たせる。置き場所ごとに左寄せの指定を足して回避しない。",
  },
  {
    pattern: "変更ボタンを塗りにする",
    problem: "追加ボタンと強調が同じになり、主要な操作が分からなくなる。",
    instead: "変更は線(outlined)のまま使う。",
  },
  {
    pattern: "disabled を色だけで表す",
    problem: "押せるのか押せないのかが、色の判別が難しい環境で分からない。",
    instead: "disabled 属性を付ける(カーソルと支援技術にも伝わる)。",
  },
  {
    pattern: "フォーカスリングを消す(outline: none)",
    problem: "キーボードで操作している人が、今どこにいるか分からなくなる。",
    instead: ":focus-visible のときだけ表示する。",
  },
];
