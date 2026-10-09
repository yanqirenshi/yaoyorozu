import { createElement, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { roleColor } from "@/data/uiDesign";
import { textStyle } from "@/components/tokens";

/**
 * 判断の記録(`{repo}/yyz/spec/{doc}.md`。#587)を描く部品。
 *
 * ライブラリ(`react-markdown` + `remark-gfm`)を使う判断にした。移す対象
 * (`tm.ts`・`classes-domain.ts` 等)のコメントは見出し・箇条書き・表・コード
 * ブロック・強調・リンクを普通に使っており、自前のパーサーでは取りこぼしが
 * 怖い。`react-markdown` は Markdown を React 要素へ変換する(`dangerouslySetInnerHTML`
 * を使わない)ため、リポジトリ内の信頼できる Markdown とはいえ、素朴な HTML 注入より
 * 安全。依存が2つ(`react-markdown`・GFM(表・取り消し線等)用の `remark-gfm`)増える。
 *
 * 色・文字の大きさは基本デザインのトークンから引く(規約 web.md §4)。まだ `/ui` の
 * パーツとしては定義していない(この部品を使う画面がまだ無いため)。使う画面の担当が
 * 見た目を詰めるときに、必要なら `/ui` へ登録することを想定している。
 */

const BORDER = roleColor("border.default");
const LINK_COLOR = roleColor("link.default");
const SURFACE_SUNKEN = roleColor("surface.sunken");
const TEXT_PRIMARY = roleColor("text.primary");
const TEXT_SECONDARY = roleColor("text.secondary");

const bodyStyle = textStyle("Body-16N-170");
const monoStyle = textStyle("Mono-14N-150");

// 以前は見た目をトークンで当てれば十分として <p> を返していたが、400行超の
// 記録(classes.md・tm.md 等)では見出しへジャンプできず実用上困る(#596)。
// h1〜h6 のまま返し、見た目はこれまでと同じく style で上書きする。
//
// id(アンカーリンク用)は振らない。`style` で全プロパティを明示しているため
// 見た目には影響しないが、見出しへジャンプする機能(目次等)を使う画面はまだ
// 無い。必要になった時点で rehype-slug 等の導入を検討する(先回りしない)。
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

function heading(tag: HeadingTag, name: string) {
  return function Heading(props: ComponentPropsWithoutRef<HeadingTag>) {
    return createElement(tag, {
      ...props,
      style: { ...textStyle(name), color: TEXT_PRIMARY, margin: "1.2em 0 0.4em" },
    });
  };
}

const components: Components = {
  h1: heading("h1", "Head-24B-150"),
  h2: heading("h2", "Head-20B-150"),
  h3: heading("h3", "Head-18B-150"),
  h4: heading("h4", "Head-16B-150"),
  h5: heading("h5", "Head-16B-150"),
  h6: heading("h6", "Head-16B-150"),
  p: (props) => (
    <p {...props} style={{ ...bodyStyle, color: TEXT_PRIMARY, margin: "0.6em 0" }} />
  ),
  // Tailwind のリセット(preflight)が ul/ol の list-style を消すため、明示的に戻す。
  ul: (props) => (
    <ul
      {...props}
      style={{ ...bodyStyle, color: TEXT_PRIMARY, listStyle: "disc", paddingLeft: "1.5em" }}
    />
  ),
  ol: (props) => (
    <ol
      {...props}
      style={{ ...bodyStyle, color: TEXT_PRIMARY, listStyle: "decimal", paddingLeft: "1.5em" }}
    />
  ),
  li: (props) => <li {...props} style={{ margin: "0.2em 0" }} />,
  a: (props) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: LINK_COLOR, textDecoration: "underline" }}
    />
  ),
  strong: (props) => <strong {...props} style={{ fontWeight: 700 }} />,
  blockquote: (props) => (
    <blockquote
      {...props}
      style={{
        margin: "0.6em 0",
        padding: "0 1em",
        borderLeft: `3px solid ${BORDER}`,
        color: TEXT_SECONDARY,
      }}
    />
  ),
  hr: (props) => <hr {...props} style={{ border: "none", borderTop: `1px solid ${BORDER}` }} />,
  table: (props) => (
    <table
      {...props}
      style={{ ...bodyStyle, borderCollapse: "collapse", margin: "0.8em 0" }}
    />
  ),
  th: (props) => (
    <th
      {...props}
      style={{
        border: `1px solid ${BORDER}`,
        padding: "4px 8px",
        textAlign: "left",
        backgroundColor: SURFACE_SUNKEN,
      }}
    />
  ),
  td: (props) => (
    <td {...props} style={{ border: `1px solid ${BORDER}`, padding: "4px 8px" }} />
  ),
  code: ({ className, ...props }) => {
    // remark-gfm はインラインコードとコードブロックの中身をどちらも <code> に
    // 渡す。コードブロックは言語クラス(例 `language-ts`)が付くか、親が <pre> な
    // ので、ここでは言語クラスの有無で区別する(react-markdown v9 以降は `inline`
    // プロパティを渡さなくなったため)。
    const isBlock = typeof className === "string" && className.startsWith("language-");
    return (
      <code
        {...props}
        className={className}
        style={{
          ...monoStyle,
          color: TEXT_PRIMARY,
          backgroundColor: isBlock ? "transparent" : SURFACE_SUNKEN,
          padding: isBlock ? 0 : "0.1em 0.3em",
          borderRadius: 4,
        }}
      />
    );
  },
  pre: (props) => (
    <pre
      {...props}
      style={{
        backgroundColor: SURFACE_SUNKEN,
        padding: "0.8em 1em",
        borderRadius: 8,
        overflowX: "auto",
        margin: "0.6em 0",
      }}
    />
  ),
};

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
