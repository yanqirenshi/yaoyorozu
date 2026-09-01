import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DockItem } from "command-dock";
import AppDock from "./AppDock";
import { onSettingsCorrupted } from "./api";
import { DockItemsProvider } from "./DockItemsContext";
import { CLAUDE_SETTINGS_ICON, SETTINGS_ICON, VIEWER_ICON } from "./icons";
import "./App.css";

// OSウィンドウのタイトルバーに画面名を出す(ページ内の見出しは重複するため
// 置かない)。tauri.conf.json の既定値("YAOYOROZU")へは設定画面以外で戻す。
const WINDOW_TITLE_BY_PATH: Record<string, string> = {
  "/settings": "設定",
  "/claude": "Claude",
};
const DEFAULT_WINDOW_TITLE = "YAOYOROZU";

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

  useEffect(() => {
    const title = WINDOW_TITLE_BY_PATH[location.pathname] ?? DEFAULT_WINDOW_TITLE;
    void getCurrentWindow().setTitle(title);
  }, [location.pathname]);

  // ナビトリガーは即アクション型の丸アイコン。表示中のページ自身へのトリガーは
  // 出す意味がないため表示しない(遷移先が1つだけなら1個だけ出る)。
  // 常に先頭(ページ固有アイテムより前)に置き、ページ間で位置が揺れないようにする。
  const navItems = useMemo<DockItem[]>(() => {
    const items: DockItem[] = [];
    if (location.pathname !== "/") {
      items.push({
        id: "nav-sessions",
        label: VIEWER_ICON,
        title: "ビューア",
        onClick: () => navigate("/"),
      });
    }
    if (location.pathname !== "/settings") {
      items.push({
        id: "nav-settings",
        label: SETTINGS_ICON,
        title: "設定",
        onClick: () => navigate("/settings"),
      });
    }
    if (location.pathname !== "/claude") {
      items.push({
        id: "nav-claude",
        label: CLAUDE_SETTINGS_ICON,
        title: "Claude",
        onClick: () => navigate("/claude"),
      });
    }
    return items;
  }, [location.pathname, navigate]);

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
