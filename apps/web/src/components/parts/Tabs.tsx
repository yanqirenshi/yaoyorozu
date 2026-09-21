"use client";

import Box from "@mui/material/Box";
import MuiTab from "@mui/material/Tab";
import MuiTabs from "@mui/material/Tabs";
import {
  TAB_BAR,
  TAB_COLORS,
  TAB_FOCUS,
  TAB_INDICATOR,
  TAB_LABEL,
  TAB_SIZES,
  type TabSize,
  type TabState,
} from "@/data/uiTab";
import { resolveColor } from "@/data/uiDesign";
import { spacePx, textStyle } from "@/components/tokens";

/**
 * 部品「タブ」。同じ領域の中で表示する内容を切り替える。
 * 仕様は /ui の「パーツ > 部品 > タブ」(src/data/uiTab.ts)。
 * 見た目は仕様だけから決まり、ここには値を持たない。
 * キーボード操作(矢印キーでの移動・Enter/Space での選択)は MUI Tabs に任せる。
 * 選択中の値は持たず、親から受け取る(部品はデータも状態も持たない)。
 */

export type TabItem = {
  key: string;
  label: string;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  /** 選択中のタブの key。 */
  value: string;
  onChange: (key: string) => void;
  size?: TabSize;
  /** 何を切り替えるタブか(例: 「表示の切り替え」)。支援技術に読み上げられる。 */
  "aria-label": string;
  /**
   * 指定すると、タブとパネルを id で結ぶ。
   * タブは `${idPrefix}-tab-${key}`、パネルは `${idPrefix}-panel-${key}` とし、
   * パネル側は role="tabpanel" と aria-labelledby をこの id で持たせる。
   */
  idPrefix?: string;
};

function sizeSpec(size: TabSize) {
  const spec = TAB_SIZES.find((s) => s.key === size);
  if (!spec) throw new Error("未定義のタブのサイズです: " + size);
  return spec;
}

function colorSx(state: TabState) {
  const c = TAB_COLORS[state];
  return {
    backgroundColor: resolveColor(c.bg).value,
    color: resolveColor(c.fg).value,
  };
}

const focusRingSx = {
  outline: TAB_FOCUS.width + " solid " + resolveColor(TAB_FOCUS.color).value,
  outlineOffset: TAB_FOCUS.offset,
};

/** タブ1つ分の寸法の sx。 */
function tabSizeSx(size: TabSize) {
  const s = sizeSpec(size);
  return {
    ...textStyle(s.textStyle),
    height: s.heightPx + "px",
    minHeight: s.heightPx + "px",
    px: spacePx(s.paddingX) + "px",
    py: 0,
    minWidth: 0,
    maxWidth: "none",
    textTransform: "none",
    opacity: 1,
    flexShrink: 0,
  };
}

/**
 * 状態を固定したタブ1つ分の見た目の sx。/ui の説明ページで状態の見本を並べるために使う。
 * 選択中の下線は、見本では下の境界線で表す。
 */
export function tabStaticSx(size: TabSize, state: TabState | "focus") {
  const selected = state === "selected" || state === "selectedHover";
  return {
    display: "inline-flex",
    alignItems: "center",
    ...tabSizeSx(size),
    ...colorSx(state === "focus" ? "default" : state),
    boxShadow: selected
      ? "inset 0 -" +
        TAB_INDICATOR.heightPx +
        "px 0 " +
        resolveColor(TAB_INDICATOR.color).value
      : "none",
    ...(state === "focus" ? focusRingSx : {}),
  };
}

/** ラベル。1行に収め、長いものは末尾を省略する。 */
export function TabLabel({ label }: { label: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: "block",
        maxWidth: TAB_LABEL.maxWidthPx + "px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Box>
  );
}

export default function Tabs({
  items,
  value,
  onChange,
  size = "medium",
  "aria-label": ariaLabel,
  idPrefix,
}: TabsProps) {
  const s = sizeSpec(size);
  const border = resolveColor(TAB_BAR.border).value;

  return (
    <MuiTabs
      value={value}
      onChange={(_, next: string) => onChange(next)}
      aria-label={ariaLabel}
      // 収まらないときは折り返さず横スクロールにし、スクロールできることが見えるようにする。
      variant="scrollable"
      scrollButtons={false}
      visibleScrollbar
      sx={{
        minHeight: s.heightPx + "px",
        px: spacePx(TAB_BAR.paddingX) + "px",
        // 下罫線は影で描き、インジケータをその上に重ねる。
        boxShadow: "inset 0 -1px 0 " + border,
      }}
      slotProps={{
        indicator: {
          sx: {
            height: TAB_INDICATOR.heightPx + "px",
            backgroundColor: resolveColor(TAB_INDICATOR.color).value,
          },
        },
        list: { sx: { gap: spacePx(TAB_BAR.gap) + "px" } },
      }}
    >
      {items.map((item) => (
        <MuiTab
          key={item.key}
          value={item.key}
          label={<TabLabel label={item.label} />}
          // 省略表示されても全体が分かるように、ラベル全体をツールチップに出す。
          title={item.label}
          disabled={item.disabled}
          disableRipple
          id={idPrefix ? idPrefix + "-tab-" + item.key : undefined}
          aria-controls={idPrefix ? idPrefix + "-panel-" + item.key : undefined}
          sx={{
            ...tabSizeSx(size),
            ...colorSx("default"),
            "&:hover": colorSx("hover"),
            // 選択中のタブを押し直したときは、選択中の見た目のままにする。
            "&:not(.Mui-selected):active": colorSx("active"),
            "&.Mui-selected": colorSx("selected"),
            "&.Mui-selected:hover": colorSx("selectedHover"),
            "&.Mui-disabled": colorSx("disabled"),
            "&.Mui-focusVisible": focusRingSx,
          }}
        />
      ))}
    </MuiTabs>
  );
}
