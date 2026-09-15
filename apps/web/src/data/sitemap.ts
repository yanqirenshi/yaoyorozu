import { NAV_MENU_ITEMS } from "./navigation";
import { COLOR_PALETTE } from "./uiDesign";
import { WBS_SOURCE } from "./wbs";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;
const GAP_X = 100;
const ROW = 260; // 階層間隔
const sumi = COLOR_PALETTE.find((c) => c.name === "墨")!.hex;

// ID: 1=root, 2-3=アプリ, 4-18=ネイティブ側(ページ+タブ), 19-49=Webアプリのページ(NAV_MENU_ITEMSから導出),
//     50-=Webアプリのメニューに出ないページ
// 結線の ID: 100-=ネイティブ側, 130-=Webアプリのページ, 150-=Webアプリのメニューに出ないページ
const ROOT_ID = 1;
const NATIVE_ID = 2;
const WEB_ID = 3;

type SitemapNode = {
  type: string;
  id: number;
  label: { contents: string; position: { x: number; y: number } };
  size: { w: number; h: number };
  position: { x: number; y: number };
  /** 内側の余白(d3.sitemap 0.6.0 の padding。children を持つノードに付ける)。 */
  padding?: number;
  children: SitemapNode[];
};

function node(
  id: number,
  label: string,
  x: number,
  y: number,
  size: { w: number; h: number } = { w: NODE_WIDTH, h: NODE_HEIGHT },
  children: SitemapNode[] = [],
  padding?: number,
): SitemapNode {
  return {
    type: "NODE",
    id,
    label: { contents: label, position: { x: 20, y: 20 } },
    size,
    position: { x, y },
    ...(padding ? { padding } : {}),
    children,
  };
}

// 端点の角度は 0=下 / 90=左 / 180=上 / 270=右。既定は親の下から子の上へ入る向き。
function edge(
  id: number,
  fromId: number,
  toId: number,
  angles: { from: number; to: number } = { from: 0, to: 180 },
) {
  return {
    id,
    from: { id: fromId, position: angles.from },
    to: { id: toId, position: angles.to },
    stroke: { color: sumi, width: 1.5 },
  };
}

// タブ切り替えはパスが変わらずクエリパラメータが変わるだけ(別ページへの遷移
// ではない)ため、矢印で繋ぐ別ノードにはせず、ページのノードの children として
// 内側に描画する。d3.sitemap の fitting() は children の position を
// 親からの相対座標として親の絶対座標に加算し、親の size も children を
// 包含するよう自動拡張するため、ここでは相対座標だけを与えればよい。
//
// children の位置は「親の左上」からの相対座標で書く(保存値 sitemap.json と同じ)。
// タブを持つページには内側の余白(d3.sitemap 0.6.0 の padding)を付け、右端・下端にも
// 余白が出るようにする。d3.sitemap は余白の内側を起点にするので、描画に渡すときに
// 余白の分を引く(apps/web/src/app/tabs/sitemap/renderNodes.ts)。
const TAB_WIDTH = 140;
const TAB_HEIGHT = 60;
const TAB_GAP = 20;
const TAB_CONTAINER_PADDING = 30;
const TAB_PADDING_X = TAB_CONTAINER_PADDING; // 左端は余白と同じ
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

/** メニューのパスから Webアプリのページの ID を引く。メニューに無いパスは誤りなので止める。 */
function webPageId(path: string): number {
  const index = NAV_MENU_ITEMS.findIndex((item) => item.path === path);
  if (index < 0) throw new Error(`メニューに無いページです: ${path}`);
  return WEB_PAGE_FIRST_ID + index;
}

const WEB_SITEMAP_ID = webPageId("/sitemap");

