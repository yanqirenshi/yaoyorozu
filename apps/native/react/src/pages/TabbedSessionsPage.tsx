import { useCallback, useEffect, useState } from "react";
import { getSettings, onSettingsUpdated, saveOpenTabs } from "../api";
import type { ProfileSummaryDto, WindowTabDto } from "../api";
import { useDirtyGuardCheck } from "../DockItemsContext";
import TabBar from "../TabBar";
import { useReportWindowState } from "../useReportWindowState";
import { useTabViewerNav } from "../viewerNav";
import type { TabPosition } from "../viewerNav";
import SessionsPage from "./SessionsPage";

type Tab = TabPosition & { id: string };

function newTabId(): string {
  return crypto.randomUUID();
}

function newTab(profileId: string): Tab {
  return {
    id: newTabId(),
    profileId,
    view: null,
    project: null,
    session: null,
    rule: null,
    skill: null,
    sessionTitle: null,
  };
}

// メインウィンドウのビューア(`/`)相当の内容をタブ化する(マルチウィンドウ
// Phase 2。issue #77)。1つのタブ = 「プロファイル+画面状態」の組。実際に
// マウントするのはアクティブなタブぶんの `SessionsPage` 1つだけで、タブを
// 切り替えるたびに `key` を変えて作り直す(= その他のタブの画面状態は
// SessionsPage 内部の state ではなく、このコンポーネントが持つ `tabs`
// 配列側に置く。native.md §6)。これにより非アクティブなタブは常に
// アンマウント状態になり、dock 項目・破棄確認ガード(`usePageDockItems`/
// `usePageDirtyGuard`)がページ1つだけを前提にした既存の仕組みのまま使える。
function TabbedSessionsPage() {
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const checkDirtyGuard = useDirtyGuardCheck();

  // 起動時、保存されていたタブの一覧(プロファイルIDのみ。issue #77)を
  // 復元する。既に削除されたプロファイルを指すタブは除外し、全て除外されて
  // 何も残らなければアクティブプロファイル1件のタブから始める。
  useEffect(() => {
    getSettings()
      .then((settings) => {
        setProfiles(settings.profiles);
        const knownIds = new Set(settings.profiles.map((p) => p.id));
        const restored = settings.open_tabs
          .filter((t) => knownIds.has(t.profile_id))
          .map((t) => newTab(t.profile_id));
        const initial = restored.length > 0 ? restored : [newTab(settings.active_profile_id)];
        setTabs(initial);
        setActiveTabId(initial[0].id);
      })
      .catch((e) => console.error(e));
  }, []);

  // プロファイル一覧は他画面(設定・dock)での追加・削除・名前変更にも
  // 追従させる(タブ追加メニュー・ラベル表示に使うため)。削除された
  // プロファイルを指すタブがあれば取り除く(Phase 1 のウィンドウ自動クローズ
  // と同じ考え方)。
  useEffect(() => {
    const unlistenPromise = onSettingsUpdated(() => {
      getSettings()
        .then((settings) => {
          setProfiles(settings.profiles);
          const knownIds = new Set(settings.profiles.map((p) => p.id));
          setTabs((prev) => {
            if (!prev) return prev;
            const remaining = prev.filter((t) => knownIds.has(t.profileId));
            if (remaining.length === prev.length) return prev;
            return remaining.length > 0 ? remaining : [newTab(settings.active_profile_id)];
          });
        })
        .catch((e) => console.error(e));
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // アクティブタブが(閉じられた・プロファイル削除で除外された等で)
  // 消えていたら、先頭タブへ切り替える。
  useEffect(() => {
    if (!tabs || !activeTabId) return;
    if (!tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? null);
    }
  }, [tabs, activeTabId]);

  // 開いているタブの組み合わせ(プロファイルID・順序)が変わったときだけ
  // 永続化する。タブ内の画面状態(選択中セッション等)は保存対象外
  // (native.md §6)なので、位置更新のたびには保存しない。
  const openProfileIdsKey = tabs ? tabs.map((t) => t.profileId).join(",") : null;
  useEffect(() => {
    if (openProfileIdsKey === null) return;
    const ids = openProfileIdsKey === "" ? [] : openProfileIdsKey.split(",");
    saveOpenTabs(ids).catch((e) => console.error(e));
  }, [openProfileIdsKey]);

  const switchTab = (tabId: string) => {
    if (tabId === activeTabId) return;
    if (!checkDirtyGuard()) return;
    setActiveTabId(tabId);
  };

  const closeTab = (tabId: string) => {
    if (!tabs || tabs.length <= 1) return;
    if (tabId === activeTabId && !checkDirtyGuard()) return;
    setTabs((prev) => prev?.filter((t) => t.id !== tabId) ?? prev);
  };

  const addTab = (profileId: string) => {
    const tab = newTab(profileId);
    setTabs((prev) => [...(prev ?? []), tab]);
    setActiveTabId(tab.id);
  };

  const updateTabPosition = useCallback(
    (tabId: string, patch: Partial<Omit<TabPosition, "profileId">>) => {
      setTabs((prev) => prev?.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) ?? prev);
    },
    [],
  );

  // ウィンドウレジストリ(issue #83)へこのウィンドウの全タブをまとめて
  // 報告する。個々のタブの `SessionsPage`(アクティブなものだけがマウント
  // される)はここへは報告せず、`nav.setSessionTitle` でタイトルをタブの
  // 位置情報へ反映するだけにとどめる(報告元を1箇所にするため)。
  const reportTabs: WindowTabDto[] = (tabs ?? []).map((t) => ({
    profile_id: t.profileId,
    session_id: t.session,
    session_title: t.sessionTitle,
  }));
  const reportActiveIndex = tabs?.findIndex((t) => t.id === activeTabId) ?? -1;
  useReportWindowState(reportTabs, Math.max(0, reportActiveIndex), reportTabs.length > 0);

  if (!tabs || !activeTabId) {
    return (
      <div className="tabbed-viewer">
        <p>読み込み中…</p>
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div className="tabbed-viewer">
      <TabBar
        tabs={tabs}
        activeTabId={activeTab.id}
        profiles={profiles}
        onSwitch={switchTab}
        onClose={closeTab}
        onAdd={addTab}
      />
      <TabbedViewerContent tab={activeTab} onPositionChange={updateTabPosition} />
    </div>
  );
}

function TabbedViewerContent({
  tab,
  onPositionChange,
}: {
  tab: Tab;
  onPositionChange: (tabId: string, patch: Partial<Omit<TabPosition, "profileId">>) => void;
}) {
  const handleChange = useCallback(
    (patch: Partial<Omit<TabPosition, "profileId">>) => onPositionChange(tab.id, patch),
    [tab.id, onPositionChange],
  );
  const nav = useTabViewerNav(tab, handleChange);
  return (
    <div className="tabbed-viewer-content">
      <SessionsPage key={tab.id} nav={nav} />
    </div>
  );
}

export default TabbedSessionsPage;
