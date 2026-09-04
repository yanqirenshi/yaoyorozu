/**
 * UIデザイン(基本デザイン)のうち「カラー」と、/ui のナビゲーション定義。
 *
 * 配色のソースオブトゥルースは COLOR_PALETTE(日本の伝統色)であり、
 * トーンスケール・役割カラーはすべてこの5色から導出する。
 * MUI テーマへは src/theme.ts 経由で反映する。
 */

export type NavItem = {
  key: string;
  label: string;
  children?: NavItem[];
};

export type ColorSwatch = {
  name: string;
  hex: string;
  ratio?: number;
  usage?: string;
};

/** ブランドカラー。ratio は画面全体での配色比率の目安。 */
export const COLOR_PALETTE: ColorSwatch[] = [
  { name: "京紫", hex: "#9d5b8b", ratio: 35 },
  { name: "金茶", hex: "#CE7A19", ratio: 10 },
  { name: "草色", hex: "#7b8d41", ratio: 5 },
  { name: "真珠", hex: "#fbfbf8", ratio: 50 },
  { name: "墨", hex: "#373737", usage: "文字色" },
];

/** 背景(サーフェス)の基準色。コントラスト比はすべてこの色に対して算出する。 */
export const SURFACE_BASE_HEX = "#fbfbf8";

export type ColorTone = {
  /** トーン段階。数値が大きいほど暗い。 */
  step: number;
  hex: string;
  /** 真珠(#fbfbf8)に対するコントラスト比。 */
  contrast: number;
  /** ブランドカラーそのものの段階。 */
  isBase?: boolean;
};

export type ColorScale = {
  /** CSS カスタムプロパティ名に使うローマ字表記。 */
  slug: string;
  name: string;
  reading: string;
  role: string;
  description: string;
  tones: ColorTone[];
};

/**
 * プリミティブカラー(トーンスケール)。
 * ブランドカラーの色相・彩度を保ったまま明度を10段階に割り当て、
 * ブランドカラー自身をもっとも近い段階に配置している。
 * contrast は真珠(#fbfbf8)に対する WCAG コントラスト比。
 */
