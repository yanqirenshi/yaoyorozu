"use client";

import Box from "@mui/material/Box";
import { resolveColor } from "@/data/uiDesign";
import { BORDER, TEXT_SECONDARY } from "./tokens";

/**
 * 色の参照を「色見本 / トークン名 / CSS 変数名」で表示する。
 * 部品のページで、apps/native が tokens.css から同じ色を引けるように変数名を併記する。
 */
export default function ColorRef({ refName }: { refName: string }) {
  const c = resolveColor(refName);
  return (
    <span className="inline-flex items-center gap-2">
      <Box
        component="span"
        sx={{
          display: "inline-block",
          width: "14px",
          height: "14px",
          borderRadius: "2px",
          border: "1px solid " + BORDER,
          backgroundColor: c.value,
          flexShrink: 0,
        }}
      />
      <span>
        {refName}
        <Box
          component="span"
          sx={{ color: TEXT_SECONDARY, display: "block", fontSize: "12px" }}
        >
          {c.cssVar}
        </Box>
      </span>
    </span>
  );
}
