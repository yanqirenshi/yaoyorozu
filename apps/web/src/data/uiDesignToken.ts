/**
 * デザインシステム「デザイントークン」の説明で使う構造化データ。
 *
 * トークンそのもの(値)は ui*.ts が持つ。ここが持つのは
 * 「トークンとは何か」を説明するための分類・対応表である。
 */

export type TokenLayer = {
  key: string;
  label: string;
  /** 他のデザインシステムでの別名。 */
  aliases: string;
  description: string;
  example: string;
  /** YAOYOROZU での該当。未整備なら空文字。 */
  inYaoyorozu: string;
};

export const TOKEN_LAYERS: TokenLayer[] = [
  {
    key: "primitive",
    label: "プリミティブ層",
    aliases: "グローバル / オプション / パレット",
    description:
      "値そのものに名前を付けただけの層。意味を持たず、どこで使うかも決めない。いわば在庫であり、ここに並んでいる値がそのまま画面に出るとは限らない。",
    example: "京紫-500 = #9d5b8b",
    inYaoyorozu: "COLOR_SCALES / SPACING_SCALE / CORNER_SCALE / ELEVATION_SCALE",
  },
  {
    key: "semantic",
    label: "セマンティック層",
    aliases: "役割 / 意思決定 / エイリアス",
    description:
      "「どういうときに使うか」で名前を付け、プリミティブ層を指す層。画面が参照してよいのはこの層だけとする。",
    example: "color.primary = 京紫-500 / border.default = 墨-200",
    inYaoyorozu:
      "KEY_COLORS / TEXT_COLORS / SURFACE_COLORS / FUNCTIONAL_COLORS / SEMANTIC_COLORS",
  },
  {
    key: "component",
    label: "コンポーネント層",
    aliases: "コンポーネント固有",
    description:
      "特定の部品専用に、さらに名前を付ける層。部品の数だけトークンが増えるため、同じ値を別々に変えたい理由が実際に生じるまでは作らない。",
    example: "button.background = color.primary",
    inYaoyorozu: "",
  },
];

export type TokenAnatomy = {
  item: string;
  example: string;
  note: string;
};

/** 1つのトークンが持つ要素。 */
export const TOKEN_ANATOMY: TokenAnatomy[] = [
  {
    item: "名前",
    example: "color.primary",
    note: "階層をドットで区切る。画面のコードに残るのはこの名前だけである。",
  },
  {
    item: "値",
    example: "#9d5b8b",
    note: "実際の値か、他のトークンへの参照。",
  },
  {
    item: "型",
    example: "color",
    note: "色・寸法・書体・時間など。型が同じものどうしだけが差し替えられる。",
  },
  {
    item: "用途",
    example: "選択状態、主要ボタン、アクティブなタブ。",
    note: "いつ使うか。これがないと、名前だけでは使い分けが伝わらない。",
  },
  {
    item: "制約",
    example: "真珠に対して 4.71:1",
    note: "満たしている条件。カラーであればコントラスト比。任意。",
  },
];

/** トークンにするもの・しないものの線引き。 */
export const TOKEN_SCOPE = {
  included: [
    "色(文字・面・境界・状態)",
    "余白(パディング・ギャップ)",
    "フォントサイズ・太さ・行高・字間",
    "角丸の半径",
    "影(高さレベル)",
    "境界線の太さ",
    "アイコンのサイズ",
    "ブレークポイント",
  ],
  excluded: [
    "「カードは横並びにし、狭い画面では縦積みにする」といったレイアウトの規則",
    "「エラーは色だけでなく必ず文言を伴わせる」といった運用ルール",
    "「見出しの上の余白は、下の余白より大きくする」といった値どうしの関係",
    "画面ごとの文言・ラベル",
  ],
};
