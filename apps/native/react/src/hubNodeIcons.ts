// ハブのグラフ(pages/HubPage.tsx)のノード種別アイコン(issue #119)。
// dock アイコン(icons.ts)と同じ線画スタイル(細線・丸端・viewBox 0 0 20 20)
// だが、d3.network の `icon.url`(data URI)として渡す都合上 `currentColor`
// を継承できないため、色は墨(#373737。App.css の var(--text-primary) と
// 同じ値)を直接指定する(web.md/native.md の「コンポーネントへの hex 直書き
// 禁止」はアプリコードが対象で、このアセット定義ファイルは対象外だが、
// 色の由来を明示するためコメントを残す)。

const ICON_STROKE_COLOR = "#373737"; // 墨。data URIはcurrentColorを継承できないため固定

function toDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SVG_OPEN = `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">`;
const SVG_CLOSE = `</svg>`;

// PC(モニタ)。
const PC_ICON_SVG = `${SVG_OPEN}<rect x="3" y="4" width="14" height="9" rx="1.2"/><line x1="7" y1="16.5" x2="13" y2="16.5"/><line x1="10" y1="13" x2="10" y2="16.5"/>${SVG_CLOSE}`;

// profile(リポジトリの箱)。
const PROFILE_ICON_SVG = `${SVG_OPEN}<path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z"/><path d="M3 6.5v7l7 3.5 7-3.5v-7"/><line x1="10" y1="10" x2="10" y2="17"/>${SVG_CLOSE}`;

// 作業ディレクトリ(フォルダ)。
const CWD_ICON_SVG = `${SVG_OPEN}<path d="M3 6a1 1 0 0 1 1-1h4l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z"/>${SVG_CLOSE}`;

// ブランチ(分岐)。
const BRANCH_ICON_SVG = `${SVG_OPEN}<circle cx="6" cy="4.5" r="1.8"/><circle cx="6" cy="15.5" r="1.8"/><circle cx="14" cy="10" r="1.8"/><line x1="6" y1="6.3" x2="6" y2="13.7"/><path d="M6 9c0 2.8 2.5 2.8 6.3 1.2"/>${SVG_CLOSE}`;

// セッション(吹き出し)。dockのVIEWER_ICONと同じ形状。
const SESSION_ICON_SVG = `${SVG_OPEN}<rect x="3" y="4" width="14" height="9" rx="1.5"/><path d="M7 13v3l4-3"/>${SVG_CLOSE}`;

export const HUB_NODE_ICON_URIS = {
  pc: toDataUri(PC_ICON_SVG),
  profile: toDataUri(PROFILE_ICON_SVG),
  cwd: toDataUri(CWD_ICON_SVG),
  branch: toDataUri(BRANCH_ICON_SVG),
  session: toDataUri(SESSION_ICON_SVG),
} as const;