export const COLOR_SCALES: ColorScale[] = [
  {
    name: "京紫",
    slug: "kyomurasaki",
    reading: "きょうむらさき",
    role: "プライマリー",
    description:
      "YAOYOROZU の主色。ナビゲーションの選択状態、リンク、主要ボタンなど「今どこにいるか・次に何を押すか」を示す箇所に使う。",
    tones: [
      { step: 50, hex: "#f8f6f8", contrast: 1.04 },
      { step: 100, hex: "#f0ebee", contrast: 1.14 },
      { step: 200, hex: "#e1d6de", contrast: 1.36 },
      { step: 300, hex: "#ceb6c7", contrast: 1.82 },
      { step: 400, hex: "#bc8bae", contrast: 2.72 },
      { step: 500, hex: "#9d5b8b", contrast: 4.71, isBase: true },
      { step: 600, hex: "#8e527e", contrast: 5.54 },
      { step: 700, hex: "#744367", contrast: 7.39 },
      { step: 800, hex: "#59364f", contrast: 9.81 },
      { step: 900, hex: "#3f2739", contrast: 12.98 },
    ],
  },
  {
    name: "金茶",
    slug: "kincha",
    reading: "きんちゃ",
    role: "セカンダリー",
    description:
      "注意を引くための副色。フォーカスリング、警告、進行中の状態など「止まって確認してほしい」箇所に使う。面積が増えると主色を殺すため、配色比率は10%を上限とする。",
    tones: [
      { step: 50, hex: "#fbf8f4", contrast: 1.02 },
      { step: 100, hex: "#f5eee5", contrast: 1.11 },
      { step: 200, hex: "#ebdccc", contrast: 1.3 },
      { step: 300, hex: "#e6c49e", contrast: 1.59 },
      { step: 400, hex: "#eba85b", contrast: 1.97 },
      { step: 500, hex: "#e58b25", contrast: 2.52 },
      { step: 600, hex: "#CE7A19", contrast: 3.15, isBase: true },
      { step: 700, hex: "#a46114", contrast: 4.71 },
      { step: 800, hex: "#7a4b15", contrast: 7.12 },
      { step: 900, hex: "#57360f", contrast: 10.44 },
    ],
  },
  {
    name: "草色",
    slug: "kusairo",
    reading: "くさいろ",
    role: "ターシャリー",
    description:
      "完了・正常を示す第3色。処理の成功、検証を通過した状態などに使う。差し色であり、配色比率は5%を上限とする。",
    tones: [
      { step: 50, hex: "#f8f9f6", contrast: 1.02 },
      { step: 100, hex: "#eff1ea", contrast: 1.1 },
      { step: 200, hex: "#dfe3d4", contrast: 1.26 },
      { step: 300, hex: "#cbd3b1", contrast: 1.5 },
      { step: 400, hex: "#b5c581", contrast: 1.8 },
      { step: 500, hex: "#9cb257", contrast: 2.27 },
      { step: 600, hex: "#7b8d41", contrast: 3.54, isBase: true },
      { step: 700, hex: "#6e7e3a", contrast: 4.3 },
      { step: 800, hex: "#545f30", contrast: 6.63 },
      { step: 900, hex: "#3c4422", contrast: 9.92 },
    ],
  },
  {
    name: "蘇芳",
    slug: "suou",
    reading: "すおう",
    role: "エラー",
    description:
      "唯一のブランド外の追加色。エラー・破壊的操作にだけ使い、それ以外の目的では使わない。京紫と色相が近いため、必ず文言やアイコンと併用して色だけに意味を持たせない。",
    tones: [
      { step: 50, hex: "#f9f5f6", contrast: 1.04 },
      { step: 100, hex: "#f1e9e9", contrast: 1.15 },
      { step: 200, hex: "#e4d3d3", contrast: 1.39 },
      { step: 300, hex: "#d6adae", contrast: 1.94 },
      { step: 400, hex: "#cc7b7c", contrast: 3.03 },
      { step: 500, hex: "#bb4e51", contrast: 4.69 },
      { step: 600, hex: "#9e3d3f", contrast: 6.34, isBase: true },
      { step: 700, hex: "#843335", contrast: 8.08 },
      { step: 800, hex: "#642b2c", contrast: 10.53 },
      { step: 900, hex: "#471f20", contrast: 13.64 },
    ],
  },
  {
    name: "墨",
    slug: "sumi",
    reading: "すみ",
    role: "ニュートラル",
    description:
      "文字・罫線・面の階調。画面のほとんどの線と文字はこのスケールから採る。彩度を持たないため、どのブランドカラーとも衝突しない。",
    tones: [
      { step: 50, hex: "#f7f7f7", contrast: 1.03 },
      { step: 100, hex: "#ededed", contrast: 1.13 },
      { step: 200, hex: "#dbdbdb", contrast: 1.34 },
      { step: 300, hex: "#c2c2c2", contrast: 1.72 },
      { step: 400, hex: "#a3a3a3", contrast: 2.43 },
      { step: 500, hex: "#858585", contrast: 3.56 },
      { step: 600, hex: "#707070", contrast: 4.78 },
      { step: 700, hex: "#5c5c5c", contrast: 6.45 },
      { step: 800, hex: "#474747", contrast: 8.96 },
      { step: 900, hex: "#373737", contrast: 11.48, isBase: true },
    ],
  },
];

/** トーン参照。COLOR_SCALES から hex を引く。 */
export function tone(name: string, step: number): string {
  const scale = COLOR_SCALES.find((s) => s.name === name);
  const found = scale?.tones.find((t) => t.step === step);
  if (!found) throw new Error("未定義のトーンです: " + name + "-" + step);
  return found.hex;
}

export type RoleColor = {
  /** 役割トークン名。 */
  token: string;
  label: string;
  /** CSS カラー値。 */
  value: string;
  /** 由来(プリミティブカラーのどの段階か)。 */
  source: string;
  usage: string;
  /** 真珠に対するコントラスト比(不透明色のみ)。 */
  contrast?: number;
};

/** キーカラー。サービスの性格を決める4色。 */
export const KEY_COLORS: RoleColor[] = [
  {
    token: "color.primary",
    label: "プライマリー",
    value: tone("京紫", 500),
    source: "京紫-500",
    usage: "選択状態、主要ボタン、アクティブなタブ。画面の主役。",
    contrast: 4.71,
  },
  {
    token: "color.secondary",
    label: "セカンダリー",
    value: tone("金茶", 600),
    source: "金茶-600",
    usage: "フォーカスリング、警告、進行中インジケータ。",
    contrast: 3.15,
  },
  {
    token: "color.tertiary",
    label: "ターシャリー",
    value: tone("草色", 600),
    source: "草色-600",
    usage: "成功・完了の表示。差し色。",
    contrast: 3.54,
  },
  {
    token: "color.background",
    label: "バックグラウンド",
    value: SURFACE_BASE_HEX,
    source: "真珠",
    usage: "画面全体の地の色。純白を避け、長時間の閲覧でのまぶしさを抑える。",
  },
];

