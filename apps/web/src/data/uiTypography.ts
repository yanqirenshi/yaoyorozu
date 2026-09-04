/**
 * 基本デザイン「タイポグラフィ」のトークン。
 *
 * テキストスタイル名は <カテゴリ>-<大きさ><太さレベル>-<行高> で構成する。
 * 例: Body-16N-170 = 本文カテゴリ / 16px / Normal / 行高170%
 */

export type FontFamily = {
  token: string;
  label: string;
  /** CSS の font-family 値。Next.js の next/font 変数を先頭に置く。 */
  stack: string;
  usage: string;
};

export const FONT_FAMILIES: FontFamily[] = [
  {
    token: "font.sans",
    label: "サンセリフ(既定)",
    stack:
      'var(--font-geist-sans), "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif',
    usage:
      "画面のほぼすべて。欧文は Geist、和文は OS 標準の日本語ゴシックにフォールバックする。",
  },
  {
    token: "font.mono",
    label: "等幅",
    stack:
      "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    usage:
      "コード、JSON、パス、ID、ログ。桁を揃えたい数値の一覧にも使う。",
  },
];

export type FontWeight = {
  /** 太さレベル。テキストスタイル名に使う記号。 */
  level: "N" | "M" | "B";
  value: number;
  label: string;
  usage: string;
};

export const FONT_WEIGHTS: FontWeight[] = [
  { level: "N", value: 400, label: "Normal", usage: "本文、通常の文章。" },
  {
    level: "M",
    value: 500,
    label: "Medium",
    usage: "メニュー項目・タブ・ボタンのラベル。太字ほど強くないが地の文と区別したい UI 文言。",
  },
  {
    level: "B",
    value: 700,
    label: "Bold",
    usage: "見出し、強調。文中の一部強調は原則ここまで(それ以上の太さは使わない)。",
  },
];

export type FontSize = {
  px: number;
  usage: string;
};

/**
 * 使用する文字サイズ。
 * 本文・UI の基準は 16px、下限は 14px とし、14px 未満は使わない。
 */
export const FONT_SIZES: FontSize[] = [
  { px: 32, usage: "画面タイトル。1画面に1つまで。" },
  { px: 28, usage: "大見出し。ドキュメントの章題。" },
  { px: 24, usage: "見出し(第1階層)。" },
  { px: 20, usage: "見出し(第2階層)。" },
  { px: 18, usage: "見出し(第3階層)、リード文。" },
  { px: 16, usage: "本文・UI の基準サイズ。" },
  {
    px: 14,
    usage:
      "一覧表・メタ情報・補助ラベルなど、領域の制約がある場合にのみ使う下限サイズ。",
  },
];

export type LineHeight = {
  value: string;
  usage: string;
};

export const LINE_HEIGHTS: LineHeight[] = [
  { value: "100%", usage: "ボタン・タブなど、1行で折り返さない UI テキスト。" },
  { value: "140%", usage: "大きな文字の見出し。" },
  { value: "150%", usage: "見出し、密度を優先する一覧・表。" },
  { value: "170%", usage: "読み物としての本文。既定値。" },
];

export type TextStyle = {
  /** テキストスタイル名。 */
  name: string;
  sizePx: number;
  weight: "N" | "M" | "B";
  lineHeight: string;
  /** 文字間隔(letter-spacing)。 */
  tracking: string;
  usage: string;
};

export type TextStyleGroup = {
  key: string;
  label: string;
  description: string;
  styles: TextStyle[];
};

