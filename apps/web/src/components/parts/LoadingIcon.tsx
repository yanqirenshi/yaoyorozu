"use client";

import Box from "@mui/material/Box";
import { Ring } from "loading-dev";
import {
  LOADING_A11Y,
  LOADING_COLOR,
  LOADING_SIZES,
  LOADING_VARIANT,
  type LoadingSize,
} from "@/data/uiLoading";
import { iconPx } from "@/components/tokens";

/**
 * 部品「ローディングアイコン」。読み込み中であることを示す。
 * 図形と動きは loading.dev(loading-dev)の Ring をそのまま使い、
 * 大きさ・色・速さの設定だけを仕様(src/data/uiLoading.ts)から与える。
 * 仕様は /ui の「パーツ > 部品 > ローディング」。
 */

export type LoadingIconProps = {
  size?: LoadingSize;
  /** 何を読み込んでいるかを表す名前。省略時は「読み込み中」。 */
  label?: string;
  /**
   * 止める必要がある場面のためだけに渡す。
   * 通常は渡さない(回転は進行中であることを示す唯一の手がかり)。
   */
  playState?: "paused" | "running";
};

function sizeSpec(size: LoadingSize) {
  const spec = LOADING_SIZES.find((s) => s.key === size);
  if (!spec) throw new Error("未定義のローディングのサイズです: " + size);
  return spec;
}

/** サイズトークンから px を引く。/ui の見本と共用する。 */
export function loadingPx(size: LoadingSize) {
  return iconPx(sizeSpec(size).iconToken);
}

export default function LoadingIcon({
  size = "medium",
  label,
  playState,
}: LoadingIconProps) {
  const px = loadingPx(size);
  return (
    <Box
      component="span"
      role={LOADING_A11Y.role}
      aria-live={LOADING_A11Y.ariaLive as "polite"}
      aria-label={label ?? LOADING_A11Y.label}
      sx={{
        display: "inline-flex",
        width: px + "px",
        height: px + "px",
        // 色は置いた場所の文字色を継ぐ(仕様 LOADING_COLOR)。
        color: LOADING_COLOR.value,
      }}
    >
      <Ring
        size={px}
        cap={LOADING_VARIANT.cap as "round"}
        easing={LOADING_VARIANT.easing as "linear"}
        duration={LOADING_VARIANT.durationMs}
        playState={playState}
      />
    </Box>
  );
}
