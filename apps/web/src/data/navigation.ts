export type NavMenuItem = {
  label: string;
  path: string;
};

export const NAV_MENU_ITEMS: NavMenuItem[] = [
  { label: "WBS", path: "/wbs" },
  { label: "構成図", path: "/deployment-diagram" },
  { label: "UI", path: "/ui" },
  { label: "サイトマップ", path: "/sitemap" },
  { label: "Classes", path: "/class-diagram" },
  { label: "TM", path: "/tm" },
];