// Webアプリのメニューに出ないページ(id 50-)
const WEB_SITE_DETAIL_ID = 50; // /sitemap/sites/:id(サイトの詳細)
// 手調整後の配置(src/data/layout/sitemap.json)では、Webアプリのページが x≈-1300 に
// 縦に並び、結線は Webアプリの左(90)から出て各ページの右(270)へ入る。そこへ馴染む
// よう、サイトマップのページの左隣(同じ高さ)に置き、結線も同じ向きにする。
const WEB_SITE_DETAIL_POSITION = { x: -1617, y: 437 };

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

    // ページのノード名は画面の名前にし(ネイティブアプリのウィンドウのタイトル・
    // ドックの表示に合わせる)、パスはボックスの上に添える(SITE_DETAILS の path)。
    node(NATIVE_HUB_ID, "ハブ", NATIVE_HUB_X, ROW * 2),
    node(
      NATIVE_PROFILES_ID,
      "ビューア",
      NATIVE_PROFILES_X,
      ROW * 2,
      { w: NODE_WIDTH, h: NODE_HEIGHT },
      tabRow(PROFILES_TAB_FIRST_ID, PROFILES_TAB_LABELS),
      TAB_CONTAINER_PADDING,
    ),
    node(
      NATIVE_SETTINGS_ID,
      "設定",
      NATIVE_SETTINGS_X,
      ROW * 2,
      { w: NODE_WIDTH, h: NODE_HEIGHT },
      tabRow(SETTINGS_TAB_FIRST_ID, SETTINGS_TAB_LABELS),
      TAB_CONTAINER_PADDING,
    ),
    node(NATIVE_CLAUDE_ID, "Claude", NATIVE_CLAUDE_X, ROW * 2),

    ...NAV_MENU_ITEMS.map((item, index) =>
      node(
        WEB_PAGE_FIRST_ID + index,
        item.label,
        WEB_ROW_START_X + index * (NODE_WIDTH + GAP_X),
        ROW * 2,
      ),
    ),

    node(
      WEB_SITE_DETAIL_ID,
      "サイトの詳細",
      WEB_SITE_DETAIL_POSITION.x,
      WEB_SITE_DETAIL_POSITION.y,
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

    edge(150, WEB_SITEMAP_ID, WEB_SITE_DETAIL_ID, { from: 90, to: 270 }),
  ],
};

// ============ サイトの説明・関連する WBS ============
// サイトの詳細ページ(/sitemap/sites/:id)に出す情報。説明は各画面の実装
// (apps/native/react/src/pages/*・apps/web/src/app/tabs/*)から書き起こしたもの。
// 関連する WBS は、その画面・アプリに対応する WBS の項目(wbs.ts)。対応する項目が
// 無いもの(ネイティブアプリの各画面など)は空にする(推測で割り当てない)。

type SiteDetail = {
  /** 画面の説明。 */
  description?: string;
  /** 画面のパス。アプリやタブのように、固有のパスを持たないものは省く。 */
  path?: string;
  /** 関連する WBS の ID(wbs.ts)。 */
  wbsIds?: number[];
};

// PROFILES_TAB_LABELS と同じ並び。
const PROFILES_TAB_DESCRIPTIONS = [
  "選択中のセッションの会話を表示し、AIにメッセージを送る。",
  "プロファイルに設定した GitHub プロジェクトをかんばんで表示する。カードをドラッグしてステータスを変える。",
  "選択中のフォルダ(プロジェクト)の CLAUDE.md を表示・編集する。",
  "`.claude/rules/*.md` を一覧・表示する(編集はしない)。",
  "`.claude/skills/<名前>/SKILL.md` を一覧・表示する(編集はしない)。",
  "`.claude/settings.json` を JSON として表示・編集する。",
  "`.claude/settings.local.json` を JSON として表示・編集する。",
];

// SETTINGS_TAB_LABELS と同じ並び。
const SETTINGS_TAB_DESCRIPTIONS = [
  "プロファイルの対象リポジトリを設定する。実際の画面では、タブの見出しにプロファイル名が出る。",
  "GitHub の認証と、かんばんに使う GitHub プロジェクト(オーナー・番号)を設定する。",
  "セッションのルートディレクトリと、ビューアに一覧を出す対象フォルダを設定する。",
  "対象リポジトリの CLAUDE.md を表示・編集する(先にリポジトリの選択が必要)。",
];

// NAV_MENU_ITEMS のパスがキー。
const WEB_PAGE_DETAILS: Record<string, Omit<SiteDetail, "path">> = {
  "/wbs": {
    description: "プロダクトの WBS(作業分解構成)を表で一覧する。",
    wbsIds: [21],
  },
  "/deployment-diagram": {
    description:
      "システムの構成図を表示する。「WBS」タブにはシステム構成の WBS を出す。",
    wbsIds: [22, 10],
  },
  "/ui": {
    description:
      "UI のデザインシステムを定義・公開する。基本デザイン(カラー・タイポグラフィ・余白など)、デザインシステム(デザイントークン・用語集)、コンポーネント(レイアウト・パーツ)を左のメニューで切り替える。",
    wbsIds: [23, 50, 60],
  },
  "/sitemap": {
    description:
      "アプリの画面構成(ページ・タブと、そのつながり)を図で表示する。ノードの配置・結線の角度・視点は保存される。ノードを右クリックすると、位置・サイズ・結線の角度を調整するインスペクタを開く。",
    wbsIds: [24],
  },
  "/class-diagram": {
    description:
      "ドメインモデルのオブジェクトモデルをクラス図で表示する。「クラス図の書き方」タブに記法をまとめている。",
    wbsIds: [25, 30],
  },
  "/tm": {
    description: "ドメインモデルのデータモデルを TM(T字形ER)で表示する。",
    wbsIds: [26, 40],
  },
};

