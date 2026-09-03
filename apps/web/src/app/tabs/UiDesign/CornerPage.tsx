"use client";

import Box from "@mui/material/Box";
import {
  CORNER_RULES,
  CORNER_SCALE,
  PARTIAL_CORNER_EXAMPLES,
} from "@/data/uiCorner";
import { tone } from "@/data/uiDesign";
import FoundationPage, {
  Note,
  Para,
  RuleList,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { BORDER, TEXT_SECONDARY, textStyle } from "./tokens";

const FILL = tone("京紫", 100);
const EDGE = tone("京紫", 400);

function radiusCss(px: number) {
  return px >= 9999 ? "9999px" : px + "px";
}

const SECTIONS: DocSection[] = [
  {
    id: "corner-scale",
    title: "角の形状とサイズ",
    body: (
      <>
        <Para>
          角丸は5段階と完全な円弧(full)の計6種類。要素の高さ・面積に応じて割り当てる。
          同じ半径でも小さい図形ほど丸く見えるため、サイズが変われば段階も変える。
        </Para>
        <TokenTable
          columns={[
            { key: "sample", label: "", width: "80px" },
            { key: "token", label: "トークン", mono: true },
            { key: "px", label: "半径", mono: true },
            { key: "label", label: "名称" },
            { key: "tailwind", label: "Tailwind", mono: true },
            { key: "usage", label: "用途" },
          ]}
          rows={CORNER_SCALE.map((c) => ({
            sample: (
              <Box
                sx={{
                  width: "56px",
                  height: "32px",
                  backgroundColor: FILL,
                  border: "1px solid " + EDGE,
                  borderRadius: radiusCss(c.px),
                }}
              />
            ),
            token: c.token,
            px: c.px >= 9999 ? "9999px" : c.px + "px",
            label: c.label,
            tailwind: c.tailwind,
            usage: c.usage,
          }))}
        />
      </>
    ),
  },
  {
    id: "corner-size",
    title: "面積に応じた半径",
    body: (
      <>
        <Para>
          上段は3つの図形にすべて radius-8 を適用したもの。小さい図形ほど丸く、大きい図形ほど角ばって見える。
          下段は面積に応じて radius-4 / radius-8 / radius-12 を割り当てたもので、まるみの印象がそろう。
        </Para>
        <Sample surface="base" caption="上段: 半径を固定。下段: 面積に応じて半径を変えた状態。">
          <div className="flex flex-col gap-6">
            {[
              { label: "半径を固定(すべて radius-8)", radii: [8, 8, 8] },
              { label: "面積に応じて変える", radii: [4, 8, 12] },
            ].map((row) => (
              <div key={row.label}>
                <Box
                  sx={{
                    ...textStyle("Dns-14B-150"),
                    color: TEXT_SECONDARY,
                    mb: "8px",
                  }}
                >
                  {row.label}
                </Box>
                <div className="flex items-end gap-4">
                  {[
                    { w: 64, h: 32 },
                    { w: 140, h: 88 },
                    { w: 240, h: 140 },
                  ].map((size, index) => (
                    <Box
                      key={size.w}
                      sx={{
                        width: size.w + "px",
                        height: size.h + "px",
                        backgroundColor: FILL,
                        border: "1px solid " + EDGE,
                        borderRadius: row.radii[index] + "px",
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "corner-nesting",
    title: "入れ子の角丸",
    body: (
      <>
        <Para>
          面の中に面を置くときは、内側の半径を外側より小さくする。
          外側の半径から内側の余白を引いた値が、内側の半径の上限になる。
        </Para>
        <Sample
          surface="base"
          caption="左: 外側 radius-8 / 余白 sp-2 / 内側 radius-4(適切)。右: 内側の半径が外側と同じで、角に隙間が見える状態。"
        >
          <div className="flex flex-wrap gap-6">
            {[
              { label: "適切", inner: 4 },
              { label: "不適切", inner: 8 },
            ].map((pattern) => (
              <Box
                key={pattern.label}
                sx={{
                  backgroundColor: FILL,
                  border: "1px solid " + EDGE,
                  borderRadius: "8px",
                  p: "8px",
                }}
              >
                <Box
                  sx={{
                    backgroundColor: "#ffffff",
                    border: "1px solid " + BORDER,
                    borderRadius: pattern.inner + "px",
                    px: "24px",
                    py: "16px",
                    ...textStyle("Dns-14N-150"),
                  }}
                >
                  内側 radius-{pattern.inner}({pattern.label})
                </Box>
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "corner-emphasis",
    title: "角の形状の違いによる強調",
    body: (
      <>
        <Para>
          並んだ要素の中で1つだけ形状を変えると、その要素が浮いて見える。
          ただし形だけで意味を伝えないこと。強調には文言・色・位置のいずれかを必ず併用する。
        </Para>
        <Sample surface="base" caption="3つ目だけ radius-full にした状態。">
          <div className="flex flex-wrap items-center gap-3">
            {[4, 4, 9999, 4].map((radius, index) => (
              <Box
                key={index}
                sx={{
                  ...textStyle("UI-14M-100"),
                  backgroundColor: index === 2 ? EDGE : FILL,
                  color: index === 2 ? "#ffffff" : undefined,
                  border: "1px solid " + EDGE,
                  borderRadius: radiusCss(radius),
                  px: "16px",
                  py: "10px",
                }}
              >
                項目 {index + 1}
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "corner-partial",
    title: "全体的な角丸と部分的な角丸",
    body: (
      <>
        <Para>
          面と面が接続している箇所は、接続側の角を角(radius-0)にする。
          タブとパネル、ボタングループのように「つながっている」ことを形で示す。
        </Para>
        <TokenTable
          columns={[
            { key: "target", label: "箇所" },
            { key: "value", label: "border-radius", mono: true },
            { key: "note", label: "備考" },
          ]}
          rows={PARTIAL_CORNER_EXAMPLES.map((e) => ({
            target: e.target,
            value: e.value,
            note: e.note,
          }))}
        />
        <Sample surface="base" caption="タブとパネルの接続。選択中のタブは下側の角を持たない。">
          <div>
            <div className="flex gap-1">
              {["図", "WBS"].map((label, index) => (
                <Box
                  key={label}
                  sx={{
                    ...textStyle("UI-14M-100"),
                    backgroundColor: index === 0 ? "#ffffff" : FILL,
                    border: "1px solid " + BORDER,
                    borderBottom: index === 0 ? "1px solid #ffffff" : undefined,
                    borderRadius: "8px 8px 0 0",
                    px: "16px",
                    py: "10px",
                    position: "relative",
                    top: "1px",
                  }}
                >
                  {label}
                </Box>
              ))}
            </div>
            <Box
              sx={{
                border: "1px solid " + BORDER,
                borderRadius: "0 8px 8px 8px",
                backgroundColor: "#ffffff",
                p: "16px",
                ...textStyle("Dns-14N-150"),
              }}
            >
              パネルの内容
            </Box>
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "corner-rules",
    title: "運用ルール",
    body: (
      <>
        <RuleList rules={CORNER_RULES} />
        <Note>
          アプリシェル(左メニューと本体の区切り)には角丸を使わない。
          面が画面端まで届いている構造では、角丸はかえって「浮いた小さなカード」に見えてしまう。
        </Note>
      </>
    ),
  },
];

export default function CornerPage() {
  return (
    <FoundationPage
      title="角の形状"
      lead={
        <>
          <Para>
            角の形状は、その要素が「操作するもの」なのか「面としてのまとまり」なのかを、文字を読む前に伝える。
            角丸が大きいほど親しみやすく、小さいほど機能的・情報的に見える。
          </Para>
          <Para>
            YAOYOROZU は作業のための道具であり、まるみは控えめに使う。
            操作要素は radius-4、面は radius-8 を基本とし、構造としての区切り(ペイン・表)には角丸を使わない。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
