"use client";

import Box from "@mui/material/Box";
import {
  SPACING_APPLICATIONS,
  SPACING_BASE_PX,
  SPACING_RULES,
  SPACING_SCALE,
} from "@/data/uiSpacing";
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
import { tone } from "@/data/uiDesign";

const BAR_COLOR = tone("京紫", 300);

const SECTIONS: DocSection[] = [
  {
    id: "spacing-scale",
    title: "余白スケール",
    body: (
      <>
        <Para>
          基準単位は {SPACING_BASE_PX}px。スケールは 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 の8段階とし、
          この値以外の余白は使わない。トークン名の数値は基準単位の倍数であり、Tailwind のクラス番号と一致する
          (<Code>sp-4</Code> = 16px = <Code>p-4</Code>)。
        </Para>
        <TokenTable
          columns={[
            { key: "bar", label: "", width: "180px" },
            { key: "token", label: "トークン", mono: true },
            { key: "px", label: "値", mono: true },
            { key: "tailwind", label: "Tailwind", mono: true },
            { key: "usage", label: "用途" },
          ]}
          rows={SPACING_SCALE.map((s) => ({
            bar: (
              <Box
                sx={{
                  width: s.px + "px",
                  height: "16px",
                  backgroundColor: BAR_COLOR,
                  borderRadius: "2px",
                }}
              />
            ),
            token: s.token,
            px: s.px + "px",
            tailwind: s.tailwind,
            usage: s.usage,
          }))}
        />
        <Note>
          8段階のうち、1画面で使うのはたいてい4〜5段階である。使える値を絞ることが目的であり、全部を使い切る必要はない。
        </Note>
      </>
    ),
  },
  {
    id: "spacing-kind",
    title: "余白の種類",
    body: (
      <>
        <Para>
          余白は、要素の内側に取るパディングと、要素の外側に取るマージンに分かれる。
          YAOYOROZU では、要素間の距離は原則としてマージンではなく、親側の <Code>gap</Code> で作る。
          マージンの相殺(縦に隣り合う上下マージンがひとつにまとめられる現象)を考えなくてよくなり、
          「どちらの要素が余白を持っているか」を悩まずに済む。
        </Para>
        <Sample caption="パディングは面の内側、gap は面と面の間。">
          <div className="flex flex-wrap items-start gap-6">
            <div>
              <Box
                sx={{
                  ...textStyle("Dns-14B-150"),
                  color: TEXT_SECONDARY,
                  mb: "4px",
                }}
              >
                パディング(sp-4)
              </Box>
              <Box
                sx={{
                  border: "1px solid " + BORDER,
                  borderRadius: "8px",
                  backgroundColor: BAR_COLOR,
                  p: "16px",
                }}
              >
                <Box
                  sx={{
                    backgroundColor: "#ffffff",
                    border: "1px solid " + BORDER,
                    borderRadius: "4px",
                    px: "12px",
                    py: "8px",
                    ...textStyle("Dns-14N-150"),
                  }}
                >
                  内容
                </Box>
              </Box>
            </div>
            <div>
              <Box
                sx={{
                  ...textStyle("Dns-14B-150"),
                  color: TEXT_SECONDARY,
                  mb: "4px",
                }}
              >
                gap(sp-4)
              </Box>
              <Box sx={{ display: "flex", gap: "16px", backgroundColor: BAR_COLOR }}>
                {["A", "B", "C"].map((label) => (
                  <Box
                    key={label}
                    sx={{
                      backgroundColor: "#ffffff",
                      border: "1px solid " + BORDER,
                      borderRadius: "4px",
                      px: "16px",
                      py: "8px",
                      ...textStyle("Dns-14N-150"),
                    }}
                  >
                    {label}
                  </Box>
                ))}
              </Box>
            </div>
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "spacing-rules",
    title: "余白のルールの考え方",
    body: <RuleList rules={SPACING_RULES} />,
  },
  {
    id: "spacing-relation",
    title: "余白による関係性の明示",
    body: (
      <>
        <Para>
          近くに置かれた要素は関係があると読まれる。見出しと本文の距離を、前のブロックとの距離より小さくすると、
          見出しがどちらに属しているかが余白だけで伝わる。
        </Para>
        <Sample
          surface="base"
          caption="左: 見出しの上を sp-8、下を sp-2 にした状態。見出しが下の本文に属して見える。右: 上下とも sp-4 にした状態。どちらに属するか読み取れない。"
        >
          <div className="flex flex-wrap gap-6">
            {[
              { label: "適切", above: "32px", below: "8px" },
              { label: "不適切", above: "16px", below: "16px" },
            ].map((pattern) => (
              <Box
                key={pattern.label}
                sx={{
                  width: "300px",
                  border: "1px solid " + BORDER,
                  borderRadius: "8px",
                  backgroundColor: "#ffffff",
                  p: "16px",
                }}
              >
                <Box sx={{ ...textStyle("Body-14N-170") }}>
                  前のブロックの本文がここで終わる。
                </Box>
                <Box sx={{ height: pattern.above, backgroundColor: BAR_COLOR }} />
                <Box sx={{ ...textStyle("Head-16B-150") }}>見出し</Box>
                <Box sx={{ height: pattern.below, backgroundColor: BAR_COLOR }} />
                <Box sx={{ ...textStyle("Body-14N-170") }}>
                  この見出しが説明している本文。
                </Box>
                <Box
                  sx={{
                    ...textStyle("Dns-14B-150"),
                    color: TEXT_SECONDARY,
                    mt: "8px",
                  }}
                >
                  {pattern.label}(上 {pattern.above} / 下 {pattern.below})
                </Box>
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "spacing-application",
    title: "適用箇所の既定値",
    body: (
      <>
        <Para>
          画面を組むときに毎回迷わないよう、代表的な箇所の既定値を決めておく。
          ここに載っていない箇所は、いちばん近い用途の値に合わせる。
        </Para>
        <TokenTable
          columns={[
            { key: "target", label: "箇所" },
            { key: "token", label: "既定値", mono: true, width: "120px" },
            { key: "note", label: "備考" },
          ]}
          rows={SPACING_APPLICATIONS.map((a) => ({
            target: a.target,
            token:
              a.token +
              " (" +
              SPACING_SCALE.find((s) => s.token === a.token)!.px +
              "px)",
            note: a.note,
          }))}
        />
      </>
    ),
  },
];

export default function SpacingPage() {
  return (
    <FoundationPage
      title="余白"
      lead={
        <>
          <Para>
            余白は「何も置かない場所」ではなく、要素どうしの関係を伝えるための手段である。
            近いものは関係があり、遠いものは関係がない。この読み取りは無意識に働くため、余白が不規則だと、
            内容が正しくても情報の構造が伝わらなくなる。
          </Para>
          <Para>
            YAOYOROZU は情報密度の高いツールであり、余白を大きく取れば良いというものではない。
            使ってよい値を限定し、同じ役割には必ず同じ値を使うことを規則とする。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
