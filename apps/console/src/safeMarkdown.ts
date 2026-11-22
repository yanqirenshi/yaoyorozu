// Markdown を画面に出すときの無害化。**Markdown を表示する所は、すべてここを通す**(README にも書いた)。
//
// なぜ: `<markdown-viewer>`(markdown.sitter)は、marked が出した HTML を、既定では**素通し**で DOM に入れる
// (`sanitize` の既定は `(html) => html`)。CLAUDE.md・Rules・Skills・会話は、clone したリポジトリや
// エージェントが書くので、`<img src=x onerror=…>` のような細工が入りうる。この画面と同じオリジンで動くと、
// 中継(`/api/rpc/*`)を通して `~/.claude/settings.json` の読み書きまで届く(XSS)。
//
// 守りの形(3 重):
// 1. **`armViewer`**: 内容を渡す前に必ず呼ぶ。`sanitize` を設定し、さらに `parser` を包んで出力を必ず無害化する
//    (`sanitize` の設定が間に合わなくても、`parser` の出力が無害化される)。
// 2. **内容は `setViewerMarkdown` / `setWorkspaceValue` でしか渡さない**(どちらも先に arm する)。
//    effect の順番に頼らない。arm できない(要素が未アップグレード・ビューアが無い)ときは、内容を渡さない
//    (= 素通しの既定で描画することが起きない)。
// 3. 画面の応答に付ける Content-Security-Policy(`src/proxy.ts`)。万一無害化を抜けても、インラインの
//    スクリプトと on 属性は実行されず、外への送信・読み込みも出ていかない。
//
// markdown.sitter 側への要望(ライブラリで直すとよい点): `sanitize` の既定を素通しでなく安全側にする、
// `render()` の `this.sanitize(await this.parser(text))` が呼び出し先を await より前に評価するため、
// 描画の途中で `sanitize` を差し替えても反映されない点。

import { sanitizeMarkdownHtml } from "./sanitizeMarkdown";
import "@yanqirenshi/markdown.sitter";
import type { MarkdownViewer, MarkdownWorkspace } from "@yanqirenshi/markdown.sitter";
import "./externalLinks";


const ARMED = Symbol.for("yyz.markdown.armed");
type Armable = MarkdownViewer & { [ARMED]?: boolean };

/** 要素が markdown.sitter の定義でアップグレードされているか。 */
function isUpgraded(viewer: MarkdownViewer): boolean {
  return typeof viewer.render === "function" && typeof viewer.parser === "function";
}

/**
 * ビューアに無害化を仕込む(何度呼んでもよい)。仕込めたら `true`。
 * 仕込めない(未アップグレード)ときは `false`: その間は内容を渡してはならない。
 */
export function armViewer(viewer: MarkdownViewer | null | undefined): viewer is MarkdownViewer {
  if (!viewer || !isUpgraded(viewer)) return false;
  const target = viewer as Armable;
  viewer.sanitize = sanitizeMarkdownHtml;
  if (!target[ARMED]) {
    const base = viewer.parser;
    viewer.parser = async (markdown: string) => sanitizeMarkdownHtml(await base(markdown));
    target[ARMED] = true;
  }
  return true;
}

/** ビューアへ Markdown を渡す。先に無害化を仕込み、仕込めなければ渡さない(`false`)。 */
export function setViewerMarkdown(
  viewer: MarkdownViewer | null | undefined,
  markdown: string,
): boolean {
  if (!armViewer(viewer)) return false;
  viewer.markdown = markdown;
  return true;
}

/** ワークスペース(エディタ + プレビュー)のプレビュー側に、無害化を仕込む。 */
export function armWorkspace(workspace: MarkdownWorkspace | null | undefined): boolean {
  return armViewer(workspace?.viewer);
}

/**
 * ワークスペースへ本文を渡す。`value` を入れると `live` のプレビューも描画されるので、
 * 先にプレビューへ無害化を仕込み、仕込めなければ渡さない(`false`)。
 */
export function setWorkspaceValue(
  workspace: MarkdownWorkspace | null | undefined,
  value: string,
): boolean {
  if (!workspace || !armWorkspace(workspace)) return false;
  workspace.value = value;
  return true;
}