const SITE_DETAILS: Record<number, SiteDetail> = {
  [ROOT_ID]: {
    description:
      "AIを利用したITプロダクト開発をサポートするアプリ。ネイティブアプリとWebアプリの2つからなり、両者の役割・機能は分けている。",
    wbsIds: [13],
  },
  [NATIVE_ID]: {
    description:
      "Claude Code などのAIコーディングエージェントをラップし、GitHub を使ったタスク管理を行うデスクトップアプリ(Tauri)。1ウィンドウで1つのプロファイルを扱い、複数のプロファイルは別ウィンドウで開く。",
    wbsIds: [11],
  },
  [WEB_ID]: {
    description:
      "プロダクトの情報(仕様・WBS・各種図)を管理するドキュメンテーションツール(Next.js)。AIと人のコミュニケーションに使い、情報を断片化させないための場。",
    wbsIds: [12],
  },
  [NATIVE_HUB_ID]: {
    path: "/",
    description:
      "起点の画面(ハブ)。このPCのプロファイルとセッションを、PC → プロファイル → 作業ディレクトリ → ブランチ → セッションの階層のグラフで一覧する。プロファイル以下のノードを押すと、そのプロファイルのビューアのウィンドウを開く(開いていれば前面に出す)。ノードを右クリックすると詳細をインスペクタに表示する。",
  },
  [NATIVE_PROFILES_ID]: {
    path: "/profiles/:id?",
    description:
      "1つのプロファイルの作業画面(ビューア)。左ペインに対象フォルダのセッションの一覧、右ペインに会話・GitHub プロジェクト・Claude Code の設定ファイルをタブで切り替えて表示する。表示するプロファイルはパスの id で決まる(省略時はアクティブなプロファイル)。",
  },
  [NATIVE_SETTINGS_ID]: {
    path: "/settings",
    description:
      "プロファイルとその設定を管理する画面(設定)。左ペインでプロファイルを追加・名前変更・削除し、別ウィンドウで開ける。右側のタブで、アクティブなプロファイルの対象リポジトリ・GitHub・Claude・CLAUDE.md を設定する。",
  },
  [NATIVE_CLAUDE_ID]: {
    path: "/claude",
    description:
      "`~/.claude` の内容を管理する画面。今は settings.json の表示・編集だけを行う。",
  },
  ...Object.fromEntries(
    PROFILES_TAB_DESCRIPTIONS.map((description, index) => [
      PROFILES_TAB_FIRST_ID + index,
      { description },
    ]),
  ),
  ...Object.fromEntries(
    SETTINGS_TAB_DESCRIPTIONS.map((description, index) => [
      SETTINGS_TAB_FIRST_ID + index,
      { description },
    ]),
  ),
  ...Object.fromEntries(
    NAV_MENU_ITEMS.map((item) => [
      webPageId(item.path),
      { path: item.path, ...WEB_PAGE_DETAILS[item.path] },
    ]),
  ),
  [WEB_SITE_DETAIL_ID]: {
    path: "/sitemap/sites/:id",
    description:
      "サイトマップの1サイト(ノード)の詳細を表示する。画面の説明・関連する WBS と、図の上での位置づけ(上位・下位・親ページ・タブ)を並べる。サイトマップのインスペクタの「詳細」から開く。",
    wbsIds: [24],
  },
};

// WBS の項目名と、上位の項目(wbs.ts の edges から)。
const WBS_NAME_BY_ID = new Map(WBS_SOURCE.wbs.map((w) => [w._id, w.name]));
const WBS_PARENT_BY_ID = new Map(
  WBS_SOURCE.edges
    .filter((e) => e.from_class === "WBS" && e.to_class === "WBS")
    .map((e) => [e.to_id, e.from_id]),
);