/** 面と境界。 */
export const SURFACE_COLORS: RoleColor[] = [
  {
    token: "surface.base",
    label: "地の面",
    value: SURFACE_BASE_HEX,
    source: "真珠",
    usage: "body の背景。高さレベル0の面。",
  },
  {
    token: "surface.raised",
    label: "浮いた面",
    value: "#ffffff",
    source: "白",
    usage:
      "カード、ポップオーバー、ダイアログなど高さレベル1以上の面。地の面より明るくして浮きを表す。",
  },
  {
    token: "surface.sunken",
    label: "沈んだ面",
    value: tone("墨", 50),
    source: "墨-50",
    usage: "コードブロック、入力欄の背景など、地の面より奥に見せたい領域。",
  },
  {
    token: "surface.overlay-shade",
    label: "オーバーレイシェード",
    value: "rgba(55, 55, 55, 0.48)",
    source: "墨-900 48%",
    usage:
      "モーダル表示時に下層を覆う透過背景。覆った面の高さレベルを0にリセットする。",
  },
  {
    token: "border.default",
    label: "罫線",
    value: tone("墨", 200),
    source: "墨-200",
    usage: "領域の区切り、表の罫線。装飾的な境界。",
    contrast: 1.34,
  },
  {
    token: "border.strong",
    label: "強い罫線",
    value: tone("墨", 500),
    source: "墨-500",
    usage:
      "入力欄・ボタンの境界など、要素の存在自体を伝える境界。真珠に対して3:1以上を満たす。",
    contrast: 3.56,
  },
];

/** 文字色。 */
export const TEXT_COLORS: RoleColor[] = [
  {
    token: "text.primary",
    label: "本文",
    value: tone("墨", 900),
    source: "墨-900",
    usage: "本文・見出しの既定色。",
    contrast: 11.48,
  },
  {
    token: "text.secondary",
    label: "副次テキスト",
    value: tone("墨", 700),
    source: "墨-700",
    usage: "補足説明、キャプション、メタ情報。",
    contrast: 6.45,
  },
  {
    token: "text.placeholder",
    label: "プレースホルダ",
    value: tone("墨", 600),
    source: "墨-600",
    usage: "入力前のヒント文言。これより薄い文字色は本文用途で使わない。",
    contrast: 4.78,
  },
  {
    token: "text.disabled",
    label: "無効",
    value: tone("墨", 400),
    source: "墨-400",
    usage:
      "操作できない要素の文字。コントラストを満たさないため、無効であることを色以外(カーソル・文言)でも示す。",
    contrast: 2.43,
  },
  {
    token: "text.inverse",
    label: "反転",
    value: "#ffffff",
    source: "白",
    usage: "京紫-500 以上の濃い面に載せる文字。",
  },
];

/** 機能カラー。 */
export const FUNCTIONAL_COLORS: RoleColor[] = [
  {
    token: "link.default",
    label: "リンク(未訪問)",
    value: tone("京紫", 700),
    source: "京紫-700",
    usage: "本文中のリンク。常に下線を伴う。",
    contrast: 7.39,
  },
  {
    token: "link.visited",
    label: "リンク(訪問済)",
    value: tone("京紫", 900),
    source: "京紫-900",
    usage: "訪問済みリンク。明度差のみの区別のため、下線を外さない。",
    contrast: 12.98,
  },
  {
    token: "focus.ring",
    label: "フォーカスリング",
    value: tone("金茶", 600),
    source: "金茶-600",
    usage: "キーボードフォーカスの表示。2px の実線を 2px 離して描く。",
    contrast: 3.15,
  },
  {
    token: "state.hover",
    label: "ホバー面",
    value: "rgba(157, 91, 139, 0.08)",
    source: "京紫-500 8%",
    usage: "ポインタが載っている行・項目の背景。",
  },
  {
    token: "state.selected",
    label: "選択面",
    value: "rgba(157, 91, 139, 0.12)",
    source: "京紫-500 12%",
    usage: "選択中のメニュー項目・タブの背景。",
  },
  {
    token: "state.selected-hover",
    label: "選択面(ホバー)",
    value: "rgba(157, 91, 139, 0.18)",
    source: "京紫-500 18%",
    usage: "選択中の項目にポインタが載った状態。",
  },
  {
    token: "state.disabled",
    label: "無効面",
    value: tone("墨", 100),
    source: "墨-100",
    usage: "操作できない要素の背景。",
  },
];

