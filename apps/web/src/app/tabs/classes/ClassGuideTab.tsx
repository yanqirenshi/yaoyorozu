"use client";

import Box from "@mui/material/Box";
import {
  GUIDE_CHECKS,
  GUIDE_CLASS_EXAMPLE,
  GUIDE_CLASS_ITEMS,
  GUIDE_FILES,
  GUIDE_LAYOUT_RULES,
  GUIDE_MULTIPLICITIES,
  GUIDE_POINTS,
  GUIDE_REL_ARGS,
  GUIDE_REL_EXAMPLE,
  GUIDE_RELATIONSHIP_TYPES,
  GUIDE_TM_RULES,
} from "@/data/classDiagramGuide";
// 説明ページの部品は、/ui の基本デザインのページと同じものを使う(見た目を揃えるため)。
import FoundationPage, {
  Code,
  Note,
  Para,
  RuleList,
  TokenTable,
  type DocSection,
} from "../UiDesign/FoundationPage";
import { BORDER, SURFACE_SUNKEN, TEXT_PRIMARY, textStyle } from "../UiDesign/tokens";

/** 複数行のコードの例。 */
function CodeBlock({ code }: { code: string }) {
  return (
    <Box
      component="pre"
      sx={{
        ...textStyle("Dns-14N-150"),
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        // Bulma が pre に背景と余白を当てるため、明示的に上書きする。
        color: TEXT_PRIMARY,
        backgroundColor: SURFACE_SUNKEN,
        border: "1px solid " + BORDER,
        borderRadius: "8px",
        p: "16px",
        mb: "24px",
        overflowX: "auto",
      }}
    >
      {code}
    </Box>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: "files",
    title: "ファイルの構成",
    body: (
      <>
        <Para>
          図のデータはファイルに書き、画面は表示するだけである。
          複数の図のデータを <Code>classes.ts</Code> で1枚に重ねて表示している。
        </Para>
        <TokenTable
          columns={[
            { key: "path", label: "ファイル", mono: true, width: "300px" },
            { key: "role", label: "役割" },
          ]}
          rows={GUIDE_FILES.map((f) => ({ path: f.path, role: f.role }))}
        />
        <Note>
          このタブの決まりは、ドメインのモデル(<Code>classes-domain.ts</Code>)に当てはめる。
        </Note>
      </>
    ),
  },
  {
    id: "class",
    title: "クラスの書き方",
    body: (
      <>
        <Para>
          クラスは <Code>DEFS</Code> の配列に1つずつ書く。
          id は物理名から付くので書かない。
        </Para>
        <CodeBlock code={GUIDE_CLASS_EXAMPLE} />
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "120px" },
            { key: "howTo", label: "書き方" },
            { key: "example", label: "例", mono: true, width: "280px" },
          ]}
          rows={GUIDE_CLASS_ITEMS.map((c) => ({
            item: c.item,
            howTo: c.howTo,
            example: c.example,
          }))}
        />
      </>
    ),
  },
  {
    id: "from-tm",
    title: "TM からの写し方",
    body: (
      <>
        <Para>
          TM(データモデル)で決めたモノと関係を、次の決まりでクラス・フィールド・関係線に写す。
        </Para>
        <RuleList rules={GUIDE_TM_RULES} />
      </>
    ),
    children: [
      {
        id: "multiplicity",
        title: "多重度",
        body: (
          <>
            <Para>
              多重度は TM の結線記号を写す。
              記号は「そのエンティティが相手1件に対して何件か」を表すので、UML で同じ側の端に置く多重度とそのまま対応する。
            </Para>
            <TokenTable
              columns={[
                { key: "tm", label: "TM の結線記号", width: "200px" },
                { key: "uml", label: "多重度", mono: true },
              ]}
              rows={GUIDE_MULTIPLICITIES.map((m) => ({ tm: m.tm, uml: m.uml }))}
            />
          </>
        ),
      },
    ],
  },
  {
    id: "relationships",
    title: "関係線",
    children: [
      {
        id: "relationship-types",
        title: "線の種類と向き",
        body: (
          <>
            <TokenTable
              columns={[
                { key: "label", label: "種類", width: "120px" },
                { key: "type", label: "type", mono: true, width: "120px" },
                { key: "line", label: "線", width: "60px" },
                { key: "marker", label: "記号", width: "180px" },
                { key: "direction", label: "線の向き", width: "180px" },
                { key: "usage", label: "使い方" },
              ]}
              rows={GUIDE_RELATIONSHIP_TYPES.map((r) => ({
                label: r.label,
                type: r.type,
                line: r.line,
                marker: r.marker,
                direction: r.direction,
                usage: r.usage,
              }))}
            />
            <Note>
              d3.classes は ◆ や三角を線の終点側に描く。
              そのため、UML で記号が付く側(全体・親)が終点になるように線の向きを決める。
            </Note>
          </>
        ),
      },
      {
        id: "relationship-call",
        title: "rel の書き方",
        body: (
          <>
            <Para>
              関係線は <Code>RELATIONSHIPS</Code> の配列に、<Code>rel</Code> で1本ずつ書く。
            </Para>
            <CodeBlock code={GUIDE_REL_EXAMPLE} />
            <TokenTable
              columns={[
                { key: "arg", label: "引数", width: "240px" },
                { key: "meaning", label: "意味" },
              ]}
              rows={GUIDE_REL_ARGS.map((a) => ({ arg: a.arg, meaning: a.meaning }))}
            />
          </>
        ),
      },
      {
        id: "relationship-points",
        title: "端点(辺・角度)",
        body: (
          <>
            <Para>
              線の端点は、辺のキーワード(その辺の中央)か、角度で指定する。
              角度は箱の中心から、0 = 真下、時計回りに 90 = 左、180 = 真上、270 = 右である。
            </Para>
            <TokenTable
              columns={[
                { key: "value", label: "指定", mono: true, width: "200px" },
                { key: "position", label: "付く位置" },
              ]}
              rows={GUIDE_POINTS.map((p) => ({ value: p.value, position: p.position }))}
            />
            <Note>
              同じ辺に2本以上つなぐときは、角度でずらす。
              例: GitRepository の右辺では、branches を 250、worktrees を 290 で受ける。
            </Note>
          </>
        ),
      },
    ],
  },
  {
    id: "layout",
    title: "配置と手調整",
    body: <RuleList rules={GUIDE_LAYOUT_RULES} />,
  },
  {
    id: "checks",
    title: "確かめること",
    body: (
      <>
        <Para>書いたあとは、画面を開いて次のことを確かめる。</Para>
        <TokenTable
          columns={[
            { key: "item", label: "確かめること", width: "280px" },
            { key: "note", label: "補足" },
          ]}
          rows={GUIDE_CHECKS.map((c) => ({ item: c.item, note: c.note }))}
        />
      </>
    ),
  },
];

/** Classes 図の「クラス図の書き方」タブ。 */
export default function ClassGuideTab() {
  return (
    <div className="flex-1 overflow-auto px-6 py-8">
      <FoundationPage
        title="クラス図の書き方"
        lead={
          <>
            <Para>
              この図は、YAOYOROZU のドメインのオブジェクトモデルである。
              データモデル(TM、<Code>/tm</Code>)を元に起こし、apps/native の domain クレート(Rust)で実装する前提で書く。
            </Para>
            <Para>
              TM は「何を個体指定子として、何と何が関係するか」を描く。
              この図は「アプリの中にどんなオブジェクトがあり、どう繋がるか」を描く。
            </Para>
          </>
        }
        sections={SECTIONS}
      />
    </div>
  );
}
