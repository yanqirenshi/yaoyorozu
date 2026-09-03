import { NAV_MENU_ITEMS } from "./navigation";
import { COLOR_PALETTE } from "./uiDesign";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;
const GAP_X = 100;
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

function node(
  id: number,
  label: string,
  x: number,
  y: number,
  size: { w: number; h: number } = { w: NODE_WIDTH, h: NODE_HEIGHT },
  children: SitemapNode[] = [],
): SitemapNode {
  return {
    type: "NODE",
    id,
    label: { contents: label, position: { x: 20, y: 20 } },
    size,
    position: { x, y },
    children,
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

// タブ切り替えはパスが変わらずクエリパラメータが変わるだけ(別ページへの遷移
// ではない)ため、矢印で繋ぐ別ノードにはせず、ページのノードの children として
// 内側に描画する。d3.sitemap の fitting() は children の position を
// 親からの相対座標として親の絶対座標に加算し、親の size も children を
// 包含するよう自動拡張するため、ここでは相対座標だけを与えればよい。
const TAB_WIDTH = 140;
const TAB_HEIGHT = 60;
const TAB_GAP = 20;
const TAB_PADDING_X = 30;
const TAB_PADDING_TOP = 70; // ページ名ラベル分の余白

function tabRow(startId: number, labels: string[]): SitemapNode[] {
  return labels.map((label, index) =>
    node(
      startId + index,
      label,
      TAB_PADDING_X + index * (TAB_WIDTH + TAB_GAP),
      TAB_PADDING_TOP,
      { w: TAB_WIDTH, h: TAB_HEIGHT },
    ),
  );
}

// レイアウト(列位置の計算)専用。実際の描画サイズは fitting() が
// children から自動算出するため、ノード自体の size には使わない。
function tabRowWidth(tabCount: number) {
  return TAB_PADDING_X + tabCount * TAB_WIDTH + (tabCount - 1) * TAB_GAP;
}

// ============ ネイティブアプリ: ページ ============
const NATIVE_HUB_ID = 4; // / (ハブ)
const NATIVE_PROFILES_ID = 5; // /profiles/:id? (ビューア)
const NATIVE_SETTINGS_ID = 6; // /settings (設定)
const NATIVE_CLAUDE_ID = 7; // /claude

// /profiles/:id? の右ペインタブ(id: 8-14)
const PROFILES_TAB_LABELS = [
  "会話",
  "GitHub Project",
  "CLAUDE.md",
  "Rules",
  "Skills",
  "settings.json",
  "settings.local.json",
];
const PROFILES_TAB_FIRST_ID = 8;
const PROFILES_WIDTH = tabRowWidth(PROFILES_TAB_LABELS.length);

// /settings のタブ(id: 15-18)
const SETTINGS_TAB_LABELS = ["対象リポジトリ", "GitHub", "Claude", "CLAUDE.md"];
const SETTINGS_TAB_FIRST_ID = 15;
const SETTINGS_WIDTH = tabRowWidth(SETTINGS_TAB_LABELS.length);

// Webアプリのページ(NAV_MENU_ITEMS から導出。メニューと自動同期する)
const WEB_PAGE_FIRST_ID = 19;

// ============ ネイティブアプリの行レイアウト(左から順に配置) ============
const NATIVE_HUB_X = 0;
const NATIVE_PROFILES_X = NATIVE_HUB_X + NODE_WIDTH + GAP_X;
const NATIVE_SETTINGS_X = NATIVE_PROFILES_X + PROFILES_WIDTH + GAP_X;
const NATIVE_CLAUDE_X = NATIVE_SETTINGS_X + SETTINGS_WIDTH + GAP_X;
const NATIVE_ROW_END_X = NATIVE_CLAUDE_X + NODE_WIDTH;
const NATIVE_COL = (NATIVE_HUB_X + NATIVE_ROW_END_X) / 2;

// ============ Webアプリの行レイアウト ============
const WEB_ROW_START_X = NATIVE_ROW_END_X + GAP_X * 2;
const WEB_COL =
  WEB_ROW_START_X +
  ((NAV_MENU_ITEMS.length - 1) * (NODE_WIDTH + GAP_X)) / 2;

export const SITEMAP_DATA = {
  nodes: [
    node(ROOT_ID, "YAOYOROZU", (NATIVE_COL + WEB_COL) / 2, 0),
    node(NATIVE_ID, "ネイティブアプリ", NATIVE_COL, ROW),
    node(WEB_ID, "Webアプリ", WEB_COL, ROW),

    node(NATIVE_HUB_ID, "/", NATIVE_HUB_X, ROW * 2),
    node(
      NATIVE_PROFILES_ID,
      "/profiles/:id?",
      NATIVE_PROFILES_X,
      ROW * 2,
      { w: NODE_WIDTH, h: NODE_HEIGHT },
      tabRow(PROFILES_TAB_FIRST_ID, PROFILES_TAB_LABELS),
    ),
    node(
      NATIVE_SETTINGS_ID,
      "/settings",
      NATIVE_SETTINGS_X,
      ROW * 2,
      { w: NODE_WIDTH, h: NODE_HEIGHT },
      tabRow(SETTINGS_TAB_FIRST_ID, SETTINGS_TAB_LABELS),
    ),
    node(NATIVE_CLAUDE_ID, "/claude", NATIVE_CLAUDE_X, ROW * 2),

    ...NAV_MENU_ITEMS.map((item, index) =>
      node(
        WEB_PAGE_FIRST_ID + index,
        item.label,
        WEB_ROW_START_X + index * (NODE_WIDTH + GAP_X),
        ROW * 2,
      ),
    ),
  ],
  edges: [
    edge(100, ROOT_ID, NATIVE_ID),
    edge(101, ROOT_ID, WEB_ID),

    edge(102, NATIVE_ID, NATIVE_HUB_ID),
    edge(103, NATIVE_ID, NATIVE_PROFILES_ID),
    edge(104, NATIVE_ID, NATIVE_SETTINGS_ID),
    edge(105, NATIVE_ID, NATIVE_CLAUDE_ID),

    ...NAV_MENU_ITEMS.map((_, index) =>
      edge(130 + index, WEB_ID, WEB_PAGE_FIRST_ID + index),
    ),
  ],
};

// d3.sitemap はズーム/パンを持たずコンテナのサイズそのままに描画するため、
// 全ノード(children を含む。position は親からの相対座標なので絶対座標に
// 変換しながら)が収まる最小サイズを算出し、SitemapTab 側でコンテナに
// 反映する(ブラウザの標準スクロールで全体を見られるようにするため)。
function extentOf(
  nodes: SitemapNode[],
  offsetX: number,
  offsetY: number,
): { w: number; h: number } {
  return nodes.reduce(
    (size, n) => {
      const absX = offsetX + n.position.x;
      const absY = offsetY + n.position.y;
      const childSize = extentOf(n.children, absX, absY);
      return {
        w: Math.max(size.w, absX + n.size.w, childSize.w),
        h: Math.max(size.h, absY + n.size.h, childSize.h),
      };
    },
    { w: 0, h: 0 },
  );
}

export const SITEMAP_CANVAS_SIZE = extentOf(SITEMAP_DATA.nodes, 0, 0);
