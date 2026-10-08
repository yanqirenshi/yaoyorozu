export type NavMenuItem = {
  label: string;
  path: string;
};

export const NAV_MENU_ITEMS: NavMenuItem[] = [
  // #544・#548: WBS・構成図・ポンチ絵は、実行時にリポジトリの yyz/ から読む新しい
  // URL へ先行して移した(いまは yaoyorozu 固定)。残りは #543 の後の段で順に移す。
  { label: "WBS", path: "/yaoyorozu/wbs" },
  { label: "構成図", path: "/yaoyorozu/deployment-diagram" },
  { label: "UI", path: "/ui" },
  { label: "サイトマップ", path: "/sitemap" },
  { label: "Classes", path: "/yaoyorozu/class-diagram" },
  { label: "TM", path: "/tm" },
  { label: "ポンチ絵", path: "/yaoyorozu/unchi" },
];
