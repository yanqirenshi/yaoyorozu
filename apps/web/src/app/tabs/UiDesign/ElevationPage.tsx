"use client";

import Box from "@mui/material/Box";
import {
  ELEVATION_RULES,
  ELEVATION_SCALE,
  OVERLAY_SHADE,
} from "@/data/uiElevation";
import FoundationPage, {
  Code,
  Note,
  Para,
  RuleList,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { BORDER, TEXT_SECONDARY, textStyle } from "./tokens";

const SECTIONS: DocSection[] = [
  {
    id: "elevation-scale",
    title: "高さレベル",
    body: (
      <>
        <Para>
          高さレベルは0から5の6段階。既定値はレベル0で、影を持たない。
          影の色は黒ではなく墨(#373737)の透過を使い、真珠の地の上で色味が濁らないようにしている。
        </Para>
        <TokenTable
          columns={[
            { key: "level", label: "レベル", mono: true, width: "72px" },
            { key: "token", label: "トークン", mono: true },
            { key: "label", label: "名称" },
            { key: "shadow", label: "box-shadow", mono: true },
            { key: "usage", label: "用途" },
          ]}
          rows={ELEVATION_SCALE.map((e) => ({
            level: String(e.level),
            token: e.token,
            label: e.label,
            shadow: e.shadow,
            usage: e.usage,
          }))}
        />
        <Sample surface="base" caption="地の面(真珠)の上に置いた各レベル。">
          <div className="flex flex-wrap gap-6">
            {ELEVATION_SCALE.map((e) => (
              <Box
                key={e.token}
                sx={{
                  width: "132px",
                  height: "88px",
                  backgroundColor: "#ffffff",
                  border: "1px solid " + BORDER,
                  borderRadius: "8px",
                  boxShadow: e.shadow,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <Box sx={{ ...textStyle("Head-16B-150") }}>レベル {e.level}</Box>
                <Box
                  sx={{ ...textStyle("Dns-14N-150"), color: TEXT_SECONDARY }}
                >
                  {e.label}
                </Box>
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "elevation-relative",
    title: "高さレベルは相対値",
    body: (
      <>
        <Para>
          高さレベルは絶対的な高さではなく、直下にある面からの相対値である。
          レベル1のカードの上にポップオーバーを出すなら、レベル3以上にしないと「浮いている」ようには見えない。
        </Para>
        <Sample
          surface="base"
          caption="左: 地の面(レベル0)の上にレベル2のポップオーバー。右: レベル1のカードの上に置くため、レベル3にしたポップオーバー。"
        >
          <div className="flex flex-wrap gap-8">
            {[
              { base: 0, over: 2 },
              { base: 1, over: 3 },
            ].map((pattern) => (
              <Box
                key={pattern.base}
                sx={{
                  width: "220px",
                  height: "150px",
                  position: "relative",
                  backgroundColor: pattern.base === 0 ? "transparent" : "#ffffff",
                  border:
                    pattern.base === 0 ? "1px dashed " + BORDER : "1px solid " + BORDER,
                  borderRadius: "8px",
                  boxShadow: ELEVATION_SCALE[pattern.base].shadow,
                  p: "12px",
                }}
              >
                <Box sx={{ ...textStyle("Dns-14N-150"), color: TEXT_SECONDARY }}>
                  下地: レベル {pattern.base}
                </Box>
                <Box
                  sx={{
                    position: "absolute",
                    left: "36px",
                    top: "52px",
                    width: "160px",
                    backgroundColor: "#ffffff",
                    border: "1px solid " + BORDER,
                    borderRadius: "8px",
                    boxShadow: ELEVATION_SCALE[pattern.over].shadow,
                    p: "12px",
                    ...textStyle("Dns-14N-150"),
                  }}
                >
                  ポップオーバー(レベル {pattern.over})
                </Box>
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "elevation-overlay",
    title: "オーバーレイシェード",
    body: (
      <>
        <Para>{OVERLAY_SHADE.description}</Para>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "160px" },
            { key: "value", label: "値", mono: true },
          ]}
          rows={[
            { item: "色", value: OVERLAY_SHADE.value },
            { item: "由来", value: OVERLAY_SHADE.source },
            { item: "上に置く面の高さ", value: "レベル4(elevation-4)" },
          ]}
        />
        <Sample surface="base" caption="オーバーレイシェードとダイアログ。シェードの上では高さレベルが0にリセットされる。">
          <Box
            sx={{
              position: "relative",
              height: "220px",
              borderRadius: "8px",
              overflow: "hidden",
              border: "1px solid " + BORDER,
              backgroundColor: "#fbfbf8",
              p: "12px",
            }}
          >
            <Box sx={{ ...textStyle("Dns-14N-150"), color: TEXT_SECONDARY }}>
              下層のコンテンツ(操作できない)
            </Box>
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                backgroundColor: OVERLAY_SHADE.value,
              }}
            />
            <Box
              sx={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "260px",
                backgroundColor: "#ffffff",
                border: "1px solid " + BORDER,
                borderRadius: "12px",
                boxShadow: ELEVATION_SCALE[4].shadow,
                p: "16px",
              }}
            >
              <Box sx={{ ...textStyle("Head-16B-150"), mb: "8px" }}>
                ダイアログ
              </Box>
              <Box sx={{ ...textStyle("Dns-14N-150") }}>
                レベル4。シェードによって下層は覆われている。
              </Box>
            </Box>
          </Box>
        </Sample>
        <Note>
          オーバーレイシェード自体はフォーカス可能な領域にしない。閉じる手段は、必ずオーバーレイ側(閉じるボタン・Esc)に用意する。
          モードレスなダイアログではシェードを使わない。
        </Note>
      </>
    ),
  },
  {
    id: "elevation-contrast",
    title: "影でコントラストは確保できない",
    body: (
      <>
        <Para>
          ドロップシャドウは単色ではないため、面と背景の境界としてのコントラスト比(3:1)を満たせない。
          影を持つ面には必ず <Code>border.default</Code> の 1px 罫線を併用し、影が見えない環境でも境界が分かる状態にする。
        </Para>
        <Sample
          surface="base"
          caption="左: 影のみ。ハイコントラスト設定や印刷では境界が消える。右: 影 + 1px 罫線。"
        >
          <div className="flex flex-wrap gap-6">
            {[
              { label: "影のみ", border: "none" },
              { label: "影 + 罫線", border: "1px solid " + BORDER },
            ].map((pattern) => (
              <Box
                key={pattern.label}
                sx={{
                  width: "180px",
                  height: "88px",
                  backgroundColor: "#ffffff",
                  border: pattern.border,
                  borderRadius: "8px",
                  boxShadow: ELEVATION_SCALE[1].shadow,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  ...textStyle("Dns-14N-150"),
                }}
              >
                {pattern.label}
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "elevation-rules",
    title: "運用ルール",
    body: <RuleList rules={ELEVATION_RULES} />,
  },
];

export default function ElevationPage() {
  return (
    <FoundationPage
      title="エヴェレーション"
      lead={
        <>
          <Para>
            エヴェレーション(高さ)は、要素が画面の手前にどれだけ出ているかを表す。
            高さを持つ要素は「一時的なもの」「今この操作の対象であるもの」として読まれるため、
            常に表示されている情報に高さを与えると、画面全体が落ち着かなくなる。
          </Para>
          <Para>
            YAOYOROZU は情報密度の高いツールであり、高低差は狭く取る。
            面の区切りは影ではなく罫線で表し、影は「上に重ねて出したもの」にだけ使う。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
