"use client";

// /claude(`~/.claude` の閲覧と編集)。markdown.sitter はブラウザにしか無い Web Component を登録するため、
// 画面ごと SSR から外す(`next/dynamic({ ssr: false })`)。`useSearchParams` は Suspense の中で使う。

import dynamic from "next/dynamic";
import { Suspense } from "react";

const ClaudePage = dynamic(() => import("@/ClaudePage"), { ssr: false });

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClaudePage />
    </Suspense>
  );
}
