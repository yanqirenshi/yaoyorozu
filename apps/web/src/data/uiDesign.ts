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

export const COLOR_PALETTE: ColorSwatch[] = [
  { name: "京紫", hex: "#9d5b8b", ratio: 35 },
  { name: "金茶", hex: "#CE7A19", ratio: 10 },
  { name: "草色", hex: "#7b8d41", ratio: 5 },
  { name: "真珠", hex: "#fbfbf8", ratio: 50 },
  { name: "墨", hex: "#373737", usage: "文字色" },
];

export const COMPONENT_NAV: NavItem[] = [
  { key: "parts", label: "部品" },
  { key: "subassembly", label: "中間組立品" },
  {
    key: "layout",
    label: "レイアウト",
    children: [
      { key: "panel", label: "パネル" },
      { key: "frame", label: "フレーム" },
      { key: "page", label: "ページ" },
    ],
  },
  {
    key: "basic",
    label: "基本",
    children: [
      { key: "elevation", label: "エヴェレーション" },
      { key: "corner", label: "角の形状" },
      { key: "spacing", label: "余白" },
      { key: "link-text", label: "リンクテキスト" },
      { key: "basic-layout", label: "レイアウト" },
      { key: "icon", label: "アイコン" },
      { key: "typography", label: "タイポグラフィ" },
      { key: "color", label: "カラー" },
    ],
  },
];
