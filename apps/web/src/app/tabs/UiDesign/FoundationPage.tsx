"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import {
  BORDER,
  LINK_COLOR,
  SURFACE_RAISED,
  SURFACE_SUNKEN,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  textStyle,
} from "./tokens";

/** 1ページ分の節。children を持つ場合は目次に第2階層として並ぶ。 */
export type DocSection = {
  id: string;
  title: string;
  body?: ReactNode;
  children?: DocSection[];
};

export type FoundationPageProps = {
  title: string;
  lead: ReactNode;
  sections: DocSection[];
};

/** 本文の段落。 */
export function Para({ children }: { children: ReactNode }) {
  return (
    <Box component="p" sx={{ ...textStyle("Body-16N-170"), mb: "16px" }}>
      {children}
    </Box>
  );
}

/** 補足の段落(副次テキスト)。 */
export function Note({ children }: { children: ReactNode }) {
  return (
    <Box
      component="p"
      sx={{
        ...textStyle("Body-14N-170"),
        color: TEXT_SECONDARY,
        mb: "16px",
      }}
    >
      {children}
    </Box>
  );
}

/** 箇条書き。 */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <Box
      component="ul"
      sx={{
        ...textStyle("Body-16N-170"),
        mb: "16px",
        pl: "20px",
        // Bulma が ul に list-style: none を当てるため、ここで指定し直す。
        listStyleType: "disc",
      }}
    >
      {items.map((item, index) => (
        <li key={index} className="mb-1">
          {item}
        </li>
      ))}
    </Box>
  );
}

/** インラインのコード・トークン名。 */
export function Code({ children }: { children: ReactNode }) {
  return (
    <Box
      component="code"
      sx={{
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: "14px",
        // Bulma が code 要素に赤系の文字色を当てるため、明示的に上書きする。
        color: TEXT_PRIMARY,
        backgroundColor: SURFACE_SUNKEN,
        border: "1px solid " + BORDER,
        borderRadius: "4px",
        px: "4px",
        py: "1px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Box>
  );
}

export type TokenTableColumn = {
  key: string;
  label: string;
  /** 数値・トークン名など、等幅で見せたい列。 */
  mono?: boolean;
  width?: string;
};

/** トークン表。 */
export function TokenTable({
  columns,
  rows,
}: {
  columns: TokenTableColumn[];
  rows: Record<string, ReactNode>[];
}) {
  return (
    <Box
      className="mb-6 overflow-x-auto"
      sx={{ border: "1px solid " + BORDER, borderRadius: "8px" }}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                sx={{
                  ...textStyle("Dns-14B-150"),
                  borderColor: BORDER,
                  width: column.width,
                  whiteSpace: "nowrap",
                }}
              >
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  sx={{
                    ...textStyle("Dns-14N-150"),
                    borderColor: BORDER,
                    verticalAlign: "top",
                    fontFamily: column.mono
                      ? "var(--font-geist-mono), ui-monospace, monospace"
                      : undefined,
                  }}
                >
                  {row[column.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/** 作例の枠。 */
export function Sample({
  caption,
  children,
  surface = "raised",
}: {
  caption?: ReactNode;
  children: ReactNode;
  surface?: "raised" | "base" | "sunken";
}) {
  const backgroundColor =
    surface === "sunken"
      ? SURFACE_SUNKEN
      : surface === "base"
        ? "transparent"
        : SURFACE_RAISED;

  return (
    <figure className="mb-6">
      <Box
        sx={{
          border: "1px solid " + BORDER,
          borderRadius: "8px",
          backgroundColor,
          p: "24px",
        }}
      >
        {children}
      </Box>
      {caption && (
        <Box
          component="figcaption"
          sx={{
            ...textStyle("Body-14N-170"),
            color: TEXT_SECONDARY,
            mt: "8px",
          }}
        >
          {caption}
        </Box>
      )}
    </figure>
  );
}

/** ルールの一覧(見出し + 説明)。 */
export function RuleList({
  rules,
}: {
  rules: { title: string; body: string }[];
}) {
  return (
    <Box component="dl" className="mb-6">
      {rules.map((rule) => (
        <div key={rule.title} className="mb-4">
          <Box component="dt" sx={{ ...textStyle("Head-16B-150"), mb: "4px" }}>
            {rule.title}
          </Box>
          <Box component="dd" sx={{ ...textStyle("Body-16N-170"), ml: 0 }}>
            {rule.body}
          </Box>
        </div>
      ))}
    </Box>
  );
}

function SectionBlock({
  section,
  level,
}: {
  section: DocSection;
  level: 2 | 3;
}) {
  return (
    <Box
      component="section"
      id={section.id}
      sx={{ scrollMarginTop: "24px", mt: level === 2 ? "48px" : "32px" }}
    >
      <Box
        component={level === 2 ? "h2" : "h3"}
        sx={{
          ...textStyle(level === 2 ? "Head-24B-150" : "Head-20B-150"),
          mb: level === 2 ? "16px" : "12px",
          pb: level === 2 ? "8px" : 0,
          borderBottom: level === 2 ? "1px solid " + BORDER : undefined,
        }}
      >
        {section.title}
      </Box>
      {section.body}
      {section.children?.map((child) => (
        <SectionBlock key={child.id} section={child} level={3} />
      ))}
    </Box>
  );
}

/** 「このページの目次」。 */
function Toc({ sections }: { sections: DocSection[] }) {
  return (
    <Box
      component="nav"
      aria-label="このページの目次"
      sx={{
        border: "1px solid " + BORDER,
        borderRadius: "8px",
        backgroundColor: SURFACE_SUNKEN,
        p: "16px",
        mt: "24px",
      }}
    >
      <Box sx={{ ...textStyle("Head-16B-150"), mb: "8px" }}>このページの目次</Box>
      <Box component="ul" sx={{ ...textStyle("Body-14N-170") }}>
        {sections.map((section) => (
          <li key={section.id}>
            <Box
              component="a"
              href={"#" + section.id}
              sx={{ color: LINK_COLOR, textDecoration: "underline" }}
            >
              {section.title}
            </Box>
            {section.children && (
              <Box component="ul" sx={{ pl: "16px" }}>
                {section.children.map((child) => (
                  <li key={child.id}>
                    <Box
                      component="a"
                      href={"#" + child.id}
                      sx={{ color: LINK_COLOR, textDecoration: "underline" }}
                    >
                      {child.title}
                    </Box>
                  </li>
                ))}
              </Box>
            )}
          </li>
        ))}
      </Box>
    </Box>
  );
}

/** 基本デザインの1ページ分の枠。 */
export default function FoundationPage({
  title,
  lead,
  sections,
}: FoundationPageProps) {
  return (
    <Box component="article" className="w-full" sx={{ maxWidth: "1080px" }}>
      <Box component="h1" sx={{ ...textStyle("Disp-32B-140"), mb: "16px" }}>
        {title}
      </Box>
      <Box sx={{ ...textStyle("Body-16N-170") }}>{lead}</Box>
      {sections.length > 0 && <Toc sections={sections} />}
      {sections.map((section) => (
        <SectionBlock key={section.id} section={section} level={2} />
      ))}
      <Box sx={{ height: "64px" }} />
    </Box>
  );
}
