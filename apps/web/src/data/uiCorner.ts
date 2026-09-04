/**
 * 基本デザイン「角の形状」のトークン。
 *
 * 角丸は5段階 + 完全な円弧(full)。要素の面積が大きいほど半径を大きくし、
 * 見た目のまるみの印象を一定に保つ。
 */

export type CornerToken = {
  token: string;
  /** 角丸半径(CSS px)。full は 9999。 */
  px: number;
  label: string;
  tailwind: string;
  usage: string;
};

export const CORNER_SCALE: CornerToken[] = [
  {
    token: "radius-0",
    px: 0,
    label: "角(かど)",
    tailwind: "rounded-none",
    usage:
      "表・ペイン・アプリシェルなど、面が隙間なく接する構造。罫線で区切る領域は角丸にしない。",
  },
  {
    token: "radius-2",
    px: 2,
    label: "極小",
    tailwind: "rounded-xs",
    usage: "チェックボックス、タグ、16〜20px 程度の小さな要素。",
  },
  {
    token: "radius-4",
    px: 4,
    label: "小",
    tailwind: "rounded",
    usage: "ボタン、入力欄、メニュー項目。高さ 32〜40px の操作要素の既定値。",
  },
  {
    token: "radius-8",
    px: 8,
    label: "中",
    tailwind: "rounded-lg",
    usage: "カード、パネル、ポップオーバー。面としてまとまりを持つ領域の既定値。",
  },
  {
    token: "radius-12",
    px: 12,
    label: "大",
    tailwind: "rounded-xl",
    usage: "ダイアログ、シート、画面いっぱいに近い大きな面。",
  },
  {
    token: "radius-full",
    px: 9999,
    label: "完全",
    tailwind: "rounded-full",
    usage: "アバター、ステータスドット、ピル型のバッジ・トグル。",
  },
];

/** 角の形状の運用ルール。 */
export const CORNER_RULES = [
  {
    title: "面積に比例させる",
    body: "同じ半径でも、小さい図形ほど丸く、大きい図形ほど角ばって見える。40px のボタンに radius-4、160px のカードに radius-8、560px のダイアログに radius-12 を割り当てると、視覚的なまるみの印象がそろう。",
  },
  {
    title: "入れ子は外側 > 内側にする",
    body: "パネル(radius-8)の内側にボタン(radius-4)を置くように、内側の半径は外側より小さくする。内側の余白が p のとき、内側の半径は「外側の半径 - p」を上限とする。逆転すると角の内側に隙間が見えて雑に見える。",
  },
  {
    title: "角丸は強調の手段になる",
    body: "同じ並びの中で1つだけ半径を変えると、その要素が浮いて見える。強調のために使ってよいが、意味を色だけ・形だけに持たせない。",
  },
  {
    title: "部分角丸は接合を表す",
    body: "タブとパネル、ボタングループのように面が接続している箇所は、接続側の角を radius-0 にし、外側の角だけを丸める。",
  },
  {
    title: "1画面で使う段階は3つまで",
    body: "操作要素(radius-4)、面(radius-8)、ピル(radius-full)の3段階で足りる。段階を増やすほど、まるみが意味を持たなくなる。",
  },
];

/** 部分角丸の代表的な適用例。 */
export type PartialCornerExample = {
  target: string;
  value: string;
  note: string;
};

export const PARTIAL_CORNER_EXAMPLES: PartialCornerExample[] = [
  {
    target: "選択中のタブ(上に接続)",
    value: "8px 8px 0 0",
    note: "パネルと接する下側は角にする。",
  },
  {
    target: "ボタングループの左端",
    value: "4px 0 0 4px",
    note: "隣と接する側は角にする。",
  },
  {
    target: "ボタングループの右端",
    value: "0 4px 4px 0",
    note: "",
  },
  {
    target: "画面下から出るシート",
    value: "12px 12px 0 0",
    note: "画面端に接する側は角にする。",
  },
];
