"use client";

// /settings(段階 1: プロファイルの一覧の表示だけ)。
// 写し元: `apps/native/react/src/pages/SettingsPage.tsx` の左ペイン。作成・削除・切替は段階 2 以降。

import { useCallback, useEffect, useState } from "react";
import { getSettings, isAppError, onPing } from "@/api";
import type { ProfileSummaryDto } from "@/api";

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  // 確認用: 最後に届いた ping と受信件数(SSE が 1 件ずつ届くことの目視用)。
  const [lastPing, setLastPing] = useState<{ n: number; at: string } | null>(null);
  const [pingCount, setPingCount] = useState(0);

  const loadSettingsData = useCallback((): Promise<void> => {
    return getSettings()
      .then((settings) => {
        setProfiles(settings.profiles);
        setActiveProfileId(settings.active_profile_id);
        setProfileError(null);
      })
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    // eslint の「effect 内の setState」を避けるため、非同期の完了後にだけ状態を更新する。
    void loadSettingsData();
  }, [loadSettingsData]);

  useEffect(() => {
    const unlistenPromise = onPing(({ n }) => {
      setLastPing({ n, at: new Date().toLocaleTimeString("ja-JP") });
      setPingCount((c) => c + 1);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div className="settings-profile-pane">
      <h2>プロファイル</h2>
      <ul className="settings-profile-list">
        {profiles.map((p) => (
          <li key={p.id} className="settings-profile-row">
            <button
              type="button"
              className={`project-item ${p.id === activeProfileId ? "selected" : ""}`}
            >
              <span className="settings-profile-name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {profileError && <p className="error">{profileError}</p>}
      <p data-testid="ping-status" style={{ fontSize: "0.8rem", opacity: 0.6 }}>
        {lastPing
          ? `ping #${lastPing.n}(${lastPing.at} 受信、計 ${pingCount} 件)`
          : "ping を待っています…"}
      </p>
    </div>
  );
}
