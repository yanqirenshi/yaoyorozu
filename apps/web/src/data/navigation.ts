export type NavMenuItem = {
  label: string;
  path: string;
};

export const NAV_MENU_ITEMS: NavMenuItem[] = [
  // #543: 実行時にリポジトリの yyz/ から読む新しい URL へ移行済み(いまは
  // yaoyorozu 固定)。UI は対象外(リポジトリに依存しないため /ui のまま)。
  { label: "WBS", path: "/yaoyorozu/wbs" },
  { label: "構成図", path: "/yaoyorozu/deployment-diagram" },
  { label: "UI", path: "/ui" },
  { label: "サイトマップ", path: "/yaoyorozu/sitemap" },
  { label: "Classes", path: "/yaoyorozu/class-diagram" },
  { label: "TM", path: "/yaoyorozu/tm" },
  { label: "ポンチ絵", path: "/yaoyorozu/unchi" },
];
