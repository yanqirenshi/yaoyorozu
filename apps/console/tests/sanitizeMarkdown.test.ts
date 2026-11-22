// Markdown 表示の無害化のテスト(`npm run test --workspace=console`)。
// 4 つの表示(会話・Rules・Skills・CLAUDE.md)は、どれも `safeMarkdown.ts` / `SafeMarkdownViewer.tsx` を通し、
// その無害化は `sanitizeMarkdown.ts`。ここでは、細工した内容(<script>・<img onerror>・<svg onload>・
// javascript: のリンク・<style>@import・<iframe> など)を渡して、出力に危ないものが残らないことを確かめる。
// あわせて、Markdown を表示する要素を、共通の部品を通さずに使っていないこと(ソースの検査)も確かめる。

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// DOMPurify は import 時に window を見るので、先に用意する。
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { sanitizeMarkdownHtml } = await import("../src/sanitizeMarkdown.ts");
const { marked } = await import("marked");

function render(html: string): Document {
  return new JSDOM(`<!doctype html><body>${sanitizeMarkdownHtml(html)}</body>`).window.document;
}

const PAYLOADS: Record<string, string> = {
  script: "<p>a</p><script>window.__x=1</script>",
  imgOnerror: '<img src="http://127.0.0.1:1/x.png" onerror="window.__x=1">',
  svgOnload: '<svg onload="window.__x=1"><circle r="1"/></svg>',
  svgScript: "<svg><script>window.__x=1</script></svg>",
  jsLink: '<a href="javascript:window.__x=1">x</a>',
  jsLinkCase: '<a href="JaVaScRiPt:window.__x=1">x</a>',
  jsLinkEntity: '<a href="&#106;avascript:window.__x=1">x</a>',
  dataLink: '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
  vbLink: '<a href="vbscript:msgbox(1)">x</a>',
  styleImport: "<style>@import url(http://127.0.0.1:1/e.css)</style><p>a</p>",
  styleAttr: '<div style="background:url(http://127.0.0.1:1/bg.png)">a</div>',
  iframe: '<iframe src="http://127.0.0.1:1/"></iframe>',
  object: '<object data="http://127.0.0.1:1/"></object>',
  embed: '<embed src="http://127.0.0.1:1/">',
  form: '<form action="http://127.0.0.1:1/"><input name="a"><button>x</button></form>',
  base: '<base href="http://127.0.0.1:1/">',
  meta: '<meta http-equiv="refresh" content="0;url=http://127.0.0.1:1/">',
  link: '<link rel="stylesheet" href="http://127.0.0.1:1/l.css">',
  onclick: '<div onclick="window.__x=1">a</div>',
  onmouseover: '<p onmouseover="window.__x=1">a</p>',
  mathMtext: "<math><mtext><script>window.__x=1</script></mtext></math>",
  nestedTemplate: "<template><script>window.__x=1</script></template>",
  noscriptEscape: '<noscript><p title="</noscript><img src=x onerror=window.__x=1>"></noscript>',
};

const FORBIDDEN_TAGS = "script,style,link,iframe,frame,object,embed,applet,form,input,button,select,textarea,base,meta,svg,math";

for (const [name, html] of Object.entries(PAYLOADS)) {
  test(`無害化: ${name}`, () => {
    const doc = render(html);
    assert.equal(doc.querySelectorAll(FORBIDDEN_TAGS).length, 0, `危ないタグが残っている: ${doc.body.innerHTML}`);
    for (const el of doc.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        assert.ok(!/^on/i.test(attr), `on 属性が残っている: ${attr} in ${doc.body.innerHTML}`);
        assert.notEqual(attr, "style", `style 属性が残っている: ${doc.body.innerHTML}`);
      }
      for (const attr of ["href", "src"]) {
        const value = (el.getAttribute(attr) ?? "").replace(/[\s\u0000-\u001f]/g, "");
        assert.ok(!/^(javascript|data|vbscript):/i.test(value), `危ない URL が残っている: ${value}`);
      }
    }
    assert.ok(!doc.body.innerHTML.includes("__x"), `スクリプトの中身が残っている: ${doc.body.innerHTML}`);
  });
}

test("無害化: 正しいリンク・見出し・コード・表は残る", () => {
  const html = marked.parse(
    "# 見出し\n\n[ok](https://example.com/a) [mail](mailto:a@example.com) [rel](docs/x.md) [frag](#top)\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  ) as string;
  const doc = render(html);
  assert.equal(doc.querySelector("h1")?.textContent, "見出し");
  const hrefs = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.deepEqual(hrefs, ["https://example.com/a", "mailto:a@example.com", "docs/x.md", "#top"]);
  assert.ok(doc.querySelector("pre code"));
  assert.ok(doc.querySelector("table td"));
});

test("無害化: marked が生の HTML を通した場合(CLAUDE.md に細工)でも、危ないものが残らない", () => {
  const md = [
    "# 細工した内容",
    '<img src="http://127.0.0.1:1/x.png" onerror="window.__x=1">',
    "<script>window.__x=1</script>",
    '<svg onload="window.__x=1"><circle r="1"/></svg>',
    "[クリック](javascript:window.__x=1)",
    "<style>@import url(http://127.0.0.1:1/evil.css)</style>",
    '<iframe src="http://127.0.0.1:1/"></iframe>',
  ].join("\n");
  const doc = render(marked.parse(md) as string);
  assert.equal(doc.querySelectorAll(FORBIDDEN_TAGS).length, 0);
  assert.ok(!doc.body.innerHTML.toLowerCase().includes("onerror"));
  assert.ok(!doc.body.innerHTML.toLowerCase().includes("onload"));
  // リンクとして残らない(文字として残るのは害が無い)。
  for (const a of doc.querySelectorAll("a")) assert.ok(!/^javascript:/i.test(a.getAttribute("href") ?? ""));
  assert.equal(doc.querySelector("h1")?.textContent, "細工した内容");
});

// --- 共通の部品を通さずに Markdown を表示していないこと(新しく足すときも通さずに書けない) ---
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")
        ? [join(dir, e.name)]
        : [],
  );
}

test("Markdown の要素(markdown-viewer・markdown-workspace)は、共通の部品の外で書かれていない", () => {
  const src = join(import.meta.dirname, "..", "src");
  const allowed = new Set(["SafeMarkdownViewer.tsx", "ClaudeMdEditor.tsx", "safeMarkdown.ts"]);
  const offenders = sourceFiles(src)
    .filter((f) => !allowed.has(f.split(/[\\/]/).pop() ?? ""))
    .filter((f) => /<markdown-(viewer|workspace|editor)\b/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "Markdown は SafeMarkdownViewer(閲覧)か、ClaudeMdEditor(編集)で表示する");
});

test("ビューアへの内容の直接代入(.markdown = / .value =)は、safeMarkdown.ts の外に無い", () => {
  const src = join(import.meta.dirname, "..", "src");
  const offenders = sourceFiles(src)
    .filter((f) => !f.endsWith("safeMarkdown.ts"))
    .filter((f) => /\b(viewer|workspace)\.(markdown|value)\s*=[^=]/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "内容は setViewerMarkdown / setWorkspaceValue で渡す(先に無害化を仕込む)");
});

test("DOMPurify の呼び出しは sanitizeMarkdown.ts の外に無い(設定をばらさない)", () => {
  const src = join(import.meta.dirname, "..", "src");
  const offenders = sourceFiles(src)
    .filter((f) => !/(sanitizeMarkdown|externalLinks)\.ts$/.test(f))
    .filter((f) => /DOMPurify\.sanitize\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
