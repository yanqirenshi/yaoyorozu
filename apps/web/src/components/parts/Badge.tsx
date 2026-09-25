"use client";

import Box from "@mui/material/Box";
import {
  BADGE_SHAPE,
  BADGE_SIZES,
  BADGE_TONES,
  type BadgeSize,
  type BadgeTone,
} from "@/data/uiBadge";
import { resolveColor } from "@/data/uiDesign";
import { radiusCss, spacePx, textStyle } from "@/components/tokens";

/**
 * 部品「バッジ」。対象がいまどの状態にあるかを短い文字で示す。
 * 見た目は src/data/uiBadge.ts の仕様だけから決まり、ここには値を持たない。
 * 仕様は /ui の「パーツ > 部品 > バッジ」。
 */

export type BadgeProps = {
  /** 状態の種類。意味で選ぶ(見た目で選ばない)。 */
  tone: BadgeTone;
  /** 状態を表す短い名詞。 */
  label: string;
  size?: BadgeSize;
};

function toneSpec(tone: BadgeTone) {
  const spec = BADGE_TONES.find((t) => t.key === tone);
  if (!spec) throw new Error("未定義のバッジのトーンです: " + tone);
  return spec;
}

function sizeSpec(size: BadgeSize) {
  const spec = BADGE_SIZES.find((s) => s.key === size);
  if (!spec) throw new Error("未定義のバッジのサイズです: " + size);
  return spec;
}

/** バッジ1つ分の見た目の sx。/ui の見本と共用する。 */
export function badgeSx(tone: BadgeTone, size: BadgeSize) {
  const t = toneSpec(tone);
  const s = sizeSpec(size);
  return {
    display: "inline-flex",
    alignItems: "center",
    // 幅はラベルの文字に合わせる(一覧の中で伸びない)。
    width: "fit-content",
    flexShrink: 0,
    height: s.heightPx + "px",
    px: spacePx(s.paddingX) + "px",
    borderRadius: radiusCss(BADGE_SHAPE.radius),
    // 境界は持たない(境界を持つボタンと形で区別する)。
    border: "none",
    whiteSpace: "nowrap",
    ...textStyle(s.textStyle),
    backgroundColor: resolveColor(t.bg).value,
    color: resolveColor(t.fg).value,
  };
}

export default function Badge({ tone, label, size = "medium" }: BadgeProps) {
  return (
    <Box component="span" sx={badgeSx(tone, size)}>
      {label}
    </Box>
  );
}
