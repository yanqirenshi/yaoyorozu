"use client";

import { ICON_DRAWING_SPEC, ICON_SAMPLES } from "@/data/uiIcon";

/**
 * 部品「アイコン」。
 * 図形は src/data/uiIcon.ts の ICON_SAMPLES から引き、作図の共通仕様
 * (ビューボックス・線幅・線端・currentColor)はここで一括して与える。
 * 装飾として扱うため、支援技術からは常に隠す。意味はラベル側で伝える。
 */
export default function Icon({ name, size }: { name: string; size: number }) {
  const icon = ICON_SAMPLES.find((i) => i.key === name);
  if (!icon) throw new Error("未定義のアイコンです: " + name);

  return (
    <svg
      viewBox={ICON_DRAWING_SPEC.viewBox}
      width={size}
      height={size}
      fill={ICON_DRAWING_SPEC.fill}
      stroke={ICON_DRAWING_SPEC.stroke}
      strokeWidth={ICON_DRAWING_SPEC.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
      // 図形は data が持つマークアップ文字列(uiIcon.ts)。
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}
