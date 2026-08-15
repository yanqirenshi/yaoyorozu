import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import type { DockItem } from "command-dock";
import AppDock from "./AppDock";
import { onSettingsCorrupted } from "./api";
import { DockItemsProvider } from "./DockItemsContext";
import { NAV_ICON } from "./icons";
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

  const navItem = useMemo<DockItem>(
    () => ({
      id: "nav",
      label: NAV_ICON,
      title: "画面切り替え",
      popup: [
        {
          label: "ビューア",
          active: location.pathname === "/",
          onSelect: () => navigate("/"),
        },
        {
          label: "設定",
          active: location.pathname === "/settings",
          onSelect: () => navigate("/settings"),
        },
      ],
    }),
    [location.pathname, navigate],
  );

  const items = useMemo<DockItem[]>(() => [navItem, ...pageItems], [navItem, pageItems]);

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
