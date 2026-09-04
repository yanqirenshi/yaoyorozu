"use client";

import Box from "@mui/material/Box";
import {
  COMMON_TERMS,
  GLOSSARY_CATEGORIES,
  NAMING_STYLES,
  STRENGTH_VOCABULARY,
  type GlossarySystem,
} from "@/data/uiGlossary";
import { ICON_DRAWING_SPEC, ICON_SAMPLES } from "@/data/uiIcon";
import FoundationPage, {
  Bullets,
  Code,
  Note,
  Para,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { LINK_COLOR, TEXT_SECONDARY, textStyle } from "./tokens";

const EXTERNAL = ICON_SAMPLES.find((i) => i.key === "external-link")!;

/** 外部リンク。基本デザイン「リンクテキスト」の規定どおり、下線とアイコンを伴わせる。 */
function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener"
      sx={{
        color: LINK_COLOR,
        textDecoration: "underline",
        textUnderlineOffset: "0.2em",
      }}
    >
      {children}
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
    </Box>
  );
}

const TERM_COLUMNS = [
  { key: "term", label: "用語", width: "320px" },
  { key: "meaning", label: "意味" },
];

function SystemBlock({ system }: { system: GlossarySystem }) {
  return (
    <div className="mb-6">
      <Box sx={{ ...textStyle("Head-16B-150"), mb: "2px" }}>{system.name}</Box>
      <Box
        sx={{ ...textStyle("Body-14N-170"), color: TEXT_SECONDARY, mb: "8px" }}
      >
        {system.org} / <ExternalLink href={system.url}>{system.url}</ExternalLink>
      </Box>
      <TokenTable
        columns={TERM_COLUMNS}
        rows={system.terms.map((t) => ({
          term: <Code>{t.term}</Code>,
          meaning: t.meaning,
        }))}
      />
    </div>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: "glossary-common",
    title: "共通語",
    body: (
      <>
        <Para>
          特定のデザインシステムに属さず、どの文書でも同じ意味で使われる用語。
        </Para>
        <TokenTable
          columns={TERM_COLUMNS}
          rows={COMMON_TERMS.map((t) => ({
            term: <Code>{t.term}</Code>,
            meaning: t.meaning,
          }))}
        />
      </>
    ),
  },
  {
    id: "glossary-systems",
    title: "システム固有の用語",
    body: (
      <Para>
        同じ概念に別の名前が付いていることが多い。外部の文書を読むときの対応表として使う。
      </Para>
    ),
    children: GLOSSARY_CATEGORIES.map((category) => ({
      id: "glossary-" + category.key,
      title: category.label,
      body: (
        <>
          <Para>{category.description}</Para>
          {category.systems.map((system) => (
            <SystemBlock key={system.key} system={system} />
          ))}
        </>
      ),
    })),
  },
  {
    id: "glossary-naming",
    title: "命名の流儀",
    body: (
      <>
        <Para>
          並べて見ると、トークン名の付け方は大きく3系統に分かれる。どれが正しいというものではなく、
          誰が読み書きするかで選ぶ。
        </Para>
        <TokenTable
          columns={[
            { key: "style", label: "流儀", width: "200px" },
            { key: "examples", label: "例", mono: true, width: "380px" },
            { key: "note", label: "特徴" },
          ]}
          rows={NAMING_STYLES.map((n) => ({
            style: n.style,
            examples: n.examples,
            note: n.note,
          }))}
        />
        <Para>
          強度(目立ちにくさから目立ちやすさまで)を表す語彙にも流派がある。
          罫線や背景の段階が増えたときに、この語彙があると命名に迷わなくなる。
        </Para>
        <TokenTable
          columns={[
            { key: "system", label: "システム", width: "160px" },
            { key: "scale", label: "語彙", mono: true },
          ]}
          rows={STRENGTH_VOCABULARY.map((s) => ({
            system: s.system,
            scale: s.scale,
          }))}
        />
      </>
    ),
  },
  {
    id: "glossary-yaoyorozu",
    title: "YAOYOROZU の位置",
    body: (
      <>
        <Para>
          いま定義しているトークンを当てはめると、命名は Primer 寄りである。
        </Para>
        <Bullets
          items={[
            <>
              <Code>--border-default</Code> / <Code>--text-secondary</Code> /{" "}
              <Code>--semantic-error-fg</Code> は「用途を短縮語で」の系統
            </>,
            <>
              <Code>--color-kyomurasaki-500</Code> / <Code>--space-4</Code>{" "}
              は「段階を数値で」の系統
            </>,
            "3層(プリミティブ / セマンティック / コンポーネント)の呼び方は Material・Ant Design と同じ",
          ]}
        />
        <Para>まだ持っていない概念で、今後効きそうなものは次の3つである。</Para>
        <TokenTable
          columns={[
            { key: "term", label: "概念", width: "200px" },
            { key: "from", label: "出典", width: "160px" },
            { key: "why", label: "必要になる場面" },
          ]}
          rows={[
            {
              term: "Anatomy",
              from: "SLDS / Atlassian ほか",
              why: "「部品」を定義するときの必須セクション。部位に名前を付けないと、状態やスタイルの指定先を書けない。",
            },
            {
              term: "強度の語彙",
              from: "Atlassian / Primer",
              why: "罫線や背景の段階が増えたとき。いまは default / strong の2段階しかない。",
            },
            {
              term: "Design history",
              from: "GOV.UK",
              why: "なぜその値にしたかの履歴。現状は git のコミットが代替しているが、/ui から読めると値の変更を判断しやすい。",
            },
          ]}
        />
        <Note>
          このページは他システムの用語を集めたものであり、YAOYOROZU がこれらを採用しているという意味ではない。
          採用したものは「基本」および「デザイントークン」のページに書く。
        </Note>
      </>
    ),
  },
];

export default function GlossaryPage() {
  return (
    <FoundationPage
      title="用語集"
      lead={
        <>
          <Para>
            デザインシステムの文書を読むときに出てくる用語をまとめたもの。
            同じ概念でもシステムごとに呼び名が違うため、対応が付かないと他のシステムを参考にできない。
          </Para>
          <Para>
            共通語と、システム固有の固有名詞に分けて並べている。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
