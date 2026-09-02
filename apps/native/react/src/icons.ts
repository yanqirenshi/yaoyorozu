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

export const SETTINGS_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <circle cx="10" cy="10" r="2.5" />
  <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.41 1.41M13.54 13.54l1.41 1.41M5.05 14.95l1.41-1.41M13.54 6.46l1.41-1.41" />
</svg>`;

export const CLAUDE_SETTINGS_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <path d="M6 3h5l4 4v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
  <path d="M11 3v4h4" />
  <path d="M8.3 11.3c-.9 0-1.3.4-1.3 1.2s.4 1.2 1.3 1.2M11.7 11.3c.9 0 1.3.4 1.3 1.2s-.4 1.2-1.3 1.2" />
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

// dockのプロファイル切り替えトリガー用アイコン(issue #72)。
export const PROFILE_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <circle cx="10" cy="7" r="3" />
  <path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
</svg>`;
