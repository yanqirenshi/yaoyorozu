"use client";

import FoundationPage, { Code, Para, type DocSection } from "./FoundationPage";
import IndexPage, { type IndexItem } from "./IndexPage";

/** 基本デザインの一覧。summary は各ページのリード文の要約。 */
export const BASIC_ITEMS: IndexItem[] = [
  {
    key: "color",
    label: "カラー",
    summary:
      "日本の伝統色5色を基準に、トーンスケールと役割カラー(文字・面・境界・状態・意味)を定義する。",
  },
  {
    key: "typography",
    label: "タイポグラフィ",
    summary:
      "使ってよいフォントサイズ・太さ・行高の組み合わせを、名前付きのテキストスタイルとして定義する。",
  },
  {
    key: "icon",
    label: "アイコン",
    summary:
      "20×20 / 線幅1.7 / currentColor の共通仕様と、置かれる位置ごとの4種類のサイズを定義する。",
  },
  {
    key: "basic-layout",
    label: "レイアウト",
    summary:
      "ブレークポイント、アプリシェルの寸法、ペイン構成、グリッド、コンテンツの最大幅を定義する。",
  },
  {
    key: "link-text",
    label: "リンクテキスト",
    summary:
      "リンクの色・下線・ステートと、外部リンクやファイルへのリンクの表記を定義する。",
  },
  {
    key: "spacing",
    label: "余白",
    summary:
      "基準単位4pxの8段階スケールと、関係性・階層を余白で表すための使い分けを定義する。",
  },
  {
    key: "corner",
    label: "角の形状",
    summary:
      "角丸5段階 + 完全な円弧と、面積に応じた割り当て・入れ子・部分角丸のルールを定義する。",
  },
  {
    key: "elevation",
    label: "エヴェレーション",
    summary:
      "高さレベル0〜5のドロップシャドウと、オーバーレイシェード・相対的な高さの考え方を定義する。",
  },
];

export default function BasicIndexPage({
  onSelect,
}: {
  onSelect: (key: string) => void;
}) {
  const sections: DocSection[] = [
    {
      id: "basic-list",
      title: "基本デザイン一覧",
      body: <IndexPage items={BASIC_ITEMS} onSelect={onSelect} />,
    },
    {
      id: "basic-how-to-use",
      title: "使い方",
      body: (
        <>
          <Para>
            基本デザインは、画面を作るときに「その場で決めてはいけないこと」を集めたものである。
            色・文字・余白・角・高さは、ここに定義された値の中から選ぶ。
          </Para>
          <Para>
            定義にない値が必要になったときは、画面側でその場に書くのではなく、まずこのページに追加する。
            追加する前に、既存のどの値でも表せないかを確認する。値が増えるほど、値の意味は薄くなる。
          </Para>
          <Para>
            トークンの実体は <Code>apps/web/src/data/ui*.ts</Code>{" "}
            にあり、このページはそのファイルを表示しているだけである。値を変えるとこのページと画面の両方が同時に変わる。
            トークンという考え方そのものは「デザインシステム」の「デザイントークン」で説明している。
          </Para>
        </>
      ),
    },
  ];

  return (
    <FoundationPage
      title="基本"
      lead={
        <Para>
          基本デザインは、YAOYOROZU の画面に共通する視覚的な規則である。
          個々のコンポーネント(部品・中間組立品・レイアウト)は、すべてここで定義した値の上に組み立てる。
        </Para>
      }
      sections={sections}
    />
  );
}