export const TEXT_STYLE_GROUPS: TextStyleGroup[] = [
  {
    key: "display",
    label: "Display(Disp)",
    description:
      "画面の顔となる大きな文字。ページの最上部にひとつ置く想定で、本文中では使わない。",
    styles: [
      {
        name: "Disp-32B-140",
        sizePx: 32,
        weight: "B",
        lineHeight: "140%",
        tracking: "0",
        usage: "画面タイトル(/ui の項目名など)。",
      },
      {
        name: "Disp-28B-140",
        sizePx: 28,
        weight: "B",
        lineHeight: "140%",
        tracking: "0",
        usage: "狭い画面幅での画面タイトル。",
      },
    ],
  },
  {
    key: "heading",
    label: "Heading(Head)",
    description:
      "文書構造の見出し。h2〜h4 に対応し、階層が下がるごとにサイズを1段ずつ落とす。",
    styles: [
      {
        name: "Head-24B-150",
        sizePx: 24,
        weight: "B",
        lineHeight: "150%",
        tracking: "0.01em",
        usage: "第1階層の見出し(h2)。",
      },
      {
        name: "Head-20B-150",
        sizePx: 20,
        weight: "B",
        lineHeight: "150%",
        tracking: "0.02em",
        usage: "第2階層の見出し(h3)。",
      },
      {
        name: "Head-18B-150",
        sizePx: 18,
        weight: "B",
        lineHeight: "150%",
        tracking: "0.02em",
        usage: "第3階層の見出し(h4)。",
      },
      {
        name: "Head-16B-150",
        sizePx: 16,
        weight: "B",
        lineHeight: "150%",
        tracking: "0.02em",
        usage: "第4階層の見出し、パネルのタイトル。",
      },
    ],
  },
  {
    key: "body",
    label: "Body",
    description: "読ませる文章。既定は Body-16N-170。",
    styles: [
      {
        name: "Body-16N-170",
        sizePx: 16,
        weight: "N",
        lineHeight: "170%",
        tracking: "0.02em",
        usage: "本文の既定スタイル。",
      },
      {
        name: "Body-16B-170",
        sizePx: 16,
        weight: "B",
        lineHeight: "170%",
        tracking: "0.02em",
        usage: "本文中の強調。",
      },
      {
        name: "Body-14N-170",
        sizePx: 14,
        weight: "N",
        lineHeight: "170%",
        tracking: "0.02em",
        usage: "注釈、キャプション、補足説明。",
      },
    ],
  },
  {
    key: "dense",
    label: "Dense(Dns)",
    description:
      "一覧・表・ツリーなど、限られた領域に多くの情報を表示する箇所。行高を詰めて情報量を優先する。",
    styles: [
      {
        name: "Dns-16N-150",
        sizePx: 16,
        weight: "N",
        lineHeight: "150%",
        tracking: "0.02em",
        usage: "一覧のセル(標準)。",
      },
      {
        name: "Dns-14N-150",
        sizePx: 14,
        weight: "N",
        lineHeight: "150%",
        tracking: "0.02em",
        usage: "一覧のセル(高密度)、表のヘッダ。",
      },
      {
        name: "Dns-14B-150",
        sizePx: 14,
        weight: "B",
        lineHeight: "150%",
        tracking: "0.02em",
        usage: "表のヘッダ、グループ見出し。",
      },
    ],
  },
  {
    key: "ui",
    label: "UI(Oneline)",
    description:
      "折り返さない1行の UI テキスト。上下の余白はコンポーネント側のパディングで確保する。",
    styles: [
      {
        name: "UI-16M-100",
        sizePx: 16,
        weight: "M",
        lineHeight: "100%",
        tracking: "0.02em",
        usage: "メニュー項目、タブ、ボタン(標準)。",
      },
      {
        name: "UI-14M-100",
        sizePx: 14,
        weight: "M",
        lineHeight: "100%",
        tracking: "0.02em",
        usage: "小さなボタン、バッジ、ツールバー。",
      },
      {
        name: "UI-14N-100",
        sizePx: 14,
        weight: "N",
        lineHeight: "100%",
        tracking: "0.02em",
        usage: "フォームのラベル、ステータス表示。",
      },
    ],
  },
  {
    key: "mono",
    label: "Mono",
    description: "等幅。コードやパスなど、1文字単位で正確に読む必要があるもの。",
    styles: [
      {
        name: "Mono-16N-150",
        sizePx: 16,
        weight: "N",
        lineHeight: "150%",
        tracking: "0",
        usage: "コードブロック。",
      },
      {
        name: "Mono-14N-150",
        sizePx: 14,
        weight: "N",
        lineHeight: "150%",
        tracking: "0",
        usage: "インラインコード、パス、ID、トークン名。",
      },
    ],
  },
];

/** タイポグラフィの運用ルール。 */
export const TYPOGRAPHY_RULES: string[] = [
  "本文・UI の基準サイズは 16px とし、14px 未満は使わない。領域が足りない場合は文字を小さくするのではなく、情報を削るか領域を広げる。",
  "太さレベルは N / M / B の3段階に限定する。中間の太さを増やすと、見出しの階層が太さでは読み取れなくなる。",
  "階層はサイズと余白の組み合わせで表現する。色や太さだけで見出しを表さない。",
  "1行の長さは全角40〜50文字程度(約720px)を上限とする。それ以上広がる領域では最大幅を設ける。",
  "行高は用途で決める。読み物は170%、一覧・表は150%、1行のUIは100%。",
  "禁則・折り返しは word-break: normal / overflow-wrap: anywhere を基本とし、日本語の途中で不自然に切れないようにする。",
];