/** WBS の項目名を上位から並べる(例: ["画面", "サイトマップ"])。 */
function wbsNames(id: number): string[] {
  const names: string[] = [];
  let current: number | undefined = id;
  while (current !== undefined) {
    const name = WBS_NAME_BY_ID.get(current);
    if (name === undefined) break;
    names.unshift(name);
    current = WBS_PARENT_BY_ID.get(current);
  }
  return names;
}

/**
 * サイトマップ上の1サイト(アプリ・ページ・タブのノード)。サイトの詳細ページ
 * (/sitemap/sites/:id)で使う。位置づけは SITEMAP_DATA から導出し、説明・パス・
 * 関連する WBS は SITE_DETAILS から引く。
 */
export type SitemapSite = {
  id: number;
  label: string;
  /** このノードを children に持つノード(タブなら、それを含むページ)。 */
  parentId: number | null;
  /** children(ページ内のタブ)。 */
  childIds: number[];
  /** 結線でこのノードへ入ってくる元。 */
  fromIds: number[];
  /** このノードから結線で出ていく先。 */
  toIds: number[];
  /** 属するアプリ(ルートは null)。 */
  app: "native" | "web" | null;
  /** 画面のパス(固有のパスを持たないアプリ・タブは null)。 */
  path: string | null;
  /** 画面の説明。 */
  description: string | null;
  /** 関連する WBS。names は上位からの項目名。 */
  wbs: { id: number; names: string[] }[];
};

// 上位のノード(包含の親、または結線で入ってくる元)。属するアプリを決めるのに使う。
const UPPER_BY_ID = new Map<number, number>();
(function collectParents(nodes: SitemapNode[], parentId: number | null) {
  for (const n of nodes) {
    if (parentId !== null) UPPER_BY_ID.set(n.id, parentId);
    collectParents(n.children, n.id);
  }
})(SITEMAP_DATA.nodes, null);
for (const e of SITEMAP_DATA.edges) UPPER_BY_ID.set(e.to.id, e.from.id);

function appOf(id: number): SitemapSite["app"] {
  const seen = new Set<number>();
  let current: number | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    if (current === NATIVE_ID) return "native";
    if (current === WEB_ID) return "web";
    seen.add(current);
    current = UPPER_BY_ID.get(current);
  }
  return null;
}

function flattenSites(
  nodes: SitemapNode[],
  parentId: number | null,
): SitemapSite[] {
  return nodes.flatMap((n) => {
    const detail = SITE_DETAILS[n.id] ?? {};
    return [
      {
        id: n.id,
        label: n.label.contents,
        parentId,
        childIds: n.children.map((child) => child.id),
        fromIds: SITEMAP_DATA.edges
          .filter((e) => e.to.id === n.id)
          .map((e) => e.from.id),
        toIds: SITEMAP_DATA.edges
          .filter((e) => e.from.id === n.id)
          .map((e) => e.to.id),
        app: appOf(n.id),
        path: detail.path ?? null,
        description: detail.description ?? null,
        wbs: (detail.wbsIds ?? [])
          .map((id) => ({ id, names: wbsNames(id) }))
          .filter((w) => w.names.length > 0),
      },
      ...flattenSites(n.children, n.id),
    ];
  });
}

/** children を含む全ノード。 */
export const SITEMAP_SITES: SitemapSite[] = flattenSites(SITEMAP_DATA.nodes, null);

const SITE_BY_ID = new Map(SITEMAP_SITES.map((site) => [site.id, site]));

export function findSitemapSite(id: number): SitemapSite | undefined {
  return SITE_BY_ID.get(id);
}

// 子ノード id → 親の内側の余白(padding)。
const PARENT_PADDING_BY_ID = new Map<number, number>();
(function collectPaddings(nodes: SitemapNode[]) {
  for (const n of nodes) {
    for (const child of n.children) {
      PARENT_PADDING_BY_ID.set(child.id, n.padding ?? 0);
    }
    collectPaddings(n.children);
  }
})(SITEMAP_DATA.nodes);

/**
 * 親の内側の余白。SITEMAP_DATA と保存値は children の位置を「親の左上」から
 * 持つが、d3.sitemap 0.6.0 は「親の余白の内側」を起点にするため、描画に渡すときに
 * この分を引き、インスペクタに見せるときに足して戻す。
 */
export function parentPaddingOf(id: number): number {
  return PARENT_PADDING_BY_ID.get(id) ?? 0;
}
