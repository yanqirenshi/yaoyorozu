// command-dock の DockItemBase.label は文字列だけでなくSVG/HTML文字列も受け付ける。
// 色はすべて currentColor にし、command-dock 側のCSS変数(--dock-fg 等)による
// 通常/hover/active/busy の配色がそのまま効くようにする(hex直書きしない)。

export const RELOAD_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <path d="M16 10a6 6 0 1 1-2-4.47" />
  <path d="M16 3v4h-4" />
</svg>`;

// ハブ(`/`)専用: domain データ(Git状態の再観測 + jsonl の再走査)の
// 読み直し(issue #243)。他画面の汎用更新(RELOAD_ICON。円弧矢印だけ)と
// 見分けられるよう、データベース(円筒)に円弧矢印を添えた形にする。
export const DOMAIN_RELOAD_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="8" cy="4.2" rx="5" ry="2" />
  <path d="M3 4.2v6c0 1.1 2.2 2 5 2 .3 0 .7 0 1-.05" />
  <path d="M3 7.2c0 1.1 2.2 2 5 2 .4 0 .8-.02 1.2-.06" />
  <path d="M17 15.2a3.1 3.1 0 1 1-1.1-2.37" />
  <path d="M17.2 11.4v2.4h-2.4" />
</svg>`;

// ハブ(`/`)専用: グラフ(force シミュレーション)の調整メニュー(issue #246)。
// 3本のスライダーの線画。
export const TUNING_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <line x1="3" y1="5" x2="17" y2="5" />
  <line x1="3" y1="10" x2="17" y2="10" />
  <line x1="3" y1="15" x2="17" y2="15" />
  <circle cx="7" cy="5" r="1.8" fill="var(--dock-bg, #fff)" />
  <circle cx="13" cy="10" r="1.8" fill="var(--dock-bg, #fff)" />
  <circle cx="8" cy="15" r="1.8" fill="var(--dock-bg, #fff)" />
</svg>`;

export const MODE_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <line x1="4" y1="16" x2="4" y2="12" />
  <line x1="4" y1="9" x2="4" y2="3" />
  <circle cx="4" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
  <line x1="10" y1="16" x2="10" y2="9" />
  <line x1="10" y1="6" x2="10" y2="3" />
  <circle cx="10" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
  <line x1="16" y1="16" x2="16" y2="13" />
  <line x1="16" y1="10" x2="16" y2="3" />
  <circle cx="16" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
</svg>`;

export const VIEWER_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="4" width="14" height="9" rx="1.5" />
  <path d="M7 13v3l4-3" />
</svg>`;

// ハブ(/)。ユーザーから渡された 512×512 の画像(中央の大きな丸から5つの丸へ
// 線が伸びるネットワーク図)を、その座標のまま塗りつぶしの図形に書き起こした。
// ビューア(VIEWER_ICON。吹き出し)とは別の見た目にして区別する。
export const HUB_ICON = `
<svg viewBox="0 0 512 512" width="18" height="18" fill="currentColor"
     xmlns="http://www.w3.org/2000/svg">
  <circle cx="263" cy="257" r="75" />
  <circle cx="411" cy="57" r="57" />
  <circle cx="79" cy="113" r="45" />
  <circle cx="432" cy="286" r="46" />
  <circle cx="129" cy="437" r="61" />
  <circle cx="397" cy="455" r="51" />
  <g stroke="currentColor" stroke-width="24" stroke-linecap="butt">
    <line x1="100" y1="130" x2="215" y2="212" />
    <line x1="388" y1="90" x2="303" y2="203" />
    <line x1="335" y1="264" x2="390" y2="276" />
    <line x1="218" y1="322" x2="163" y2="395" />
    <line x1="300" y1="318" x2="376" y2="418" />
  </g>
</svg>`;

// 設定(/settings)。Material Icons の「DisplaySettings」(ユーザー指示。MUI の
// `@mui/icons-material` `DisplaySettings` のパスをそのまま使う。MIT ライセンス)。
// 他の線画アイコンと違い塗りつぶしの図形で、viewBox も MUI の 24×24 のまま
// (表示サイズは width/height で 18 にそろえる)。
export const SETTINGS_ICON = `
<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"
     xmlns="http://www.w3.org/2000/svg">
  <path d="M20 3H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h4v2h8v-2h4c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2m0 14H4V5h16z" />
  <path d="M6 8.25h8v1.5H6zm10.5 1.5H18v-1.5h-1.5V7H15v4h1.5zm-6.5 2.5h8v1.5h-8zM7.5 15H9v-4H7.5v1.25H6v1.5h1.5z" />
</svg>`;

// Claude(/claude)。Claude のシンボルマーク(ユーザー指示。Wikimedia Commons の
// `Claude_AI_symbol.svg` のパスをそのまま使う)。原本は橙色の塗りだが、dock の
// 他のアイコンと同様に通常/hover/active の配色を効かせるため currentColor にする。
export const CLAUDE_SETTINGS_ICON = `
<svg viewBox="0 0 100 100" width="18" height="18" fill="currentColor"
     xmlns="http://www.w3.org/2000/svg">
  <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
</svg>`;

export const SAVE_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <path d="M4 3h10l3 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
  <path d="M6 3v5h7V3" />
  <rect x="6" y="12" width="8" height="5" />
</svg>`;

// CLAUDE.mdタブの表示モード(editor/split/preview)切替アイコン。送信モード
// (MODE_ICON)とは別の見た目にして混同を避ける(issue #59)。
export const VIEW_MODE_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="4" width="14" height="12" rx="1.5" />
  <line x1="10" y1="4" x2="10" y2="16" />
</svg>`;
