import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import type { DockItem } from "command-dock";
import AppDock from "./AppDock";
import { onSettingsCorrupted } from "./api";
import { DockItemsProvider } from "./DockItemsContext";
import { SETTINGS_ICON, VIEWER_ICON } from "./icons";
import "./App.css";

// AppDock(グローバルメニュー)は全画面共通のためレイアウト側に置く
// (native.md §6)。画面遷移用の項目は常設、ページ固有の項目(再読み込み等)は
// DockItemsProvider 経由で各ページが登録する。
function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [pageItems, setPageItems] = useState<DockItem[]>([]);
  const [corruptionWarning, setCorruptionWarning] = useState<string | null>(null);

  useEffect(() => {
    // 設定ファイルの破損は起動直後(まだ /settings にいるとは限らない)に
    // 届きうるため、常にマウントされているレイアウト側で受け取る。
    const unlistenPromise = onSettingsCorrupted(({ message }) => {
      setCorruptionWarning(message);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // ナビトリガーは即アクション型の丸アイコン2個。表示中ページのトリガーは
  // disabled にして現在地を示す(即アクション型には active 述語がないため)。
  // 常に先頭(ページ固有アイテムより前)に置き、ページ間で位置が揺れないようにする。
  const navItems = useMemo<DockItem[]>(
    () => [
      {
        id: "nav-sessions",
        label: VIEWER_ICON,
        title: "ビューア",
        onClick: () => navigate("/"),
        disabled: location.pathname === "/",
      },
      {
        id: "nav-settings",
        label: SETTINGS_ICON,
        title: "設定",
        onClick: () => navigate("/settings"),
        disabled: location.pathname === "/settings",
      },
    ],
    [location.pathname, navigate],
  );

  const items = useMemo<DockItem[]>(
    () => [...navItems, ...pageItems],
    [navItems, pageItems],
  );

  return (
    <div className="app-shell">
      {corruptionWarning && (
        <p className="corruption-warning">{corruptionWarning}</p>
      )}
      <DockItemsProvider setItems={setPageItems}>
        <Outlet />
      </DockItemsProvider>
      <AppDock items={items} />
    </div>
  );
}

export default Layout;
