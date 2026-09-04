/**
 * /ui の各ページが自分自身のデザイントークンを使うための参照ヘルパー。
 * hex を直書きせず、必ず src/data のトークン定義から引く(規約 §4)。
 */

import { roleColor } from "@/data/uiDesign";
import { FONT_WEIGHTS, TEXT_STYLE_GROUPS } from "@/data/uiTypography";

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

export type TextStyleSx = {
  fontSize: string;
  fontWeight: number;
  lineHeight: string;
  letterSpacing: string;
  fontFamily?: string;
};

/** テキストスタイル名から sx に渡せるスタイルを作る。 */
export function textStyle(name: string): TextStyleSx {
  const style = TEXT_STYLE_GROUPS.flatMap((g) => g.styles).find(
    (s) => s.name === name,
  );
  if (!style) throw new Error("未定義のテキストスタイルです: " + name);
  const weight = FONT_WEIGHTS.find((w) => w.level === style.weight);
  return {
    fontSize: style.sizePx + "px",
    fontWeight: weight ? weight.value : 400,
    lineHeight: style.lineHeight,
    letterSpacing: style.tracking,
  };
}
