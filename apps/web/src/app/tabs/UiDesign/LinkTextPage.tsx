"use client";

import Box from "@mui/material/Box";
import { LINK_KINDS, LINK_RULES, LINK_STATES } from "@/data/uiLinkText";
import { ICON_DRAWING_SPEC, ICON_SAMPLES } from "@/data/uiIcon";
import FoundationPage, {
  Code,
  Note,
  Para,
  RuleList,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { FOCUS_RING, TEXT_SECONDARY, textStyle } from "./tokens";

const EXTERNAL = ICON_SAMPLES.find((i) => i.key === "external-link")!;

function ExternalIcon() {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: "1em",
        height: "1em",
        verticalAlign: "-0.15em",
        ml: "4px",
      }}
    >
      <svg
        viewBox={ICON_DRAWING_SPEC.viewBox}
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth={ICON_DRAWING_SPEC.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: EXTERNAL.body }}
      />
    </Box>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: "link-structure",
    title: "リンクテキストの基本構造",
    body: (
      <>
        <Para>
          リンクは「色」と「下線」の2つで示す。色だけで示すと、色の判別が難しい環境で本文と区別できない。
          本文中のリンクからは下線を外さない。
        </Para>
        <Para>
          リンクの文言は、そこだけを読んでも行き先が分かるように書く。
          支援技術にはリンクだけを抜き出して読み上げる機能があり、「こちら」だけが並ぶと目的地が分からなくなる。
        </Para>
        <Sample caption="上: 行き先が分かる文言。下: 前後を読まないと分からない文言。">
          <Box sx={{ ...textStyle("Body-16N-170"), mb: "12px" }}>
            リリース手順は
            <Box
              component="span"
              sx={{
                color: LINK_STATES[0].color,
                textDecoration: "underline",
                textUnderlineOffset: "0.2em",
              }}
            >
              docs/release.md
            </Box>
            にまとめている。
          </Box>
          <Box sx={{ ...textStyle("Body-16N-170"), color: TEXT_SECONDARY }}>
            リリース手順については
            <Box
              component="span"
              sx={{
                color: LINK_STATES[0].color,
                textDecoration: "underline",
                textUnderlineOffset: "0.2em",
              }}
            >
              こちら
            </Box>
            。
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "link-color",
    title: "リンクカラーとステート",
    body: (
      <>
        <Para>
          リンクの色は京紫のスケールから採る。本文の墨とは色相で区別でき、地の真珠に対して 7.39:1 のコントラストを持つ。
          訪問済みは明度差のみでの区別になるため、下線を必ず維持する。
        </Para>
        <TokenTable
          columns={[
            { key: "sample", label: "表示", width: "180px" },
            { key: "state", label: "ステート", width: "140px" },
            { key: "color", label: "色", mono: true },
            { key: "source", label: "由来" },
            { key: "decoration", label: "装飾" },
            { key: "note", label: "備考" },
          ]}
          rows={LINK_STATES.map((s) => ({
            sample: (
              <Box
                component="span"
                sx={{
                  ...textStyle("Body-14N-170"),
                  color: s.color,
                  textDecoration: "underline",
                  textDecorationThickness: s.decoration.includes("2px")
                    ? "2px"
                    : "1px",
                  textUnderlineOffset: "0.2em",
                  outline: s.state === "フォーカス" ? "2px solid " + FOCUS_RING : undefined,
                  outlineOffset: s.state === "フォーカス" ? "2px" : undefined,
                  display: "inline-block",
                }}
              >
                デザインシステム
              </Box>
            ),
            state: s.state,
            color: s.color,
            source: s.source,
            decoration: s.decoration,
            note: s.note,
          }))}
        />
      </>
    ),
  },
  {
    id: "link-kind",
    title: "リンクの種類と表記",
    body: (
      <>
        <Para>
          押した結果が「同じサービス内の移動」以外になる場合は、押す前に分かるようにする。
          新しいタブが開く、ファイルがダウンロードされる、といった予期しない動きは、それ自体が操作の失敗になる。
        </Para>
        <TokenTable
          columns={[
            { key: "kind", label: "種類", width: "220px" },
            { key: "marker", label: "目印", width: "200px" },
            { key: "example", label: "表記例" },
            { key: "note", label: "実装" },
          ]}
          rows={LINK_KINDS.map((k) => ({
            kind: k.kind,
            marker: k.marker,
            example: k.example,
            note: k.note,
          }))}
        />
        <Sample caption="外部リンクの表記。アイコンは aria-hidden とし、意味は文言で伝える。">
          <Box sx={{ ...textStyle("Body-16N-170") }}>
            <Box
              component="span"
              sx={{
                color: LINK_STATES[0].color,
                textDecoration: "underline",
                textUnderlineOffset: "0.2em",
              }}
            >
              デジタル庁デザインシステム
              <ExternalIcon />
            </Box>
            (新しいタブで開く)
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "link-target",
    title: "クリック領域",
    body: (
      <>
        <Para>
          リンクのクリック領域は、文字の高さそのものになる。行の中のリンクは行高が確保されていれば足りるが、
          リンクだけが並ぶ一覧(ナビゲーション・目次)では、1項目あたり最低 24px の高さと sp-2 の間隔を空ける。
        </Para>
        <Sample caption="左: 行高と間隔が確保された一覧。右: 詰まっていて押し間違えやすい状態。">
          <div className="flex flex-wrap gap-8">
            {[
              { label: "適切", gap: "8px", py: "4px" },
              { label: "不適切", gap: "0px", py: "0px" },
            ].map((pattern) => (
              <div key={pattern.label}>
                <Box
                  sx={{
                    ...textStyle("Dns-14B-150"),
                    color: TEXT_SECONDARY,
                    mb: "8px",
                  }}
                >
                  {pattern.label}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: pattern.gap }}>
                  {["カラー", "タイポグラフィ", "アイコン"].map((label) => (
                    <Box
                      key={label}
                      component="span"
                      sx={{
                        ...textStyle("Body-14N-170"),
                        color: LINK_STATES[0].color,
                        textDecoration: "underline",
                        textUnderlineOffset: "0.2em",
                        py: pattern.py,
                      }}
                    >
                      {label}
                    </Box>
                  ))}
                </Box>
              </div>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "link-rules",
    title: "運用ルール",
    body: (
      <>
        <RuleList rules={LINK_RULES} />
        <Note>
          ボタンとリンクを見た目で使い分けない。ページが変わる・ファイルが開くなど「移動」するものは{" "}
          <Code>&lt;a&gt;</Code>、状態が変わる・処理が走るものは <Code>&lt;button&gt;</Code> とする。
          キーボード操作(Enter / Space)と支援技術での読み上げが要素によって違うため、見た目だけを合わせても代用にならない。
        </Note>
      </>
    ),
  },
];

export default function LinkTextPage() {
  return (
    <FoundationPage
      title="リンクテキスト"
      lead={
        <>
          <Para>
            リンクは、情報を断片化させないための接続点である。
            YAOYOROZU では仕様・WBS・図・セッションの記録が互いを参照するため、リンクの見え方と書き方が揃っていないと、
            どこまでが「今読んでいるもの」でどこからが「別の場所」なのかが分からなくなる。
          </Para>
          <Para>
            リンクであることが一目で分かること、押す前に行き先が分かることの2つを満たすように定義する。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
