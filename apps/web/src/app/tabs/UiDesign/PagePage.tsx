"use client";

import Box from "@mui/material/Box";
import { PAGE_FILES, PAGE_RULES } from "@/data/uiPage";
import { NAV_MENU_ITEMS } from "@/data/navigation";
import { CONTENT_WIDTHS } from "@/data/uiLayout";
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

const FRAME_FILL = tone("京紫", 100);
const PRODUCT_FILL = tone("墨", 50);

const SECTIONS: DocSection[] = [
  {
    id: "page-definition",
    title: "ページとは",
    body: (
      <>
        <Para>
          ページは URL のパスと1対1に対応する概念である。
          URL が1つ増えればページが1つ増え、URL が同じならページも同じものを指す。
        </Para>
        <Para>
          そのため、ページどうしで共有されるコンポーネントは存在しない。
          共通する骨格はフレーム、共通する機能は製品として切り出すので、ページに残るのは「その URL のために何をどこへ置くか」だけになる。
          ここで定義しているのも、コンポーネントではなくすべてのページが従う規則である。
        </Para>
        <Sample surface="base" caption="ページの入れ子。ページはフレームを1つ置き、その中に製品を並べる。">
          <Box
            sx={{
              border: "1px dashed " + BORDER,
              borderRadius: "8px",
              p: "12px",
            }}
          >
            <Box
              sx={{ ...textStyle("Dns-14B-150"), color: TEXT_SECONDARY, mb: "8px" }}
            >
              ページ(URL: /ui)
            </Box>
            <Box
              sx={{
                backgroundColor: FRAME_FILL,
                border: "1px solid " + BORDER,
                borderRadius: "8px",
                p: "12px",
              }}
            >
              <Box sx={{ ...textStyle("Dns-14B-150"), mb: "8px" }}>フレーム</Box>
              <div className="flex gap-3">
                {["製品", "製品"].map((label, index) => (
                  <Box
                    key={index}
                    sx={{
                      flex: 1,
                      backgroundColor: PRODUCT_FILL,
                      border: "1px solid " + BORDER,
                      borderRadius: "4px",
                      p: "12px",
                      ...textStyle("Dns-14N-150"),
                      textAlign: "center",
                    }}
                  >
                    {label}
                  </Box>
                ))}
              </div>
            </Box>
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "page-files",
    title: "実装は2ファイルに分かれる",
    body: (
      <>
        <Para>
          ページは概念としては1つだが、Next.js の App Router では2つのファイルに分かれる。
          ルーティングを Server Component のまま保ち、クライアント処理を画面本体へ寄せるためである。
        </Para>
        <TokenTable
          columns={[
            { key: "file", label: "ファイル", mono: true, width: "260px" },
            { key: "role", label: "役割", width: "280px" },
            { key: "constraint", label: "制約" },
          ]}
          rows={PAGE_FILES.map((f) => ({
            file: f.file,
            role: f.role,
            constraint: f.constraint,
          }))}
        />
        <Note>
          この分割は規約(<Code>.claude/rules/web.md</Code> §1)で定めているものであり、
          ページという概念が2つあるという意味ではない。
        </Note>
      </>
    ),
  },
  {
    id: "page-rules",
    title: "規則",
    body: <RuleList rules={PAGE_RULES} />,
  },
  {
    id: "page-width",
    title: "幅の選び方",
    body: (
      <>
        <Para>
          ページの中身は、ブロック単位で最大幅を選ぶ。読ませる文章は広げず、図表は制限しない。
        </Para>
        <TokenTable
          columns={[
            { key: "token", label: "トークン", mono: true, width: "160px" },
            { key: "max", label: "最大幅", mono: true, width: "120px" },
            { key: "usage", label: "選ぶ場面" },
          ]}
          rows={CONTENT_WIDTHS.map((w) => ({
            token: w.token,
            max: w.maxWidthPx === null ? "制限なし" : w.maxWidthPx + "px",
            usage: w.usage,
          }))}
        />
      </>
    ),
  },
  {
    id: "page-list",
    title: "現在のページ",
    body: (
      <>
        <Para>
          apps/web が持つページの一覧。左メニューの項目と1対1で対応する。
        </Para>
        <TokenTable
          columns={[
            { key: "path", label: "パス", mono: true, width: "220px" },
            { key: "label", label: "画面" },
          ]}
          rows={NAV_MENU_ITEMS.map((item) => ({
            path: item.path,
            label: item.label,
          }))}
        />
        <Note>
          この一覧は <Code>src/data/navigation.ts</Code>{" "}
          から生成している。左メニュー・サイトマップと同じ定義を参照しているため、ページを追加すれば3か所が同時に更新される。
        </Note>
      </>
    ),
  },
  {
    id: "page-native",
    title: "apps/native での扱い",
    body: (
      <Note>
        ここまでは apps/web(Next.js の App Router)の規則である。
        apps/native はハッシュルータであり、1ウィンドウ = 1プロファイルという単位も持つため、
        「ページ = URL のパス」がそのまま当てはまるかは未確定とする。
        ネイティブ側の画面を定義する段階で、改めてここに追記する。
      </Note>
    ),
  },
];

export default function PagePage() {
  return (
    <FoundationPage
      title="ページ"
      lead={
        <>
          <Para>
            ページは、URL のパスに対応する画面そのものである。
            コンポーネントの階層では最上位に位置し、フレームと製品を組み合わせて1つの画面を作る。
          </Para>
          <Para>
            他のコンポーネントと違い、ページには再利用がない。
            そのためこのページに並ぶのは部品のカタログではなく、すべてのページが守る規則である。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
