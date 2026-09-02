import { useWindowProfileId } from "../useWindowProfileId";
import SessionsPage from "./SessionsPage";
import TabbedSessionsPage from "./TabbedSessionsPage";

// `/` の実体を、メインウィンドウ(タブバー。issue #77)と Phase 1 の別
// ウィンドウ(`?profile=`。issue #76。タブ化のスコープ外)とで出し分ける。
function ViewerRoute() {
  const windowProfileId = useWindowProfileId();
  if (windowProfileId) {
    return <SessionsPage />;
  }
  return <TabbedSessionsPage />;
}

export default ViewerRoute;
