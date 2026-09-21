"use client";

import FoundationPage, { Code, Para, type DocSection } from "./FoundationPage";
import IndexPage, { type IndexItem } from "./IndexPage";

/** 定義済みの部品。 */
export const PART_ITEMS: IndexItem[] = [
  {
    key: "part-button",
    label: "ボタン",
    summary:
      "追加ボタン(塗り)と変更ボタン(線)。サイズは small / medium / large の3段階。",
  },
];

export default function PartIndexPage({
  onSelect,
}: {
  onSelect: (key: string) => void;
}) {
  const sections: DocSection[] = [
    {
      id: "part-list",
      title: "一覧",
      body: <IndexPage items={PART_ITEMS} onSelect={onSelect} />,
    },
    {
      id: "part-rules",
      title: "部品の条件",
      body: (
        <>
          <Para>
            部品は、これ以上分解しない最小単位のコンポーネントである。
            データを取得せず、渡された props だけで描画する。そのため、実データがなくてもこのカタログに単体で並べられる。
          </Para>
          <Para>
            apps/web の実装は <Code>src/components/parts/</Code> に置く。
            見た目は <Code>src/data/</Code> の仕様とトークンだけから決まり、コンポーネント自身は値を持たない。
            apps/native は同じ仕様を、tokens.css の CSS 変数を参照して実装する。
          </Para>
        </>
      ),
    },
  ];

  return (
    <FoundationPage
      title="部品"
      lead={
        <Para>
          画面を組み立てる最小単位の部品。中間品・製品は、ここに並ぶ部品を組み合わせて作る。
        </Para>
      }
      sections={sections}
    />
  );
}
