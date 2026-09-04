"use client";

import FoundationPage, { Para, type DocSection } from "./FoundationPage";
import IndexPage, { type IndexItem } from "./IndexPage";

export const DESIGN_SYSTEM_ITEMS: IndexItem[] = [
  {
    key: "design-token",
    label: "デザイントークン",
    summary:
      "デザイン上の決定に名前を付けて参照する仕組み。層の考え方、構成要素、トークンにするものとしないものの線引き。",
  },
  {
    key: "glossary",
    label: "用語集",
    summary:
      "他のデザインシステムで使われている用語の対応表。共通語と、17システムの固有名詞、命名の流儀。",
  },
];

export default function DesignSystemIndexPage({
  onSelect,
}: {
  onSelect: (key: string) => void;
}) {
  const sections: DocSection[] = [
    {
      id: "design-system-list",
      title: "一覧",
      body: <IndexPage items={DESIGN_SYSTEM_ITEMS} onSelect={onSelect} />,
    },
  ];

  return (
    <FoundationPage
      title="デザインシステム"
      lead={
        <Para>
          デザインシステムそのものの考え方と、値の持ち方を説明する。
          「基本」やコンポーネントが個々の決定を並べるのに対し、ここではその決定をどう表し、どう保つかを扱う。
        </Para>
      }
      sections={sections}
    />
  );
}
