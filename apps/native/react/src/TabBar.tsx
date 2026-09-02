import { useState } from "react";
import type { ProfileSummaryDto } from "./api";

type Tab = {
  id: string;
  profileId: string;
};

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string;
  profiles: ProfileSummaryDto[];
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: (profileId: string) => void;
};

function profileName(profiles: ProfileSummaryDto[], profileId: string): string {
  return profiles.find((p) => p.id === profileId)?.name ?? profileId;
}

// メインウィンドウのビューア上部に出す、Chrome風のプロファイル別タブバー
// (issue #77)。タブ = 「プロファイル+画面状態」の組で、同じプロファイルを
// 複数タブで開いてよい。画面状態自体はタブ管理側(TabbedSessionsPage)が
// state で持ち、ここではタブの一覧・アクティブ表示・追加/切り替え/close の
// UI のみを担う。
function TabBar({ tabs, activeTabId, profiles, onSwitch, onClose, onAdd }: TabBarProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  return (
    <div className="tab-bar">
      <ul className="tab-bar-list">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <button
              type="button"
              className={`tab-bar-item ${tab.id === activeTabId ? "active" : ""}`}
              onClick={() => onSwitch(tab.id)}
              title={profileName(profiles, tab.profileId)}
            >
              <span className="tab-bar-label">{profileName(profiles, tab.profileId)}</span>
              {tabs.length > 1 && (
                <span
                  className="tab-bar-close"
                  role="button"
                  aria-label="タブを閉じる"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  ×
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="tab-bar-add">
        <button
          type="button"
          className="tab-bar-add-button"
          onClick={() => setAddMenuOpen((v) => !v)}
          aria-label="タブを追加"
        >
          +
        </button>
        {addMenuOpen && (
          <>
            {/* メニュー外クリックで閉じるための透明オーバーレイ。 */}
            <div className="tab-bar-add-overlay" onClick={() => setAddMenuOpen(false)} />
            <ul className="tab-bar-add-menu">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(p.id);
                      setAddMenuOpen(false);
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default TabBar;
export type { Tab };
