/**
 * /ui の各ページが自分自身のデザイントークンを使うための参照ヘルパー。
 * hex を直書きせず、必ず src/data のトークン定義から引く(規約 §4)。
 */

import { roleColor } from "@/data/uiDesign";

// テキストスタイルの解決は部品(src/components/)と共用する。
export { textStyle, type TextStyleSx } from "@/components/tokens";

export const BORDER = roleColor("border.default");
export const BORDER_STRONG = roleColor("border.strong");
export const SURFACE_BASE = roleColor("surface.base");
export const SURFACE_RAISED = roleColor("surface.raised");
export const SURFACE_SUNKEN = roleColor("surface.sunken");
export const TEXT_PRIMARY = roleColor("text.primary");
export const TEXT_SECONDARY = roleColor("text.secondary");
export const TEXT_INVERSE = roleColor("text.inverse");
export const LINK_COLOR = roleColor("link.default");
export const FOCUS_RING = roleColor("focus.ring");
export const STATE_HOVER = roleColor("state.hover");
