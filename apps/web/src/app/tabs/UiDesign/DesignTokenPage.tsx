"use client";

import Box from "@mui/material/Box";
import {
  TOKEN_ANATOMY,
  TOKEN_LAYERS,
  TOKEN_NAMING,
  TOKEN_OUTPUTS,
  TOKEN_SCOPE,
} from "@/data/uiDesignToken";
import { KEY_COLORS, tone } from "@/data/uiDesign";
import FoundationPage, {
  Bullets,
  Code,
  Note,
  Para,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { BORDER, TEXT_SECONDARY, textStyle } from "./tokens";

const PRIMARY = KEY_COLORS.find((c) => c.token === "color.primary")!;

/** 層の関係の模式図。 */
function LayerDiagram() {
  const rows = [
    {
      label: "画面",
      body: "color.primary を参照する",
      fill: "#ffffff",
    },
    {
      label: "セマンティック層",
      body: "color.primary = 京紫-500",
      fill: tone("京紫", 100),
    },
    {
      label: "プリミティブ層",
      body: "京紫-500 = " + PRIMARY.value,
      fill: tone("京紫", 200),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      {rows.map((row, index) => (
        <Box key={row.label} sx={{ width: "100%", maxWidth: "440px" }}>
          <Box
            sx={{
              border: "1px solid " + BORDER,
              borderRadius: "8px",
              backgroundColor: row.fill,
              p: "12px",
              textAlign: "center",
            }}
          >
            <Box sx={{ ...textStyle("Dns-14B-150") }}>{row.label}</Box>
            <Box
              sx={{
                ...textStyle("Mono-14N-150"),
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                color: TEXT_SECONDARY,
              }}
            >
              {row.body}
            </Box>
          </Box>
          {index < rows.length - 1 && (
            <Box
              sx={{
                ...textStyle("Dns-14N-150"),
                color: TEXT_SECONDARY,
                textAlign: "center",
              }}
            >
              ↓ 参照
            </Box>
          )}
        </Box>
      ))}
    </div>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: "token-what",
    title: "デザイントークンとは",
    body: (
      <>
        <Para>
          デザイントークンとは、デザイン上の決定ひとつひとつに名前を付け、値そのものではなく名前で参照できるようにしたものである。
          プログラミングでマジックナンバーを定数に切り出す行為に近いが、目的が保守性だけでなく
          「デザイナーと実装者、そして複数のプラットフォームが同じ語彙で会話できること」にある点が異なる。
        </Para>
        <Para>
          <Code>{PRIMARY.value}</Code>{" "}
          は単なる色の値だが、これに名前と用途を与えたものがトークンである。
        </Para>
        <Sample surface="sunken">
          <Box
            sx={{
              ...textStyle("Mono-14N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {'{ token: "' +
              PRIMARY.token +
              '", value: "' +
              PRIMARY.value +
              '", source: "' +
              PRIMARY.source +
              '",\n  usage: "' +
              PRIMARY.usage +
              '", contrast: ' +
              PRIMARY.contrast +
              " }"}
          </Box>
        </Sample>
        <Para>
          画面側は <Code>{PRIMARY.value}</Code> ではなく <Code>{PRIMARY.token}</Code>{" "}
          を参照する。そうすることで「なぜこの色なのか」がコードに残り、色を変えるときも1か所で済む。
        </Para>
        <Note>
          言葉としては2014年頃、Salesforce の Lightning Design System で使われはじめたものである。
          Web・iOS・Android で同じデザインを提供する必要から、値をプラットフォーム非依存のデータとして持ち、
          そこから各プラットフォームの形式へ変換する方法として生まれた。
          現在は W3C の Design Tokens Community Group が交換フォーマットの標準化を進めている。
        </Note>
      </>
    ),
  },
  {
    id: "token-why",
    title: "何を解決するのか",
    body: (
      <>
        <Para>
          トークンがない状態では、同じ値が次のように散らばる。
        </Para>
        <Bullets
          items={[
            "デザインツール上のカラースタイル",
            "CSS の button { background: " + PRIMARY.value + " }",
            "別のコンポーネントの border-color(1文字違っていても誰も気づかない)",
            "ネイティブアプリ側の色定義",
          ]}
        />
        <Para>
          この状態で「主役の色を少し暗くしたい」となると、全箇所を探して直すことになる。
          そして必ず何か所か漏れる。漏れたことは、半年後に誰かが「ここだけ色が違う」と気づくまで分からない。
        </Para>
        <Para>
          トークンは、この値を1か所に集めて名前で参照させることで、変更を1か所の編集にする。
          ただし効果はそれだけではない。名前が付くことで「この値は何のための値か」がコードに残る。
          <Code>{tone("墨", 200)}</Code> を見ても何も分からないが、
          <Code>border.default</Code> なら罫線だと分かるので、無効状態の背景と間違えて一緒に変えてしまうことがなくなる。
        </Para>
      </>
    ),
  },
  {
    id: "token-layer",
    title: "層(レイヤー)",
    body: (
      <>
        <Para>
          トークンは通常2〜3層に分ける。この層の分離が、デザイントークンのもっとも本質的な部分である。
        </Para>
        <Sample surface="base" caption="画面はセマンティック層だけを参照し、プリミティブ層を直接見ない。">
          <LayerDiagram />
        </Sample>
        <TokenTable
          columns={[
            { key: "label", label: "層", width: "160px" },
            { key: "aliases", label: "別名", width: "180px" },
            { key: "example", label: "例", mono: true, width: "220px" },
            { key: "description", label: "説明" },
            { key: "inYaoyorozu", label: "YAOYOROZU での該当", mono: true },
          ]}
          rows={TOKEN_LAYERS.map((layer) => ({
            label: layer.label,
            aliases: layer.aliases,
            example: layer.example,
            description: layer.description,
            inYaoyorozu: layer.inYaoyorozu || "(未定義)",
          }))}
        />
        <Para>
          層を分ける理由は、「値の在庫」と「値の使い方」を別々に変更できるようにするためである。
          罫線を濃くしたいときはセマンティック層の指す先を変え、パレット自体を刷新したいときはプリミティブ層を差し替える。
          1層しかないと、この2種類の変更を区別できない。
        </Para>
        <Para>
          将来ダークテーマを定義できるのも、この構造があるからである。
          プリミティブ層は変えず、セマンティック層の割り当てだけを入れ替える
          (<Code>text.primary</Code> が 墨-900 ではなく 墨-50 を指すようになる)。画面のコードは1行も変わらない。
        </Para>
      </>
    ),
  },
  {
    id: "token-anatomy",
    title: "トークンの構成要素",
    body: (
      <>
        <Para>
          1つのトークンは、少なくとも次の要素を持つ。値だけを並べたものはトークンとは呼ばない。
        </Para>
        <TokenTable
          columns={[
            { key: "item", label: "要素", width: "120px" },
            { key: "example", label: "例", mono: true, width: "280px" },
            { key: "note", label: "説明" },
          ]}
          rows={TOKEN_ANATOMY.map((a) => ({
            item: a.item,
            example: a.example,
            note: a.note,
          }))}
        />
        <Note>
          このうち「用途」がもっとも失われやすい。値と名前だけが残ったトークンは、
          しばらくすると誰も使い分けが分からなくなり、結局その場で新しい値が書かれるようになる。
        </Note>
      </>
    ),
  },
  {
    id: "token-scope",
    title: "何がトークンで、何がトークンでないか",
    body: (
      <>
        <Para>
          値だけで表せるものはトークンにし、条件や関係を含むものは文章の規則として書く。
          この線引きを曖昧にすると、トークンの一覧に説明文が混ざり、機械的に扱えなくなる。
        </Para>
        <Box sx={{ ...textStyle("Head-16B-150"), mb: "8px" }}>
          トークンにするもの
        </Box>
        <Bullets items={TOKEN_SCOPE.included} />
        <Box sx={{ ...textStyle("Head-16B-150"), mb: "8px" }}>
          トークンにしないもの
        </Box>
        <Bullets items={TOKEN_SCOPE.excluded} />
        <Para>
          基本デザインの各ページが、トークン表とは別に「運用ルール」の節を持っているのはこのためである。
          値にできるものは表に、できないものは文章にしている。
        </Para>
      </>
    ),
  },
  {
    id: "token-css",
    title: "CSS カスタムプロパティとして配る",
    body: (
      <>
        <Para>
          トークンの定義は TypeScript だが、CSS ファイルからも、MUI を使わない apps/native からも、
          TypeScript の値は参照できない。そこで定義から CSS カスタムプロパティを生成し、
          <Code>:root</Code> に流している。生成物はリポジトリにコミットする。
        </Para>
        <Sample surface="sunken">
          <Box
            sx={{
              ...textStyle("Mono-14N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {"npm run tokens\n\n" +
              ":root {\n" +
              "  --color-kyomurasaki-500: " +
              tone("京紫", 500) +
              ";   /* プリミティブ */\n" +
              "  --color-primary: " +
              PRIMARY.value +
              ";           /* セマンティック */\n" +
              "  --border-default: " +
              tone("墨", 200) +
              ";\n" +
              "  --space-4: 16px;\n" +
              "  --radius-8: 8px;\n" +
              "}"}
          </Box>
        </Sample>
        <Para>
          生成は <Code>scripts/generate-tokens.ts</Code> が行い、
          <Code>npm run web:dev</Code> と <Code>npm run web:build</Code>{" "}
          の先頭で毎回走る。生成物を手で編集しても次回の生成で失われるため、値を変えるときは必ず生成元の
          TypeScript を直す。
        </Para>
        <TokenTable
          columns={[
            { key: "path", label: "出力先", mono: true, width: "300px" },
            { key: "consumer", label: "消費者", width: "140px" },
            { key: "status", label: "状態" },
          ]}
          rows={TOKEN_OUTPUTS.map((o) => ({
            path: o.path,
            consumer: o.consumer,
            status: o.status,
          }))}
        />
        <Para>
          apps/native は npm workspace として apps/web に依存しないため、共有パッケージを新設せず、
          同じ内容のファイルを2か所へ出力している。消費者が3つ目になった時点で
          <Code>packages/</Code> への切り出しを検討する。
        </Para>
        <Box sx={{ ...textStyle("Head-16B-150"), mb: "8px" }}>命名規則</Box>
        <TokenTable
          columns={[
            { key: "layer", label: "対象", width: "200px" },
            { key: "pattern", label: "形式", mono: true, width: "320px" },
            { key: "example", label: "例", mono: true },
            { key: "note", label: "備考" },
          ]}
          rows={TOKEN_NAMING.map((n) => ({
            layer: n.layer,
            pattern: n.pattern,
            example: n.example,
            note: n.note,
          }))}
        />
        <Note>
          ブレークポイントは出力していない。CSS カスタムプロパティはメディアクエリの条件に使えないためである。
          値は「レイアウト」のページと Tailwind の既定値を参照する。
        </Note>
      </>
    ),
  },
  {
    id: "token-implementation",
    title: "YAOYOROZU での扱い",
    body: (
      <>
        <Para>
          トークンという言葉は技術ではなく、設計とコードで同じ語彙を使うための約束である。
          実装形式は何でもよく、このリポジトリでは TypeScript のオブジェクトとして持っている。
        </Para>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "200px" },
            { key: "value", label: "内容" },
          ]}
          rows={[
            {
              item: "定義場所(SSoT)",
              value: (
                <>
                  <Code>apps/web/src/data/ui*.ts</Code> の静的オブジェクト
                </>
              ),
            },
            {
              item: "画面への届き方(React)",
              value:
                "MUI テーマ(src/theme.ts)経由と、各ページの sx 経由の2通り。最終的に Emotion が実行時に CSS を生成する。",
            },
            {
              item: "画面への届き方(CSS)",
              value: (
                <>
                  生成した <Code>tokens.css</Code> を globals.css から import
                  し、カスタムプロパティとして参照する。
                </>
              ),
            },
            {
              item: "生成",
              value: (
                <>
                  <Code>scripts/generate-tokens.ts</Code>(
                  <Code>npm run tokens</Code>)。dev / build の先頭で毎回走る。
                </>
              ),
            },
            {
              item: "生成物",
              value:
                "apps/web と apps/native の2か所に同じ内容の tokens.css を出力し、コミットする。",
            },
          ]}
        />
        <Para>
          値の重複はこれで解消しているが、apps/native 側はファイルを置いただけで、
          App.css の色は依然として直書きのままである。取り込みは実装セッションの作業として切り出している。
        </Para>
        <Note>
          このページを含む /ui の全ページは、ここで説明したトークンだけを使って組んでいる。
          値を変えると、ドキュメントと画面が同時に変わる。ドキュメントだけが古くなることはない。
        </Note>
      </>
    ),
  },
];

export default function DesignTokenPage() {
  return (
    <FoundationPage
      title="デザイントークン"
      lead={
        <>
          <Para>
            基本デザインで定義している色・文字・余白・角・高さは、いずれも「デザイントークン」という形式で持っている。
            このページは、その考え方そのものを説明する。
          </Para>
          <Para>
            個々の値を知りたい場合は「基本」の各ページを見る。ここで扱うのは、値ではなく値の持ち方である。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
