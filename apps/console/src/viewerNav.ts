"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWindowProfileId } from "./useWindowProfileId";

// ビューア(SessionsPage)の右ペイン表示種別。
export type PaneView =
  | "chat"
  | "claude-md"
  | "rules"
  | "skills"
  | "settings-json"
  | "settings-local-json"
  // サイドメニュー下部の歯車。/settings と同じプロファイル設定(issue #299)。
  | "profile-settings";

export const PANE_VIEWS: PaneView[] = [
  "chat",
  "claude-md",
  "rules",
  "skills",
  "settings-json",
  "settings-local-json",
  "profile-settings",
];

// ビューアの「今どこを見ているか」を表す最小限のナビゲーション状態。画面状態は URL(クエリ)を
// 状態源とする(native.md §6)。プロファイル文脈はパスパラメータで決まる。
export type ViewerNav = {
  windowProfileId: string | null;
  view: string | null;
  project: string | null;
  session: string | null;
  rule: string | null;
  skill: string | null;
  setView: (next: PaneView) => void;
  setProjectAndSession: (project: string | null, session: string | null) => void;
  setRule: (fileName: string) => void;
  setSkill: (name: string) => void;
  clearProjectAndSession: () => void;
};

function withParam(
  params: URLSearchParams,
  key: string,
  value: string | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) {
    next.set(key, value);
  } else {
    next.delete(key);
  }
  return next;
}

// `/profiles/<profileId>?…` の画面状態を URL クエリで管理する(issue #91)。
// `useSearchParams` を使うので、呼び出す画面は Suspense 境界の中に置くこと(Next の要件)。
export function useUrlViewerNav(): ViewerNav {
  const windowProfileId = useWindowProfileId();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  // react-router の `setSearchParams((prev) => …)` と同じく、呼ぶ時点の最新のクエリを元に
  // 組み立てる(続けて呼んでも前の更新を打ち消さない)。履歴には積む(戻るで前の表示へ戻れる)。
  const update = useCallback(
    (change: (prev: URLSearchParams) => URLSearchParams) => {
      const next = change(new URLSearchParams(window.location.search));
      const query = next.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [router, pathname],
  );

  const setView = useCallback(
    (next: PaneView) => {
      update((prev) => withParam(prev, "view", next === "chat" ? null : next));
    },
    [update],
  );
  const setProjectAndSession = useCallback(
    (project: string | null, session: string | null) => {
      update((prev) => withParam(withParam(prev, "project", project), "session", session));
    },
    [update],
  );
  const setRule = useCallback(
    (fileName: string) => {
      update((prev) => withParam(prev, "rule", fileName));
    },
    [update],
  );
  const setSkill = useCallback(
    (name: string) => {
      update((prev) => withParam(prev, "skill", name));
    },
    [update],
  );
  const clearProjectAndSession = useCallback(() => {
    update((prev) => withParam(withParam(prev, "project", null), "session", null));
  }, [update]);

  return {
    windowProfileId,
    view: searchParams.get("view"),
    project: searchParams.get("project"),
    session: searchParams.get("session"),
    rule: searchParams.get("rule"),
    skill: searchParams.get("skill"),
    setView,
    setProjectAndSession,
    setRule,
    setSkill,
    clearProjectAndSession,
  };
}
