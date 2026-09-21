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

// PC(モニタ)。ハブ再構築 第4段(issue #283)で、#215 で一度削除した線画を
// git 履歴から復活させた。
const PC_ICON_SVG = `${SVG_OPEN}<rect x="3" y="4" width="14" height="9" rx="1.2"/><line x1="7" y1="16.5" x2="13" y2="16.5"/><line x1="10" y1="13" x2="10" y2="16.5"/>${SVG_CLOSE}`;

// User(人物)。PC と同じく issue #283 で git 履歴から復活させた。
const USER_ICON_SVG = `${SVG_OPEN}<circle cx="10" cy="7" r="3.2"/><path d="M4 16.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/>${SVG_CLOSE}`;

// セッション(吹き出し)。dockのVIEWER_ICONと同じ形状。
const SESSION_ICON_SVG = `${SVG_OPEN}<rect x="3" y="4" width="14" height="9" rx="1.5"/><path d="M7 13v3l4-3"/>${SVG_CLOSE}`;

// プロファイル。Material Icons の「DisplaySettings」(ユーザー指示。MUI の
// `@mui/icons-material` v9.4.0 `DisplaySettings` の2つのパスをそのまま使う。
// MIT ライセンス)。GitRepository と同じく塗りつぶしの図形で、viewBox は MUI の
// 24×24 のまま。
const PROFILE_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="${ICON_STROKE_COLOR}" stroke="none"><path d="M20 3H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h4v2h8v-2h4c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2m0 14H4V5h16z"/><path d="M6 8.25h8v1.5H6zm10.5 1.5H18v-1.5h-1.5V7H15v4h1.5zm-6.5 2.5h8v1.5h-8zM7.5 15H9v-4H7.5v1.25H6v1.5h1.5z"/></svg>`;

// GitRepository。Material Icons の「GitHub」(ユーザー指示。MUI の
// `@mui/icons-material` v9.4.0 `GitHub` のパスをそのまま使う。MIT ライセンス)。
// 他のアイコンと違い線画ではなく塗りつぶしの図形で、viewBox も MUI の 24×24 の
// まま(`icon.url` の画像として表示枠に合わせて縮小されるため、20×20 に
// そろえる必要はない)。
const GIT_REPOSITORY_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="${ICON_STROKE_COLOR}" stroke="none"><path d="M12 1.27a11 11 0 00-3.48 21.46c.55.09.73-.28.73-.55v-1.84c-3.03.64-3.67-1.46-3.67-1.46-.55-1.29-1.28-1.65-1.28-1.65-.92-.65.1-.65.1-.65 1.1 0 1.73 1.1 1.73 1.1.92 1.65 2.57 1.2 3.21.92a2 2 0 01.64-1.47c-2.47-.27-5.04-1.19-5.04-5.5 0-1.1.46-2.1 1.2-2.84a3.76 3.76 0 010-2.93s.91-.28 3.11 1.1c1.8-.49 3.7-.49 5.5 0 2.1-1.38 3.02-1.1 3.02-1.1a3.76 3.76 0 010 2.93c.83.74 1.2 1.74 1.2 2.94 0 4.21-2.57 5.13-5.04 5.4.45.37.82.92.82 2.02v3.03c0 .27.1.64.73.55A11 11 0 0012 1.27"/></svg>`;

// GitBranch(台帳で追跡しているブランチ)。分岐の図(左上・右上・左下の丸と、
// 左の縦線から右上の丸へ伸びる曲線)。ユーザーから渡された 512×512 の画像を
// その座標のまま線画に書き起こした。線幅 40/512 は、他のアイコンの
// 1.7/20(viewBox 0 0 20 20)とほぼ同じ太さになる。
const GIT_BRANCH_ICON_SVG = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"><circle cx="150" cy="105" r="42"/><circle cx="350" cy="105" r="42"/><circle cx="150" cy="405" r="42"/><line x1="150" y1="147" x2="150" y2="363"/><path d="M150 300C150 258 184 235 228 235H268C310 235 340 205 340 150"/></svg>`;

export const HUB_NODE_ICON_URIS = {
  pc: toDataUri(PC_ICON_SVG),
  user: toDataUri(USER_ICON_SVG),
  session: toDataUri(SESSION_ICON_SVG),
  profile: toDataUri(PROFILE_ICON_SVG),
  gitRepository: toDataUri(GIT_REPOSITORY_ICON_SVG),
  gitBranch: toDataUri(GIT_BRANCH_ICON_SVG),
} as const;
