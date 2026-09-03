import { useCallback, useEffect, useState } from "react";
import { getSettings, onSettingsUpdated } from "../api";
import type { ProfileSummaryDto, WindowTabDto } from "../api";
import { useDirtyGuardCheck } from "../DockItemsContext";
import TabBar from "../TabBar";
import { useReportWindowState } from "../useReportWindowState";
import { useWindowProfileId } from "../useWindowProfileId";
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

// あらゆるビューアウィンドウ(ハブから開いたウィンドウ含む。issue #84)の
// `/` の内容をタブ化する(マルチウィンドウ Phase 2。issue #77)。1つのタブ
// = 「プロファイル+画面状態」の組。実際にマウントするのはアクティブな
// タブぶんの `SessionsPage` 1つだけで、タブを切り替えるたびに `key` を
// 変えて作り直す(= その他のタブの画面状態は SessionsPage 内部の state
// ではなく、このコンポーネントが持つ `tabs` 配列側に置く。native.md §6)。
// これにより非アクティブなタブは常にアンマウント状態になり、dock 項目・
// 破棄確認ガード(`usePageDockItems`/`usePageDirtyGuard`)がページ1つだけを
// 前提にした既存の仕組みのまま使える。
function TabbedSessionsPage() {
  // `open_profile_window` で開かれたウィンドウは `?profile=<id>` を持つ
  // (issue #76)。起動時のタブ復元(`Settings.open_tabs`)は行わない
  // (issue #84: 起動時はハブのみが開き、ビューアはハブから常に単一
  // プロファイルを指定して開かれるため)。
  const initialProfileId = useWindowProfileId();
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const checkDirtyGuard = useDirtyGuardCheck();

  // このウィンドウの最初のタブを用意する。URLに `?profile=` があればそれを
  // 対象に、無ければアクティブプロファイルを対象にする(後者は通常
  // 到達しない安全側のフォールバック)。
  useEffect(() => {
    getSettings()
      .then((settings) => {
        setProfiles(settings.profiles);
        const tab = newTab(initialProfileId ?? settings.active_profile_id);
        setTabs([tab]);
        setActiveTabId(tab.id);
      })
      .catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // プロファイル一覧は他画面(設定・dock)での追加・削除・名前変更にも
  // 追従させる(タブ追加メニュー・ラベル表示に使うため)。削除された
  // プロファイルを指すタブがあれば取り除く(Phase 1 のウィンドウ自動クローズ
  // と同じ考え方だが、ウィンドウ全体ではなくそのタブだけを閉じる)。
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
