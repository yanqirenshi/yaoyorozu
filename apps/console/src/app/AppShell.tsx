"use client";

// 共通の枠(dock・警告の表示・ウィンドウのタイトル)。
// 写し元: `apps/native/react/src/Layout.tsx`。Tauri 固有の部分を替えた:
// - react-router(`Outlet`・`useLocation`・`useNavigate`)→ next/navigation の `usePathname`・`useRouter`
// - ウィンドウのタイトル(`getCurrentWindow().setTitle`)→ `document.title`
// - 複数ウィンドウ(`useWindowProfileId`・ビューア別ウィンドウ)は #620 の決定で写さない。
//   段階 4 でブラウザ側(BroadcastChannel)で作る。
// - `settings:corrupted` は起動直後に出て取りこぼすため、画面を開いたときと、つなぎ直したときに
//   `list_pending_warnings` で控えを取る(この構成だけの Query)。

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import type { DockItem } from "command-dock";
import type { ConnectionState } from "@/api";
import {
  dismissPendingWarning,
  listPendingWarnings,
  onAppWarning,
  onConnectionChange,
  onReconnected,
  onSettingsCorrupted,
} from "@/api";
import { DockItemsProvider } from "@/DockItemsContext";
import type { PageDockItem } from "@/DockItemsContext";
import { CLAUDE_SETTINGS_ICON, SETTINGS_ICON, VIEWER_ICON } from "@/icons";

// command-dock はブラウザにしか無い Web Component のため、サーバ側の描画から外す。
const AppDock = dynamic(() => import("@/AppDock"), { ssr: false });

// 画面ごとの定義(dock のナビ項目・タイトル)。ルートが増えたら、ここへ足す
// (ハブ `/`・`/claude`・`/profiles` は後の段階)。
type NavRoute = {
  id: string;
  path: string;
  title: string;
  icon: string;
};

const NAV_ROUTES: NavRoute[] = [
  // ビューア。Tauri 版と同じ「先頭」(ハブができるまでの間はここが起点)。
  { id: "nav-sessions", path: "/profiles", title: "ビューア", icon: VIEWER_ICON },
  { id: "nav-settings", path: "/settings", title: "設定", icon: SETTINGS_ICON },
  { id: "nav-claude", path: "/claude", title: "Claude", icon: CLAUDE_SETTINGS_ICON },
];

const DEFAULT_WINDOW_TITLE = "YAOYOROZU";

// 表示中の警告 1 件。`serverId` はサーバの控えの id(閉じるとき、控えからも消す)。
// イベントで届いたもの(`serverId` なし)は画面の中だけで消す。
type Warning = {
  key: string;
  serverId: number | null;
  message: string;
};

// イベントで届いた警告のキーの連番(再マウントしても重ならないよう、モジュールで持つ)。
let eventSeq = 0;

