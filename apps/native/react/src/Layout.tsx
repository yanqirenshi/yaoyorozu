import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DockItem } from "command-dock";
import AppDock from "./AppDock";
import { getSettings, onSettingsCorrupted, onSettingsUpdated, switchProfile } from "./api";
import type { ProfileSummaryDto } from "./api";
import { DockItemsProvider } from "./DockItemsContext";
import type { DirtyGuard } from "./DockItemsContext";
import { CLAUDE_SETTINGS_ICON, PROFILE_ICON, SETTINGS_ICON, VIEWER_ICON } from "./icons";
import { useWindowProfileId } from "./useWindowProfileId";
import "./App.css";

// OSウィンドウのタイトルバーに画面名を出す(ページ内の見出しは重複するため
// 置かない)。tauri.conf.json の既定値("YAOYOROZU")へは設定画面以外で戻す。
// メインウィンドウ(`?profile=`なし)の挙動はこのマップのみで決まり、
// issue #76 での変更対象ではない(挙動不変)。
const WINDOW_TITLE_BY_PATH: Record<string, string> = {
  "/settings": "設定",
  "/claude": "Claude",
};
const DEFAULT_WINDOW_TITLE = "YAOYOROZU";

// プロファイルを指定した別ウィンドウ(`?profile=`あり)のタイトルは
// 「<プロファイル名> - <ページ名>」にして、どのプロファイルのウィンドウかを
// 区別できるようにする(issue #76)。新しいウィンドウは常にビューア(`/`)を
// 開く(open_profile_window)ため実質「/」しか使わないが、念のため他の
// パスも用意しておく。
const PAGE_LABEL_BY_PATH: Record<string, string> = {
  "/": "ビューア",
  "/hub": "ハブ",
  "/settings": "設定",
  "/claude": "Claude",
};

// AppDock(グローバルメニュー)は全画面共通のためレイアウト側に置く
// (native.md §6)。画面遷移用の項目は常設、ページ固有の項目(再読み込み等)は
// DockItemsProvider 経由で各ページが登録する。
function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const windowProfileId = useWindowProfileId();
  const [pageItems, setPageItems] = useState<DockItem[]>([]);
  const [corruptionWarning, setCorruptionWarning] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  // プロファイル切り替え前に、表示中のページの未保存編集を確認するための
  // フック(issue #72。usePageDirtyGuard 参照)。
  const dirtyGuardRef = useRef<DirtyGuard | null>(null);

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
    // `windowProfileId` があれば(別ウィンドウ)「<プロファイル名> - <ページ名>」、
    // なければ(メインウィンドウ)従来どおりの挙動(issue #76)。
    const profileName = windowProfileId
      ? profiles.find((p) => p.id === windowProfileId)?.name
      : null;
    const title = profileName
      ? `${profileName} - ${PAGE_LABEL_BY_PATH[location.pathname] ?? DEFAULT_WINDOW_TITLE}`
      : (WINDOW_TITLE_BY_PATH[location.pathname] ?? DEFAULT_WINDOW_TITLE);
    void getCurrentWindow().setTitle(title);
  }, [location.pathname, windowProfileId, profiles]);

  // プロファイル一覧・アクティブIDはdockのクイック切り替え(吹き出し)表示に
  // 使う。全画面共通のため Layout 自身が取得する(issue #72)。
  useEffect(() => {
    const loadProfiles = () => {
      getSettings()
        .then((settings) => {
          setProfiles(settings.profiles);
          setActiveProfileId(settings.active_profile_id);
        })
        .catch((e) => console.error(e));
    };
    loadProfiles();
    const unlistenPromise = onSettingsUpdated(loadProfiles);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // ナビトリガーは即アクション型の丸アイコン。表示中のページ自身へのトリガーは
  // 出す意味がないため表示しない(遷移先が1つだけなら1個だけ出る)。
  // 常に先頭(ページ固有アイテムより前)に置き、ページ間で位置が揺れないようにする。
  const navItems = useMemo<DockItem[]>(() => {
    const items: DockItem[] = [];
    // `windowProfileId` があるウィンドウ(ハブから開いたビューア。issue #76)
    // は自分自身のビューアへ戻るトリガーを、無いウィンドウ(メイン)は
    // ハブへ戻るトリガーを出す(issue #84: メインウィンドウはハブが起点で
    // あり、ビューアはハブから開いた別ウィンドウが担う)。
    if (windowProfileId) {
      if (location.pathname !== "/") {
        items.push({
          id: "nav-sessions",
          label: VIEWER_ICON,
          title: "ビューア",
          onClick: () => navigate(`/?profile=${encodeURIComponent(windowProfileId)}`),
        });
      }
    } else if (location.pathname !== "/hub") {
      items.push({
        id: "nav-hub",
        label: VIEWER_ICON,
        title: "ハブ",
        onClick: () => navigate("/hub"),
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
    // プロファイルが1件のみの場合はトリガーを出さない(ノイズ回避。issue #72)。
    if (profiles.length > 1) {
      items.push({
        id: "nav-profile",
        label: PROFILE_ICON,
        title: "プロファイル",
        popup: profiles.map((p) => ({
          label: p.name,
          active: p.id === activeProfileId,
          onSelect: () => {
            if (p.id === activeProfileId) return;
            if (dirtyGuardRef.current && !dirtyGuardRef.current()) return;
            switchProfile(p.id).catch((e) => console.error(e));
          },
        })),
      });
    }
    return items;
  }, [location.pathname, navigate, profiles, activeProfileId, windowProfileId]);

  const items = useMemo<DockItem[]>(
    () => [...navItems, ...pageItems],
    [navItems, pageItems],
  );

  return (
    <div className="app-shell">
      {corruptionWarning && (
        <p className="corruption-warning">{corruptionWarning}</p>
      )}
      <DockItemsProvider setItems={setPageItems} dirtyGuardRef={dirtyGuardRef}>
        <Outlet />
      </DockItemsProvider>
      <AppDock items={items} />
    </div>
  );
}

export default Layout;
