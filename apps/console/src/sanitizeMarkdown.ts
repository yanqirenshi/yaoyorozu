// Markdown から作った HTML の無害化の設定(DOMPurify)。`safeMarkdown.ts` が使う。
// DOM の要素(custom element)に依存しない純粋な部分だけをここに置く(Node でテストできるように。
// `sanitizeMarkdown.test.ts`)。
//
// DOMPurify の既定(script・on 属性・`javascript:` を落とす)に加えて、次を締める:
// - タグ: HTML の標準プロファイルだけ(`<svg>`・`<math>` は出さない)。`<style>`・`<link>`・`<iframe>`・
//   `<object>`・`<embed>`・`<form>`・`<input>`・`<button>`・`<base>`・`<meta>`・`<script>` は落とす。
// - 属性: `style` は落とす(`url()` での読み込みを避ける)。`data-*` も落とす。
// - リンク・画像の URL: `http`・`https`・`mailto` と、スキームの無い相対・`#` だけ(`javascript:`・`data:`・
//   `vbscript:` などは落とす)。

import DOMPurify from "dompurify";

export const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    "script",
    "style",
    "link",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "base",
    "meta",
    "svg",
    "math",
  ],
  FORBID_ATTR: ["style"],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

/** Markdown から作った HTML を無害化する。 */
export function sanitizeMarkdownHtml(html: string): string {
  return String(DOMPurify.sanitize(html, PURIFY_CONFIG));
}
