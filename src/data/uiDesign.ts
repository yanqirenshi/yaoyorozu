export type NavItem = {
  label: string;
  children?: NavItem[];
};

export const COMPONENT_NAV: NavItem[] = [
  { label: "部品" },
  { label: "中間組立品" },
  {
    label: "レイアウト",
    children: [
      { label: "パネル" },
      { label: "フレーム" },
      { label: "ページ" },
    ],
  },
  {
    label: "基本",
    children: [
      { label: "エヴェレーション" },
      { label: "角の形状" },
      { label: "余白" },
      { label: "リンクテキスト" },
      { label: "レイアウト" },
      { label: "アイコン" },
      { label: "タイポグラフィ" },
      { label: "カラー" },
    ],
  },
];
