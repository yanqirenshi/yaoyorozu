"use client";

import FoundationPage, { Note, Para, type DocSection } from "./FoundationPage";
import IndexPage, { type IndexItem } from "./IndexPage";

/** パーツの3階層。上から下へ、大きいものから小さいものへ。 */
export const PARTS_ITEMS: IndexItem[] = [
  {
    key: "products",
    label: "製品",
    summary:
      "意味のあるまとまり。データの取得口を持ってよい唯一の層で、フレームが分割した領域に入る。",
  },
  {
    key: "subassembly",
    label: "中間組立品",
    summary:
      "部品を組み合わせたもの。props だけで動き、データを取得しない。",
  },
  {
    key: "part",
    label: "部品",
    summary:
      "これ以上分解しない最小単位。props だけで動き、データを取得しない。",
  },
];

const SECTIONS: DocSection[] = [
  {
    id: "parts-list",
    title: "一覧",
    body: <IndexPage items={PARTS_ITEMS} onSelect={() => {}} />,
  },
  {
    id: "parts-boundary",
    title: "層の境界",
    body: (
      <>
        <Para>
          3層を分ける意味は、データを扱ってよい範囲を1本の線で決めることにある。
          製品だけが取得口を持ち、中間組立品と部品は渡された props だけで描画する。
        </Para>
        <Para>
          この境界があるため、中間組立品と部品は実データがなくても単体で表示でき、/ui
          のカタログにそのまま並べられる。逆に製品は実データを伴うため、カタログには型と作例までを載せる。
        </Para>
        <Note>
          層の関係(ページ → フレーム → 製品 → 中間組立品 → 部品)の図は「レイアウト」に置いている。
        </Note>
      </>
    ),
  },
];

export default function PartsIndexPage({
  onSelect,
}: {
  onSelect: (key: string) => void;
}) {
  const sections = SECTIONS.map((section) =>
    section.id === "parts-list"
      ? { ...section, body: <IndexPage items={PARTS_ITEMS} onSelect={onSelect} /> }
      : section,
  );

  return (
    <FoundationPage
      title="パーツ"
      lead={
        <Para>
          画面の中身にあたるコンポーネント。組み立ての語彙で、製品・中間組立品・部品の3層に分ける。
          いずれもフレームが確保した領域の中に置かれる。
        </Para>
      }
      sections={sections}
    />
  );
}
