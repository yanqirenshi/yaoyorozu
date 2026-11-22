// 会話・CLAUDE.md・Rules・Skills の Markdown 内のリンクを、別のタブで開く(Tauri 版の
// `external_link_guard.rs` の代わり。ブラウザでは、同じタブで開くと画面(と編集中の内容)を失う)。
// DOMPurify は無害化のあとに `target` を足しても残る。`noopener noreferrer` で開いた先から
// この画面(`window.opener`)を触らせない。
//
// このモジュールを import するだけでフックが入る(重複して入れない)。

import DOMPurify from "dompurify";

let installed = false;

export function installExternalLinkHook(): void {
  if (installed) return;
  installed = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

installExternalLinkHook();

/** 外部の URL を別のタブで開く(`openUrl` の代わり)。 */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
