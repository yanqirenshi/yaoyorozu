"use client";

import Box from "@mui/material/Box";
import FoundationPage, { Para, Sample, type DocSection } from "./FoundationPage";
import IndexPage, { type IndexItem } from "./IndexPage";
import { tone } from "@/data/uiDesign";
import { BORDER, TEXT_SECONDARY, textStyle } from "./tokens";

export const LAYOUT_ITEMS: IndexItem[] = [
  {
    key: "page",
    label: "ページ",
    summary:
      "URL のパスと1対1に対応する画面。共有するコンポーネントを持たず、すべてのページが従う規則を定義する。",
  },
  {
    key: "frame",
    label: "フレーム",
    summary:
      "ページのトップレベルに置く骨格。ビューポートいっぱいの領域を確保し、内側を flex で配る。",
  },
];

const LAYERS = [
  {
    label: "ページ",
    note: "URL と1対1。フレームを置き、製品を並べる",
    fill: tone("京紫", 200),
  },
  {
    label: "フレーム",
    note: "画面の骨格。枠を描くためのデータを取得する",
    fill: tone("京紫", 100),
  },
  {
    label: "製品",
    note: "意味のあるまとまり。ページの内容にあたるデータを取得する",
    fill: tone("墨", 100),
  },
  {
    label: "中間品",
    note: "props だけで動く",
    fill: tone("墨", 50),
  },
  { label: "部品", note: "props だけで動く", fill: "#ffffff" },
];

const SECTIONS: DocSection[] = [
  {
    id: "layout-index-list",
    title: "一覧",
    body: <IndexPage items={LAYOUT_ITEMS} onSelect={() => {}} />,
  },
  {
    id: "layout-index-hierarchy",
    title: "コンポーネントの階層",
    body: (
      <>
        <Para>
          レイアウト(ページ・フレーム)は、コンポーネントの階層の上2段にあたる。
          下の3段(製品・中間品・部品)が中身であり、レイアウトはそれを置く器である。
        </Para>
        <Sample surface="base" caption="上から下へ、大きいものから小さいものへ。">
          <div className="flex flex-col gap-2">
            {LAYERS.map((layer, index) => (
              <Box
                key={layer.label}
                sx={{
                  ml: index * 3 + "px",
                  border: "1px solid " + BORDER,
                  borderRadius: "8px",
                  backgroundColor: layer.fill,
                  px: "16px",
                  py: "12px",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "12px",
                }}
              >
                <Box sx={{ ...textStyle("Head-16B-150"), width: "120px" }}>
                  {layer.label}
                </Box>
                <Box
                  sx={{ ...textStyle("Body-14N-170"), color: TEXT_SECONDARY }}
                >
                  {layer.note}
                </Box>
              </Box>
            ))}
          </div>
        </Sample>
        <Para>
          この階層の意味は、データを取得する層と、しない層を分けることにある。
          取得するのはフレーム(枠を描くためのデータ)と製品(ページの内容にあたるデータ)の2つで、
          中間品と部品は props だけで描画する。そのため中間品と部品は、実データがなくてもカタログに並べられる。
        </Para>
      </>
    ),
  },
];

export default function LayoutIndexPage({
  onSelect,
}: {
  onSelect: (key: string) => void;
}) {
  const sections = SECTIONS.map((section) =>
    section.id === "layout-index-list"
      ? { ...section, body: <IndexPage items={LAYOUT_ITEMS} onSelect={onSelect} /> }
      : section,
  );

  return (
    <FoundationPage
      title="レイアウト"
      lead={
        <Para>
          画面の器にあたる2つのコンポーネント。
          どの画面も、ページがフレームを1つ置き、その中に製品を並べるという形になる。
        </Para>
      }
      sections={sections}
    />
  );
}