/**
 * 役割カラーの参照。トークン名から CSS カラー値を引く。
 * コンポーネントに hex を直書きしないための入口(規約 §4)。
 */
export function roleColor(token: string): string {
  const all = [
    ...KEY_COLORS,
    ...SURFACE_COLORS,
    ...TEXT_COLORS,
    ...FUNCTIONAL_COLORS,
  ];
  const found = all.find((c) => c.token === token);
  if (!found) throw new Error("未定義のトークンです: " + token);
  return found.value;
}

export type SemanticColor = {
  token: string;
  label: string;
  /** 文字・アイコンに使う色(真珠に対して4.5:1以上)。 */
  fg: string;
  /** 背景に使う色。 */
  bg: string;
  /** 境界に使う色(真珠に対して3:1以上)。 */
  border: string;
  source: string;
  usage: string;
  contrast: number;
};

/** セマンティックカラー。前景・背景・境界の3点セットで定義する。 */
export const SEMANTIC_COLORS: SemanticColor[] = [
  {
    token: "semantic.success",
    label: "成功",
    fg: tone("草色", 800),
    bg: tone("草色", 100),
    border: tone("草色", 600),
    source: "草色-800 / 100 / 600",
    usage: "保存完了、検証通過。",
    contrast: 6.63,
  },
  {
    token: "semantic.warning",
    label: "警告",
    fg: tone("金茶", 800),
    bg: tone("金茶", 100),
    border: tone("金茶", 600),
    source: "金茶-800 / 100 / 600",
    usage: "実行前の確認、非推奨の設定。",
    contrast: 7.12,
  },
  {
    token: "semantic.error",
    label: "エラー",
    fg: tone("蘇芳", 700),
    bg: tone("蘇芳", 100),
    border: tone("蘇芳", 500),
    source: "蘇芳-700 / 100 / 500",
    usage: "失敗、入力エラー、破壊的操作。",
    contrast: 8.08,
  },
  {
    token: "semantic.info",
    label: "情報",
    fg: tone("京紫", 700),
    bg: tone("京紫", 100),
    border: tone("京紫", 500),
    source: "京紫-700 / 100 / 500",
    usage: "補足、ヒント、処理中の案内。",
    contrast: 7.39,
  },
];

/**
 * /ui のナビゲーション。
 *
 * コンポーネントは「レイアウト(構造)→ パーツ(製品 → 中間品 → 部品)」の順に並べ、
 * 上から読むと大きいものから小さいものへ下りるようにしている。
 * 「製品」はコンポーネントの最上位層を指し、YAOYOROZU というプロダクト自体のことではない。
 */
export const COMPONENT_NAV: NavItem[] = [
  {
    key: "layout",
    label: "レイアウト",
    children: [
      { key: "page", label: "ページ" },
      { key: "frame", label: "フレーム" },
    ],
  },
  {
    key: "parts",
    label: "パーツ",
    children: [
      { key: "products", label: "製品" },
      { key: "subassembly", label: "中間品" },
      { key: "part", label: "部品" },
    ],
  },
  {
    key: "basic",
    label: "基本",
    // 並びは WBS(id 51〜58「デザイン」配下)と揃えている。
    children: [
      { key: "color", label: "カラー" },
      { key: "typography", label: "タイポグラフィ" },
      { key: "icon", label: "アイコン" },
      { key: "basic-layout", label: "レイアウト" },
      { key: "link-text", label: "リンクテキスト" },
      { key: "spacing", label: "余白" },
      { key: "corner", label: "角の形状" },
      { key: "elevation", label: "エヴェレーション" },
    ],
  },
  {
    key: "design-system",
    label: "デザインシステム",
    children: [
      { key: "design-token", label: "デザイントークン" },
      { key: "glossary", label: "用語集" },
    ],
  },
];
