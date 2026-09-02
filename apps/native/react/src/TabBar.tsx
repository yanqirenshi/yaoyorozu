import { useEffect, useState } from "react";
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
  const [addModalOpen, setAddModalOpen] = useState(false);

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
      <button
        type="button"
        className="tab-bar-add-button"
        onClick={() => setAddModalOpen(true)}
        aria-label="タブを追加"
      >
        +
      </button>
      {addModalOpen && (
        <AddTabModal
          profiles={profiles}
          onSelect={(profileId) => {
            onAdd(profileId);
            setAddModalOpen(false);
          }}
          onClose={() => setAddModalOpen(false)}
        />
      )}
    </div>
  );
}

// タブ追加用のプロファイル選択モーダル。ポップオーバー(position: absolute)
// だと `.tab-bar` の横スクロール用 overflow に隠れて見えなくなっていたため、
// 画面中央のモーダルに変更した。
function AddTabModal({
  profiles,
  onSelect,
  onClose,
}: {
  profiles: ProfileSummaryDto[];
  onSelect: (profileId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="tab-bar-add-modal-overlay" onClick={onClose}>
      <div
        className="tab-bar-add-modal"
        role="dialog"
        aria-modal="true"
        aria-label="タブを追加"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>タブを追加</h3>
        <ul className="tab-bar-add-modal-list">
          {profiles.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onSelect(p.id)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="tab-bar-add-modal-cancel" onClick={onClose}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

export default TabBar;
export type { Tab };
