import { NAV_MENU_ITEMS } from "./navigation";
import { COLOR_PALETTE } from "./uiDesign";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;
const COL = NODE_WIDTH + 100; // 列間隔
const ROW = 260; // 階層間隔
const sumi = COLOR_PALETTE.find((c) => c.name === "墨")!.hex;

// ID: 1=root, 2-3=アプリ, 4-18=ネイティブ側(ページ+タブ), 19-=Webアプリのページ(NAV_MENU_ITEMSから導出)
const ROOT_ID = 1;
const NATIVE_ID = 2;
const WEB_ID = 3;

type SitemapNode = {
  type: string;
  id: number;
  label: { contents: string; position: { x: number; y: number } };
  size: { w: number; h: number };
  position: { x: number; y: number };
  children: SitemapNode[];
};

function node(id: number, label: string, col: number, row: number): SitemapNode {
  return {
    type: "NODE",
    id,
    label: { contents: label, position: { x: 20, y: 20 } },
    size: { w: NODE_WIDTH, h: NODE_HEIGHT },
    position: { x: col * COL, y: row * ROW },
    children: [],
  };
}

function edge(id: number, fromId: number, toId: number) {
  return {
    id,
    from: { id: fromId, position: 0 },
    to: { id: toId, position: 180 },
    stroke: { color: sumi, width: 1.5 },
  };
}

// ============ ネイティブアプリ: ページ ============
const NATIVE_HUB_ID = 4; // / (ハブ)
const NATIVE_PROFILES_ID = 5; // /profiles/:id? (ビューア)
const NATIVE_SETTINGS_ID = 6; // /settings (設定)
const NATIVE_CLAUDE_ID = 7; // /claude

// /profiles/:id? の右ペインタブ
const PROFILES_TABS = [
  { id: 8, label: "会話" },
  { id: 9, label: "GitHub Project" },
  { id: 10, label: "CLAUDE.md" },
  { id: 11, label: "Rules" },
  { id: 12, label: "Skills" },
  { id: 13, label: "settings.json" },
  { id: 14, label: "settings.local.json" },
];

// /settings のタブ
const SETTINGS_TABS = [
  { id: 15, label: "対象リポジトリ" },
  { id: 16, label: "GitHub" },
  { id: 17, label: "Claude" },
  { id: 18, label: "CLAUDE.md" },
];

// Webアプリのページ(NAV_MENU_ITEMS から導出。メニューと自動同期する)
const WEB_PAGE_FIRST_ID = 19;

const PROFILES_TABS_COL_START = 1;
const SETTINGS_TABS_COL_START = 8;
const WEB_PAGES_COL_START = 13;

const centerOf = (start: number, count: number) => start + (count - 1) / 2;
const NATIVE_COL = 6;
const WEB_COL = centerOf(WEB_PAGES_COL_START, NAV_MENU_ITEMS.length);

export const SITEMAP_DATA = {
  nodes: [
    node(ROOT_ID, "YAOYOROZU", (NATIVE_COL + WEB_COL) / 2, 0),
    node(NATIVE_ID, "ネイティブアプリ", NATIVE_COL, 1),
    node(WEB_ID, "Webアプリ", WEB_COL, 1),

    node(NATIVE_HUB_ID, "/", 0, 2),
    node(
      NATIVE_PROFILES_ID,
      "/profiles/:id?",
      centerOf(PROFILES_TABS_COL_START, PROFILES_TABS.length),
      2,
    ),
    node(
      NATIVE_SETTINGS_ID,
      "/settings",
      centerOf(SETTINGS_TABS_COL_START, SETTINGS_TABS.length),
      2,
    ),
    node(NATIVE_CLAUDE_ID, "/claude", 12, 2),

    ...PROFILES_TABS.map((tab, index) =>
      node(tab.id, tab.label, PROFILES_TABS_COL_START + index, 3),
    ),
    ...SETTINGS_TABS.map((tab, index) =>
      node(tab.id, tab.label, SETTINGS_TABS_COL_START + index, 3),
    ),

    ...NAV_MENU_ITEMS.map((item, index) =>
      node(WEB_PAGE_FIRST_ID + index, item.label, WEB_PAGES_COL_START + index, 2),
    ),
  ],
  edges: [
    edge(100, ROOT_ID, NATIVE_ID),
    edge(101, ROOT_ID, WEB_ID),

    edge(102, NATIVE_ID, NATIVE_HUB_ID),
    edge(103, NATIVE_ID, NATIVE_PROFILES_ID),
    edge(104, NATIVE_ID, NATIVE_SETTINGS_ID),
    edge(105, NATIVE_ID, NATIVE_CLAUDE_ID),

    ...PROFILES_TABS.map((tab, index) => edge(110 + index, NATIVE_PROFILES_ID, tab.id)),
    ...SETTINGS_TABS.map((tab, index) => edge(120 + index, NATIVE_SETTINGS_ID, tab.id)),

    ...NAV_MENU_ITEMS.map((_, index) =>
      edge(130 + index, WEB_ID, WEB_PAGE_FIRST_ID + index),
    ),
  ],
};

// d3.sitemap はズーム/パンを持たずコンテナのサイズそのままに描画するため、
// 全ノードが収まる最小サイズを算出して SitemapTab 側でコンテナに反映する
// (ブラウザの標準スクロールで全体を見られるようにするため)。
export const SITEMAP_CANVAS_SIZE = SITEMAP_DATA.nodes.reduce(
  (size, n) => ({
    w: Math.max(size.w, n.position.x + n.size.w),
    h: Math.max(size.h, n.position.y + n.size.h),
  }),
  { w: 0, h: 0 },
);
