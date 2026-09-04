/**
 * 基本デザイン「レイアウト」のトークン。
 *
 * ブレークポイントは Tailwind v4 の既定値をそのまま採用し、
 * 独自の値を持たない(クラス名と定義が食い違う状態を作らない)。
 */

export type Breakpoint = {
  token: string;
  minPx: number;
  label: string;
  usage: string;
};

export const BREAKPOINTS: Breakpoint[] = [
  {
    token: "(既定)",
    minPx: 0,
    label: "狭幅",
    usage:
      "768px 未満。左メニューは折りたたみ、ペインは1つだけ表示する。外マージンは sp-4。",
  },
  {
    token: "md",
    minPx: 768,
    label: "標準",
    usage:
      "768px 以上。左メニュー(256px)+ 本体の2ペイン。外マージンは sp-6。",
  },
  {
    token: "lg",
    minPx: 1024,
    label: "広幅",
    usage: "1024px 以上。一覧 + 詳細の3ペイン構成が可能になる。",
  },
  {
    token: "xl",
    minPx: 1280,
    label: "最大",
    usage:
      "1280px 以上。読み物領域は最大幅で頭打ちにし、余った幅は図表の描画領域に割り当てる。",
  },
];

export type GridSpec = {
  item: string;
  value: string;
  note: string;
};

/** グリッドシステム。 */
export const GRID_SPEC: GridSpec[] = [
  { item: "カラム数", value: "12", note: "1 / 2 / 3 / 4 / 6 分割に割り切れる。" },
  { item: "ガター", value: "24px (sp-6)", note: "狭幅では 16px (sp-4)。" },
  { item: "外マージン", value: "24px (sp-6)", note: "狭幅では 16px (sp-4)。" },
  {
    item: "カラム幅",
    value: "可変",
    note: "固定幅は持たせず、領域の残り幅を12等分する。",
  },
];

export type ContentWidth = {
  token: string;
  maxWidthPx: number | null;
  label: string;
  usage: string;
};

/** コンテンツの最大幅。 */
export const CONTENT_WIDTHS: ContentWidth[] = [
  {
    token: "width.prose",
    maxWidthPx: 720,
    label: "読み物",
    usage:
      "本文中心のページ。1行が全角40〜50文字を超えると、行の折り返しで視線が迷う。",
  },
  {
    token: "width.doc",
    maxWidthPx: 1080,
    label: "ドキュメント",
    usage: "本文に表・コード・図を含むページ。/ui の各ページはこれを使う。",
  },
  {
    token: "width.full",
    maxWidthPx: null,
    label: "全幅",
    usage:
      "図表・グラフ・一覧。描画領域が広いほど情報が読み取りやすくなるものは制限しない。",
  },
];

export type ShellMetric = {
  item: string;
  value: string;
  note: string;
};

/** アプリシェルの寸法。apps/web と apps/native で共通の骨格とする。 */
export const SHELL_METRICS: ShellMetric[] = [
  {
    item: "左メニュー幅",
    value: "256px",
    note: "固定。狭幅ではドロワーとして重ねて表示する。",
  },
  {
    item: "二次ナビ(/ui のコンポーネント一覧など)幅",
    value: "256px",
    note: "固定。左メニューと同じ幅にして縦のリズムを揃える。",
  },
  { item: "ペインの区切り", value: "1px の罫線(border.default)", note: "影は使わない。" },
  { item: "タブ列の高さ", value: "48px", note: "タブのラベルは UI-16M-100。" },
  { item: "一覧の行の高さ", value: "40px", note: "高密度な一覧では 32px。" },
  { item: "操作要素の最小高さ", value: "40px", note: "クリック領域として確保する。" },
];

export type PaneLayout = {
  key: string;
  label: string;
  structure: string;
  usage: string;
};

/** ペイン構成のパターン。 */
export const PANE_LAYOUTS: PaneLayout[] = [
  {
    key: "one",
    label: "1ペイン",
    structure: "本体のみ",
    usage: "単一の対象を読む・編集する画面。狭幅時の既定形。",
  },
  {
    key: "two",
    label: "2ペイン(ナビ + 本体)",
    structure: "256px | 可変",
    usage:
      "対象を選んで内容を見る画面。/wbs、/class-diagram など Web の各画面はこの形。",
  },
  {
    key: "three",
    label: "3ペイン(ナビ + 一覧 + 詳細)",
    structure: "256px | 256〜320px | 可変",
    usage:
      "対象が2段階に分かれる画面。/ui(メニュー + コンポーネント一覧 + 内容)や、ネイティブアプリのセッションビューアがこの形。",
  },
];

/** レイアウトの運用ルール。 */
export const LAYOUT_RULES = [
  {
    title: "縦のスクロールはペイン単位",
    body: "ページ全体をスクロールさせず、各ペインが自分の内側でスクロールする。ナビゲーションは常に見える位置に留まり、現在地を見失わない。",
  },
  {
    title: "横スクロールを作らない",
    body: "ページ本体に横スクロールを発生させない。表・コード・図など幅が収まらないものは、その要素自身を overflow-x: auto の器に入れる。",
  },
  {
    title: "領域の区切りは罫線",
    body: "ペインの区切りは 1px の罫線で表す。影や背景色の塗り分けを重ねると、情報密度の高い画面がうるさくなる。",
  },
  {
    title: "幅は用途で決める",
    body: "読み物は width.prose、表や図を含む文書は width.doc、図表そのものは width.full。同じページ内で用途が変わるときは、ブロック単位で幅を変える。",
  },
  {
    title: "状態は URL に持たせる",
    body: "どのペインで何を選んでいるかは URL クエリ(?tab= / ?item=)で表す。リンクを共有すれば同じ画面が再現できる状態を保つ。",
  },
];
