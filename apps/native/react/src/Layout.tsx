import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DockItem } from "command-dock";
import AppDock from "./AppDock";
import { getSettings, onSettingsCorrupted, onSettingsUpdated } from "./api";
import type { ProfileSummaryDto } from "./api";
import { DockItemsProvider } from "./DockItemsContext";
import type { PageDockItem } from "./DockItemsContext";
import {
  CLAUDE_SETTINGS_ICON,
  HUB_ICON,
  SETTINGS_ICON,
  VIEWER_ICON,
} from "./icons";
import { useWindowProfileId } from "./useWindowProfileId";
import "./App.css";

// OSウィンドウのタイトルバーに画面名を出す(ページ内の見出しは重複するため
// 置かない)。tauri.conf.json の既定値("YAOYOROZU")へは設定画面以外で戻す。
// メインウィンドウ(プロファイル文脈なし)の挙動はこのマップのみで決まり、
// issue #76 での変更対象ではない(挙動不変)。「/」(ハブ)はここに含めず
// デフォルト値へフォールバックさせる(issue #88)。
const WINDOW_TITLE_BY_PATH: Record<string, string> = {
  "/settings": "設定",
  "/claude": "Claude",
};
const DEFAULT_WINDOW_TITLE = "YAOYOROZU";

// プロファイルを指定した別ウィンドウ(`/profiles/:id`)のタイトルは
// 「<プロファイル名> - <ページ名>」にして、どのプロファイルのウィンドウかを
// 区別できるようにする(issue #76)。ただしビューアは、ページ名(「ビューア」)を付けず
// プロファイル名だけにする(issue #348・#377。下記 `viewerWindowTitle`)。
function pageLabelForPath(pathname: string): string {
  if (pathname === "/settings") return "設定";
  if (pathname === "/claude") return "Claude";
  return DEFAULT_WINDOW_TITLE;
}

// ビューア(`/profiles/:id`。パスパラメータを含むため完全一致ではなく
// プレフィックス判定。issue #88)のウィンドウタイトル。プロファイル名だけ(issue #377。
// 以前は「<プロファイル名> - <対象フォルダ名を「 / 」でつないだもの>」だったが、対象
// フォルダが増えると長大になり意味も読み取れないため、フォルダ名の列挙をやめた)。
// Rust 側の初期タイトル(`app::viewer_window_title`。ウィンドウ生成時)と同じ規則で、
// プロファイル名の変更にはここで追従する。
function isViewerPath(pathname: string): boolean {
  return pathname === "/profiles" || pathname.startsWith("/profiles/");
}

function viewerWindowTitle(profileName: string): string {
  return profileName;
}

// AppDock(グローバルメニュー)は全画面共通のためレイアウト側に置く
// (native.md §6)。画面遷移用の項目は常設、ページ固有の項目(再読み込み等)は
// DockItemsProvider 経由で各ページが登録する。
function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const windowProfileId = useWindowProfileId();
  const [pageItems, setPageItems] = useState<PageDockItem[]>([]);
  const [corruptionWarning, setCorruptionWarning] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);

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
      ? isViewerPath(location.pathname)
        ? viewerWindowTitle(profileName)
        : `${profileName} - ${pageLabelForPath(location.pathname)}`
      : (WINDOW_TITLE_BY_PATH[location.pathname] ?? DEFAULT_WINDOW_TITLE);
    void getCurrentWindow().setTitle(title);
  }, [location.pathname, windowProfileId, profiles]);

  // プロファイル一覧は別ウィンドウのタイトル(「<プロファイル名> - <ページ名>」)
  // に使う。全画面共通のため Layout 自身が取得する(issue #72・#76)。
  useEffect(() => {
    const loadProfiles = () => {
      getSettings(windowProfileId)
        .then((settings) => {
          setProfiles(settings.profiles);
        })
        .catch((e) => console.error(e));
    };
    loadProfiles();
    const unlistenPromise = onSettingsUpdated(loadProfiles);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [windowProfileId]);

  // ナビトリガーは即アクション型の丸アイコン。表示中のページ自身の分も含めて
  // 常に同じ並び・位置で出す(issue #253。ページごとに項目がずれない=位置を
  // 覚えられる)。表示中のページのものは背景を金茶-400 にして現在地を示し
  // (`currentNavId`。AppDock 参照)、クリックしても何もしない(遷移済み)。
  // 常に先頭(ページ固有アイテムより前)に置く。
  // `windowProfileId` があるウィンドウ(ハブから開いたビューア。issue #76)
  // は自分自身のビューアへのトリガーを、無いウィンドウ(メイン)はハブへの
  // トリガーを出す(issue #84: メインウィンドウはハブが起点であり、ビューアは
  // ハブから開いた別ウィンドウが担う)。
  const onViewerRoute =
    location.pathname === "/profiles" || location.pathname.startsWith("/profiles/");
  const currentNavId = windowProfileId
    ? onViewerRoute
      ? "nav-sessions"
      : location.pathname === "/settings"
        ? "nav-settings"
        : location.pathname === "/claude"
          ? "nav-claude"
          : null
    : location.pathname === "/"
      ? "nav-hub"
      : location.pathname === "/settings"
        ? "nav-settings"
        : location.pathname === "/claude"
          ? "nav-claude"
          : null;

  const navItems = useMemo<DockItem[]>(() => {
    // 表示中のページ自身のトリガーは何もしない(誤クリックで再遷移しない)。
    const goto = (id: string, path: string) => () => {
      if (id !== currentNavId) navigate(path);
    };
    const items: DockItem[] = [];
    if (windowProfileId) {
      items.push({
        id: "nav-sessions",
        label: VIEWER_ICON,
        title: "ビューア",
        onClick: goto("nav-sessions", `/profiles/${encodeURIComponent(windowProfileId)}`),
      });
    } else {
      items.push({ id: "nav-hub", label: HUB_ICON, title: "ハブ", onClick: goto("nav-hub", "/") });
    }
    items.push({
      id: "nav-settings",
      label: SETTINGS_ICON,
      title: "設定",
      onClick: goto("nav-settings", "/settings"),
    });
    items.push({
      id: "nav-claude",
      label: CLAUDE_SETTINGS_ICON,
      title: "Claude",
      onClick: goto("nav-claude", "/claude"),
    });
    // dock のプロファイル切り替え(issue #72)はユーザー指示で削除した。
    // アクティブプロファイルの切り替えは設定画面のプロファイル一覧で行う。
    return items;
  }, [currentNavId, navigate, windowProfileId]);

  const items = useMemo<PageDockItem[]>(
    () => [...navItems, ...pageItems],
    [navItems, pageItems],
  );
  // ページ固有項目だけ背景色を変える(issue #246。AppDock 参照)。
  const pageItemIds = useMemo(() => pageItems.map((item) => item.id), [pageItems]);

  return (
    <div className="app-shell">
      {corruptionWarning && (
        <p className="corruption-warning">{corruptionWarning}</p>
      )}
      <DockItemsProvider setItems={setPageItems}>
        <Outlet />
      </DockItemsProvider>
      {/* ビューア(`/profiles/:id`)では dock を表示しない(会話表示に重なって
          邪魔になるため。issue #257)。ビューアの操作はページ内のツールバー
          (ViewerToolbar)にある。 */}
      {!onViewerRoute && (
        <AppDock items={items} pageItemIds={pageItemIds} currentItemId={currentNavId} />
      )}
    </div>
  );
}

export default Layout;
