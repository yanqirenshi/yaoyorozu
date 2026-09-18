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

// セッション(吹き出し)。dockのVIEWER_ICONと同じ形状。
const SESSION_ICON_SVG = `${SVG_OPEN}<rect x="3" y="4" width="14" height="9" rx="1.5"/><path d="M7 13v3l4-3"/>${SVG_CLOSE}`;

// GitRepository(貯蔵庫を表す円筒)。ハブ再構築 第2段(issue #224)で
// #215 で一度削除した線画を git 履歴から復活させた。
const GIT_REPOSITORY_ICON_SVG = `${SVG_OPEN}<ellipse cx="10" cy="5.2" rx="6" ry="2.2"/><path d="M4 5.2v9.6c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5.2"/><path d="M4 10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2"/>${SVG_CLOSE}`;

// GitBranch(台帳で追跡しているブランチ)。タグ(ラベル)の形。issue #224で
// GitRepositoryと同様に git 履歴から復活させた。
const GIT_BRANCH_ICON_SVG = `${SVG_OPEN}<path d="M4.5 10 10.5 4h5v5l-6 6Z"/><circle cx="13" cy="6.5" r="1.1" fill="${ICON_STROKE_COLOR}" stroke="none"/><path d="M9 12l-4.5 4.5"/>${SVG_CLOSE}`;

export const HUB_NODE_ICON_URIS = {
  session: toDataUri(SESSION_ICON_SVG),
  gitRepository: toDataUri(GIT_REPOSITORY_ICON_SVG),
  gitBranch: toDataUri(GIT_BRANCH_ICON_SVG),
} as const;
