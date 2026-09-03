import { useUrlViewerNav } from "../viewerNav";
import SessionsPage from "./SessionsPage";

// `/profiles/:profileId?` のルート本体(issue #91)。「1ウィンドウ = 1
// プロファイル」への一本化でウィンドウ内タブバー(旧 issue #77)を廃止した
// ため、画面状態はURLクエリを状態源とする `useUrlViewerNav` から作った
// `ViewerNav` をそのまま `SessionsPage` へ渡すだけの薄いラッパーになる
// (native.md §6)。
function ViewerPage() {
  const nav = useUrlViewerNav();
  return <SessionsPage nav={nav} />;
}

export default ViewerPage;
