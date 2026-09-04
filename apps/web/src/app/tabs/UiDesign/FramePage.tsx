"use client";

import Box from "@mui/material/Box";
import {
  FRAME_DATA_SCOPE,
  FRAMES,
  FRAME_ANTIPATTERNS,
  FRAME_RULES,
  FRAME_SIZING,
} from "@/data/uiFrame";
import { tone } from "@/data/uiDesign";
import FoundationPage, {
  Code,
  Note,
  Para,
  RuleList,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { BORDER, textStyle } from "./tokens";

const FRAME_FILL = tone("京紫", 100);
const FIXED_FILL = tone("墨", 100);

const SECTIONS: DocSection[] = [
  {
    id: "frame-definition",
    title: "フレームとは",
    body: (
      <>
        <Para>
          フレームはページのトップレベルに置く骨格である。
          ビューポートいっぱいの領域を確保し、その中を flex で配る。
        </Para>
        <Para>
          ページが高さやスクロールを自分で組まずに済むのは、フレームがその面倒を引き受けているからである。
          逆に言えば、フレームが正しく領域を確保していれば、内側のコンポーネントは自分の高さを気にしなくてよくなる。
        </Para>
        <Sample surface="base" caption="フレームはビューポートを占め、内側を flex で配る。スクロールは内側の領域が持つ。">
          <Box
            sx={{
              border: "1px solid " + BORDER,
              borderRadius: "8px",
              backgroundColor: FRAME_FILL,
              height: "200px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                ...textStyle("Dns-14N-150"),
                backgroundColor: FIXED_FILL,
                borderBottom: "1px solid " + BORDER,
                px: "12px",
                py: "8px",
              }}
            >
              固定の領域(自動高)
            </Box>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                p: "12px",
                backgroundColor: "#ffffff",
                ...textStyle("Dns-14N-150"),
              }}
            >
              可変の領域(flex-1 / min-height: 0 / overflow: auto)
              <Box sx={{ height: "240px" }} />
              ここまでスクロールできる
            </Box>
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "frame-sizing",
    title: "寸法の規則",
    body: (
      <>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "140px" },
            { key: "value", label: "値", mono: true, width: "220px" },
            { key: "note", label: "備考" },
          ]}
          rows={FRAME_SIZING.map((s) => ({
            item: s.item,
            value: s.value,
            note: s.note,
          }))}
        />
        <Para>
          高さをビューポートに固定するのは、縦スクロールを領域単位にするためである
          (基本デザイン「レイアウト」の運用ルール)。
          ページ全体が縦に伸びると、左メニューやタブが画面外へ流れて現在地を見失う。
        </Para>
      </>
    ),
  },
  {
    id: "frame-antipattern",
    title: "使わない書き方",
    body: (
      <>
        <Para>
          同じ結果に見えても、次の書き方は使わない。いずれも特定の状況で崩れる。
        </Para>
        <TokenTable
          columns={[
            { key: "pattern", label: "使わない", mono: true, width: "260px" },
            { key: "problem", label: "起きること" },
            { key: "instead", label: "代わりに" },
          ]}
          rows={FRAME_ANTIPATTERNS.map((a) => ({
            pattern: a.pattern,
            problem: a.problem,
            instead: a.instead,
          }))}
        />
        <Note>
          <Code>100vw</Code>{" "}
          は特に見落としやすい。Windows のブラウザではスクロールバーが幅を占有するため、縦スクロールが出た瞬間に横スクロールが生まれる。
          幅は <Code>100%</Code> で足りる。
        </Note>
      </>
    ),
  },
  {
    id: "frame-list",
    title: "現在のフレーム",
    body: (
      <>
        <TokenTable
          columns={[
            { key: "name", label: "名前", mono: true, width: "120px" },
            { key: "label", label: "呼び名", width: "180px" },
            { key: "structure", label: "構造", width: "300px" },
            { key: "usage", label: "用途" },
          ]}
          rows={FRAMES.map((f) => ({
            name: f.name,
            label: f.label,
            structure: f.structure,
            usage: f.usage,
          }))}
        />
        <Para>
          種類は1つだけである。1ペイン・2ペイン・3ペインといった型を先に用意することはしない。
          ページを実装した結果、同じ骨格が複数現れた時点で、そこからフレームとして切り出す。
        </Para>
        <Note>
          基本デザイン「レイアウト」のペイン構成は、フレームの種類ではなく寸法と原則の定義である。
          実体としてのフレームがそれに対応するのは、汎化した後になる。
        </Note>
      </>
    ),
  },
  {
    id: "frame-data",
    title: "扱ってよいデータ",
    body: (
      <>
        <Para>
          フレームは構造だけを持つわけではない。ナビゲーションの項目、現在地、アカウント、
          プロファイルの一覧のように、枠そのものを描くために必要なデータは、フレームが取得してよい。
        </Para>
        <Para>
          取ってはいけないのは、ページの内容にあたるデータである。分かれ目は次の1点で判定する。
        </Para>
        <Sample surface="sunken">
          <Box sx={{ ...textStyle("Head-16B-150") }}>
            URL(ページ)が変わったときに、取り直す必要があるか
          </Box>
          <Box sx={{ ...textStyle("Body-16N-170"), mt: "8px" }}>
            必要なら、そのデータはページの内容に属する。製品が取る。
            <br />
            不要なら、そのデータは枠に属する。フレームが取ってよい。
          </Box>
        </Sample>
        <TokenTable
          columns={[
            { key: "scope", label: "データの種類", width: "220px" },
            { key: "examples", label: "例" },
            { key: "owner", label: "取得する層", width: "140px" },
          ]}
          rows={FRAME_DATA_SCOPE.map((d) => ({
            scope: d.scope,
            examples: d.examples,
            owner: d.owner,
          }))}
        />
        <Note>
          apps/native では、取得したものを表示用のスナップショットとして扱う。
          判定・計算・遷移条件のような業務ロジックは Rust 側に置き、フレームには持たせない
          (<Code>.claude/rules/native.md</Code> §2)。
        </Note>
      </>
    ),
  },
  {
    id: "frame-rules",
    title: "規則",
    body: <RuleList rules={FRAME_RULES} />,
  },
];

export default function FramePage() {
  return (
    <FoundationPage
      title="フレーム"
      lead={
        <>
          <Para>
            フレームは、ページが必ず1つ置くトップレベルのコンポーネントである。
            ビューポートいっぱいの領域を確保し、内側を flex で配る。
          </Para>
          <Para>
            ナビゲーションやアカウントのように、枠そのものを描くためのデータは取得してよい。
            ページの内容にあたるデータは製品が取る。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