function routeForPath(pathname: string): NavRoute | null {
  // ビューアは `/profiles` と `/profiles/<id>` の両方(パスパラメータでプロファイルが決まる)。
  return (
    NAV_ROUTES.find(
      (r) => r.path === pathname || (r.path === "/profiles" && pathname.startsWith("/profiles/")),
    ) ?? null
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pageItems, setPageItems] = useState<PageDockItem[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  // 控えの警告を取り込む。同じ文言がイベントで届いて既に出ていれば、新しく足さず、控えの id を引き継ぐ
  // (閉じたとき、控えからも消すため)。
  const loadPendingWarnings = useCallback(() => {
    listPendingWarnings()
      .then((pending) => {
        setWarnings((current) => {
          let next = current;
          for (const p of pending) {
            const key = `server-${p.id}`;
            if (next.some((w) => w.key === key)) continue;
            const sameMessage = next.find((w) => w.message === p.message);
            next = sameMessage
              ? next.map((w) =>
                  w === sameMessage ? { ...w, serverId: p.id } : w,
                )
              : [...next, { key, serverId: p.id, message: p.message }];
          }
          return next;
        });
      })
      .catch((e) => console.error(e));
  }, []);

  // 接続状態(切れている間だけ「サーバに接続できません」を出す)。
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  useEffect(() => {
    const unlistenPromise = onConnectionChange(setConnection);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // 画面を開いたとき。
  useEffect(() => {
    loadPendingWarnings();
  }, [loadPendingWarnings]);

  // つなぎ直せたとき(切れている間の警告は、控えから取り直す)。
  useEffect(() => {
    const unlistenPromise = onReconnected(loadPendingWarnings);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadPendingWarnings]);

  // 届いたイベントは、そのまま積む。複数届きうるので一覧にし、利用者が個別に消せる。
  // 同じ文言が既に出ていれば足さない(控えと重なるため)。
  useEffect(() => {
    // `id` は、サーバの控えの id(イベントに付いて届く)。付いていれば、閉じるとき控えからも消せる
    // (消さないと、控えから積み直されて、閉じても出続ける)。
    const push = (message: string, id?: number) => {
      setWarnings((current) => {
        const same = current.find((w) => w.message === message);
        if (same) {
          return id !== undefined && same.serverId === null
            ? current.map((w) => (w === same ? { ...w, serverId: id } : w))
            : current;
        }
        return [
          ...current,
          { key: `event-${eventSeq++}`, serverId: id ?? null, message },
        ];
      });
    };
    const corrupted = onSettingsCorrupted(({ message }) => push(message));
    const appWarning = onAppWarning(({ message, id }) => push(message, id));
    return () => {
      void corrupted.then((unlisten) => unlisten());
      void appWarning.then((unlisten) => unlisten());
    };
  }, []);

  const dismissWarning = (warning: Warning) => {
    setWarnings((current) => current.filter((w) => w.key !== warning.key));
    if (warning.serverId !== null) {
      dismissPendingWarning(warning.serverId).catch((e) => console.error(e));
    }
  };

  // OS のウィンドウのタイトルに当たるもの。ページ内の見出しは重複するため置かない。
  const currentRoute = routeForPath(pathname);
  useEffect(() => {
    // ビューアのタイトルは、プロファイル名にする(Tauri 版の viewerWindowTitle。画面側が設定する)。
    if (currentRoute?.id === "nav-sessions") return;
    document.title = currentRoute ? currentRoute.title : DEFAULT_WINDOW_TITLE;
  }, [currentRoute]);

  // ナビトリガーは即アクション型の丸アイコン。表示中のページ自身の分も含めて常に同じ並び・位置で
  // 出す(位置を覚えられる)。表示中のページのものは背景を金茶-400 にして現在地を示し
  // (`currentNavId`。AppDock 参照)、クリックしても何もしない(遷移済み)。
  const currentNavId = currentRoute?.id ?? null;

  const navItems = useMemo<DockItem[]>(
    () =>
      NAV_ROUTES.map((route) => ({
        id: route.id,
        label: route.icon,
        title: route.title,
        onClick: () => {
          if (route.id !== currentNavId) router.push(route.path);
        },
      })),
    [currentNavId, router],
  );

  const items = useMemo<PageDockItem[]>(
    () => [...navItems, ...pageItems],
    [navItems, pageItems],
  );
  // ページ固有項目だけ背景色を変える(AppDock 参照)。
  const pageItemIds = useMemo(() => pageItems.map((item) => item.id), [pageItems]);

  return (
    <div className="app-shell">
      {connection === "disconnected" && (
        <div className="app-warning-list" data-testid="connection-status">
          <p className="app-warning">
            <span>サーバに接続できません。つながり次第、自動で表示を取り直します。</span>
          </p>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="app-warning-list">
          {warnings.map((warning) => (
            <p key={warning.key} className="app-warning">
              <span>{warning.message}</span>
              <button
                type="button"
                className="app-warning-dismiss"
                onClick={() => dismissWarning(warning)}
              >
                ×
              </button>
            </p>
          ))}
        </div>
      )}
      <DockItemsProvider setItems={setPageItems}>{children}</DockItemsProvider>
      <AppDock items={items} pageItemIds={pageItemIds} currentItemId={currentNavId} />
    </div>
  );
}
