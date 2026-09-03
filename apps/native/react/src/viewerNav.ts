import { useCallback } from "react";

// ビューア(SessionsPage)の右ペイン表示種別。
export type PaneView =
  | "chat"
  | "github-project"
  | "claude-md"
  | "rules"
  | "skills"
  | "settings-json"
  | "settings-local-json";

export const PANE_VIEWS: PaneView[] = [
  "chat",
  "github-project",
  "claude-md",
  "rules",
  "skills",
  "settings-json",
  "settings-local-json",
];

// ビューアの「今どこを見ているか」を表す最小限のナビゲーション状態。
// あらゆるビューアウィンドウがタブ化された(issue #84)ため、状態源は常に
// タブ管理側(TabbedSessionsPage)の React state になる(native.md §6)。
export type ViewerNav = {
  windowProfileId: string | null;
  view: string | null;
  project: string | null;
  session: string | null;
  rule: string | null;
  skill: string | null;
  // 選択中セッションの表示用タイトル。ウィンドウレジストリへの報告
  // (issue #83)にのみ使う値。
  sessionTitle: string | null;
  setView: (next: PaneView) => void;
  setProjectAndSession: (project: string | null, session: string | null) => void;
  setRule: (fileName: string) => void;
  setSkill: (name: string) => void;
  clearProjectAndSession: () => void;
  setSessionTitle: (title: string | null) => void;
};

// タブ管理側のstate(タブ配列内の1件)を状態源とする実装(issue #77)。
// `position` はタブの現在位置、`onChange` はタブ配列内のそのタブのフィールドを
// 部分更新する関数(タブ管理側の `useCallback` で安定させた参照を渡すこと)。
export type TabPosition = {
  profileId: string;
  view: string | null;
  project: string | null;
  session: string | null;
  rule: string | null;
  skill: string | null;
  // 選択中セッションの表示用タイトル。ウィンドウレジストリへの報告
  // (issue #83)専用で、画面表示そのものには使わない(タイトルはSessionsPage
  // 自身が `sessionGroups` から都度求める)。
  sessionTitle: string | null;
};

export function useTabViewerNav(
  position: TabPosition,
  onChange: (patch: Partial<Omit<TabPosition, "profileId">>) => void,
): ViewerNav {
  const setView = useCallback(
    (next: PaneView) => onChange({ view: next === "chat" ? null : next }),
    [onChange],
  );
  const setProjectAndSession = useCallback(
    (project: string | null, session: string | null) => onChange({ project, session }),
    [onChange],
  );
  const setRule = useCallback((fileName: string) => onChange({ rule: fileName }), [onChange]);
  const setSkill = useCallback((name: string) => onChange({ skill: name }), [onChange]);
  const clearProjectAndSession = useCallback(
    () => onChange({ project: null, session: null }),
    [onChange],
  );
  const setSessionTitle = useCallback(
    (title: string | null) => onChange({ sessionTitle: title }),
    [onChange],
  );

  return {
    windowProfileId: position.profileId,
    view: position.view,
    project: position.project,
    session: position.session,
    rule: position.rule,
    skill: position.skill,
    sessionTitle: position.sessionTitle,
    setView,
    setProjectAndSession,
    setRule,
    setSkill,
    clearProjectAndSession,
    setSessionTitle,
  };
}
