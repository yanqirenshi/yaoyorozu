/**
 * デザイントークン名から値を引くヘルパー。
 * 部品(src/components/)と /ui の説明ページの両方から使う。
 * 値は必ず src/data/ui*.ts から引き、ここに書き写さない(規約 web.md §4)。
 */

import { CORNER_SCALE } from "@/data/uiCorner";
import { ICON_SIZES } from "@/data/uiIcon";
import { SPACING_SCALE } from "@/data/uiSpacing";
import { FONT_WEIGHTS, TEXT_STYLE_GROUPS } from "@/data/uiTypography";

/** 余白トークン(sp-4 など)を px の数値にする。 */
export function spacePx(token: string): number {
  const found = SPACING_SCALE.find((s) => s.token === token);
  if (!found) throw new Error("未定義の余白トークンです: " + token);
  return found.px;
}

/** 角丸トークン(radius-4 など)を CSS の値にする。 */
export function radiusCss(token: string): string {
  const found = CORNER_SCALE.find((c) => c.token === token);
  if (!found) throw new Error("未定義の角丸トークンです: " + token);
  return found.px >= 9999 ? "9999px" : found.px + "px";
}

/** アイコンのサイズトークン(icon-20 など)を px の数値にする。 */
export function iconPx(token: string): number {
  const found = ICON_SIZES.find((i) => i.token === token);
  if (!found) throw new Error("未定義のアイコンサイズです: " + token);
  return found.px;
}

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
