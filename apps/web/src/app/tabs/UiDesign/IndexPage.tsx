"use client";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import { BORDER, STATE_HOVER, TEXT_SECONDARY, textStyle } from "./tokens";

export type IndexItem = {
  key: string;
  label: string;
  summary: string;
};

/** 子ページへのカード一覧。分類ページの目次として使う。 */
export default function IndexPage({
  items,
  onSelect,
}: {
  items: IndexItem[];
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ButtonBase
          key={item.key}
          onClick={() => onSelect(item.key)}
          sx={{
            display: "block",
            textAlign: "left",
            border: "1px solid " + BORDER,
            borderRadius: "8px",
            p: "16px",
            "&:hover": { backgroundColor: STATE_HOVER },
          }}
        >
          <Box sx={{ ...textStyle("Head-18B-150"), mb: "4px" }}>
            {item.label}
          </Box>
          <Box sx={{ ...textStyle("Body-14N-170"), color: TEXT_SECONDARY }}>
            {item.summary}
          </Box>
        </ButtonBase>
      ))}
    </div>
  );
}
