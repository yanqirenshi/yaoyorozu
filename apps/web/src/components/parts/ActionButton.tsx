"use client";

import type { MouseEventHandler } from "react";
import ButtonBase from "@mui/material/ButtonBase";
import {
  BUTTON_FOCUS,
  BUTTON_KINDS,
  BUTTON_SIZES,
  type ButtonKind,
  type ButtonSize,
  type ButtonState,
} from "@/data/uiButton";
import { resolveColor } from "@/data/uiDesign";
import { radiusCss, spacePx, textStyle } from "@/components/tokens";

/**
 * 追加ボタン・変更ボタンの共通の土台。
 * 見た目は src/data/uiButton.ts の仕様だけから決まり、ここには値を持たない。
 * 画面から直接使わず、AddButton / EditButton を使う。
 */

export type ActionButtonProps = {
  size?: ButtonSize;
  /** 省略時は種類ごとの既定のラベル(追加 / 変更)。 */
  label?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

function kindSpec(kind: ButtonKind) {
  const spec = BUTTON_KINDS.find((k) => k.key === kind);
  if (!spec) throw new Error("未定義のボタンの種類です: " + kind);
  return spec;
}

function sizeSpec(size: ButtonSize) {
  const spec = BUTTON_SIZES.find((s) => s.key === size);
  if (!spec) throw new Error("未定義のボタンのサイズです: " + size);
  return spec;
}

/** 状態ごとの色を CSS の値に解決する。 */
export function buttonColors(kind: ButtonKind, state: ButtonState) {
  const colors = kindSpec(kind).colors[state];
  return {
    bg: resolveColor(colors.bg).value,
    fg: resolveColor(colors.fg).value,
    border: resolveColor(colors.border).value,
  };
}

function colorSx(kind: ButtonKind, state: ButtonState) {
  const c = buttonColors(kind, state);
  const shadow = kindSpec(kind).textShadow;
  return {
    backgroundColor: c.bg,
    color: c.fg,
    borderColor: c.border,
    // 陰は文字を読みやすくするためのもの。無効の状態では付けない。
    textShadow:
      shadow && state !== "disabled"
        ? "0 0 " + shadow.blur + " " + resolveColor(shadow.color).value
        : "none",
  };
}

/** 寸法(サイズ)の sx。 */
function sizeSx(size: ButtonSize) {
  const s = sizeSpec(size);
  return {
    ...textStyle(s.textStyle),
    height: s.heightPx + "px",
    px: spacePx(s.paddingX) + "px",
    borderRadius: radiusCss(s.radius),
  };
}

const focusRingSx = {
  outline:
    BUTTON_FOCUS.width + " solid " + resolveColor(BUTTON_FOCUS.color).value,
  outlineOffset: BUTTON_FOCUS.offset,
};

/**
 * 状態を固定した見た目の sx。/ui の説明ページで状態ごとの見本を並べるために使う。
 * 実際のボタンは下の ActionButton が、ホバー等を CSS の擬似クラスで切り替える。
 */
export function buttonStaticSx(
  kind: ButtonKind,
  size: ButtonSize,
  state: ButtonState | "focus",
) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid",
    whiteSpace: "nowrap",
    ...sizeSx(size),
    ...colorSx(kind, state === "focus" ? "default" : state),
    ...(state === "focus" ? focusRingSx : {}),
  };
}

/** ボタンの中身(ラベルのみ。アイコンは付けない)。 */
export function ButtonContent({
  kind,
  label,
}: {
  kind: ButtonKind;
  label?: string;
}) {
  return <span>{label ?? kindSpec(kind).defaultLabel}</span>;
}

export default function ActionButton({
  kind,
  size = "medium",
  label,
  disabled = false,
  type = "button",
  onClick,
}: ActionButtonProps & { kind: ButtonKind }) {
  return (
    <ButtonBase
      type={type}
      disabled={disabled}
      onClick={onClick}
      disableRipple
      sx={{
        ...buttonStaticSx(kind, size, "default"),
        transition: "background-color 120ms, border-color 120ms",
        "&:hover:not(.Mui-disabled)": colorSx(kind, "hover"),
        "&:active:not(.Mui-disabled)": colorSx(kind, "active"),
        "&.Mui-focusVisible": focusRingSx,
        "&.Mui-disabled": {
          ...colorSx(kind, "disabled"),
          // MUI は disabled で pointer-events を切るため、カーソルを出すために戻す。
          pointerEvents: "auto",
          cursor: "not-allowed",
        },
      }}
    >
      <ButtonContent kind={kind} label={label} />
    </ButtonBase>
  );
}
