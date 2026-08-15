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

export const NAV_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="3" width="14" height="14" rx="2" />
  <line x1="3" y1="8" x2="17" y2="8" />
</svg>`;
