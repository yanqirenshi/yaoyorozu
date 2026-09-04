"use client";

import Box from "@mui/material/Box";
import {
  BREAKPOINTS,
  CONTENT_WIDTHS,
  GRID_SPEC,
  LAYOUT_RULES,
  PANE_LAYOUTS,
  SHELL_METRICS,
} from "@/data/uiLayout";
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

const NAV_FILL = tone("京紫", 100);
const SUB_FILL = tone("墨", 50);
const COLUMN_FILL = tone("京紫", 200);

/** ペイン構成の模式図。 */
function PaneDiagram({ panes }: { panes: { label: string; flex?: number; width?: string; fill: string }[] }) {
  return (
    <Box
      sx={{
        display: "flex",
        height: "140px",
        border: "1px solid " + BORDER,
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      {panes.map((pane, index) => (
        <Box
          key={pane.label}
          sx={{
            width: pane.width,
            flex: pane.flex,
            backgroundColor: pane.fill,
            borderLeft: index === 0 ? undefined : "1px solid " + BORDER,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...textStyle("Dns-14N-150"),
            textAlign: "center",
            px: "8px",
          }}
        >
          {pane.label}
        </Box>
      ))}
    </Box>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: "layout-breakpoint",
    title: "ブレークポイント",
    body: (
      <>
        <Para>
          ブレークポイントは Tailwind v4 の既定値をそのまま使う。独自の値を定義しないのは、
          クラス名(<Code>md:</Code> など)と設計上の呼び名が食い違う状態を作らないためである。
        </Para>
        <TokenTable
          columns={[
            { key: "token", label: "接頭辞", mono: true, width: "100px" },
            { key: "min", label: "最小幅", mono: true, width: "100px" },
            { key: "label", label: "名称", width: "100px" },
            { key: "usage", label: "扱い" },
          ]}
          rows={BREAKPOINTS.map((b) => ({
            token: b.token,
            min: b.minPx + "px",
            label: b.label,
            usage: b.usage,
          }))}
        />
        <Note>
          分岐は原則 md(768px)の1点だけで考える。分岐が増えるほど、確認すべき画面の組み合わせが増える。
        </Note>
      </>
    ),
  },
  {
    id: "layout-shell",
    title: "アプリシェルの寸法",
    body: (
      <>
        <Para>
          左メニュー、二次ナビ、本体という骨格は apps/web と apps/native で共通とする。
          幅を揃えることで、2つのアプリを行き来しても操作の位置が変わらない。
        </Para>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "280px" },
            { key: "value", label: "値", mono: true, width: "220px" },
            { key: "note", label: "備考" },
          ]}
          rows={SHELL_METRICS.map((m) => ({
            item: m.item,
            value: m.value,
            note: m.note,
          }))}
        />
      </>
    ),
  },
  {
    id: "layout-pane",
    title: "ペイン構成",
    body: (
      <>
        <Para>
          画面は「選ぶ」領域と「見る」領域の組み合わせで作る。段階が増えるほどペインが増えるが、3ペインを上限とする。
          それ以上必要になった場合は、階層をタブか URL の分岐に逃がす。
        </Para>
        <TokenTable
          columns={[
            { key: "label", label: "構成", width: "200px" },
            { key: "structure", label: "幅", mono: true, width: "220px" },
            { key: "usage", label: "用途" },
          ]}
          rows={PANE_LAYOUTS.map((p) => ({
            label: p.label,
            structure: p.structure,
            usage: p.usage,
          }))}
        />
        <Sample surface="base" caption="上から1ペイン・2ペイン・3ペイン。区切りはすべて1pxの罫線。">
          <div className="flex flex-col gap-4">
            <PaneDiagram panes={[{ label: "本体", flex: 1, fill: "#ffffff" }]} />
            <PaneDiagram
              panes={[
                { label: "ナビ 256px", width: "256px", fill: NAV_FILL },
                { label: "本体", flex: 1, fill: "#ffffff" },
              ]}
            />
            <PaneDiagram
              panes={[
                { label: "ナビ 256px", width: "256px", fill: NAV_FILL },
                { label: "一覧 256px", width: "256px", fill: SUB_FILL },
                { label: "詳細", flex: 1, fill: "#ffffff" },
              ]}
            />
          </div>
        </Sample>
        <Note>
          このページ自体が3ペイン構成である。左メニュー(YAOYOROZU の画面一覧)、コンポーネント一覧、内容の3段階になっている。
        </Note>
      </>
    ),
  },
  {
    id: "layout-grid",
    title: "グリッドシステム",
    body: (
      <>
        <Para>
          本体の内側は12カラムのグリッドで考える。12は 1 / 2 / 3 / 4 / 6 に割り切れるため、
          カードの並びや2カラム・3カラムの配置を、同じガターのまま切り替えられる。
        </Para>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "160px" },
            { key: "value", label: "値", mono: true, width: "180px" },
            { key: "note", label: "備考" },
          ]}
          rows={GRID_SPEC.map((g) => ({
            item: g.item,
            value: g.value,
            note: g.note,
          }))}
        />
        <Sample surface="base" caption="12カラム(ガター 24px)と、その上に置いた 6 / 4 / 3 分割。">
          <div className="flex flex-col gap-4">
            {[12, 2, 3, 4].map((count) => (
              <div key={count} className="flex gap-6">
                {Array.from({ length: count }).map((_, index) => (
                  <Box
                    key={index}
                    sx={{
                      flex: 1,
                      height: count === 12 ? "40px" : "56px",
                      backgroundColor: count === 12 ? COLUMN_FILL : NAV_FILL,
                      borderRadius: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      ...textStyle("Dns-14N-150"),
                    }}
                  >
                    {count === 12 ? "" : 12 / count}
                  </Box>
                ))}
              </div>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "layout-width",
    title: "コンテンツの最大幅",
    body: (
      <>
        <Para>
          幅は用途で決める。読ませる文章は広げず、図表は制限しない。
          同じページの中でも、本文ブロックと図表ブロックで最大幅を変えてよい。
        </Para>
        <TokenTable
          columns={[
            { key: "token", label: "トークン", mono: true, width: "160px" },
            { key: "max", label: "最大幅", mono: true, width: "120px" },
            { key: "label", label: "名称", width: "120px" },
            { key: "usage", label: "用途" },
          ]}
          rows={CONTENT_WIDTHS.map((w) => ({
            token: w.token,
            max: w.maxWidthPx === null ? "制限なし" : w.maxWidthPx + "px",
            label: w.label,
            usage: w.usage,
          }))}
        />
      </>
    ),
  },
  {
    id: "layout-rules",
    title: "運用ルール",
    body: <RuleList rules={LAYOUT_RULES} />,
  },
];

export default function LayoutPage() {
  return (
    <FoundationPage
      title="レイアウト"
      lead={
        <>
          <Para>
            レイアウトは、画面のどこに何があるかという約束である。
            YAOYOROZU は複数の画面(WBS・構成図・UI・サイトマップ・Classes・TM)を行き来しながら使うため、
            画面ごとに骨格が変わると、内容を読む前に現在地を探す時間が発生する。
          </Para>
          <Para>
            そのため、左メニュー・二次ナビ・本体という骨格と、その幅を固定する。
            画面ごとに変えてよいのは本体の中身だけとする。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
