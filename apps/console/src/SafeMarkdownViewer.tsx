"use client";

// Markdown の閲覧専用の表示(会話・Rules・Skills)。`<markdown-viewer>` を直接置かず、これを使う
// (無害化を、内容を渡す前に 1 か所で必ず仕込むため。`safeMarkdown.ts` を参照)。

import { useEffect, useRef } from "react";
import type { MarkdownViewer } from "@yanqirenshi/markdown.sitter";
import { setViewerMarkdown } from "./safeMarkdown";

type SafeMarkdownViewerProps = {
  text: string;
  className?: string;
  /** 見出しの折り畳み。既定は true(markdown-viewer の既定)。 */
  foldable?: boolean;
};

export default function SafeMarkdownViewer({
  text,
  className,
  foldable = true,
}: SafeMarkdownViewerProps) {
  const viewerRef = useRef<MarkdownViewer | null>(null);

  // 1 つの effect の中で「無害化を仕込む → 見出しの折り畳みを決める → 内容を渡す」を順に行う
  // (effect の宣言順に頼らない)。無害化を仕込めなければ、内容は渡さない。
  // `foldable` は接続後に明示的に設定し直す(コンポーネントの connectedCallback が既定で true を足すため)。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.foldable = foldable;
    setViewerMarkdown(viewer, text);
  }, [text, foldable]);

  return <markdown-viewer ref={viewerRef} className={className} />;
}
