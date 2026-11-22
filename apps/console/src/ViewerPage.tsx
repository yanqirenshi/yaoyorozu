"use client";

import { useUrlViewerNav } from "./viewerNav";
import SessionsPage from "./SessionsPage";

// `/profiles/[[...profileId]]` のルート本体(Tauri 版 `pages/ViewerPage.tsx` の写し。issue #91)。
// 画面状態は URL クエリを状態源とする `useUrlViewerNav` から作った `ViewerNav` を、そのまま
// `SessionsPage` へ渡すだけの薄いラッパー(native.md §6)。
function ViewerPage() {
  const nav = useUrlViewerNav();
  return <SessionsPage nav={nav} />;
}

export default ViewerPage;
