import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { useWindowProfileId } from "./useWindowProfileId";

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
// 単一ビュー(URLで表現。issue #72/#76)とタブ(タブ管理側のstateで表現。
// issue #77。native.md §6)の両方から同じ形で SessionsPage へ渡せるようにする。
export type ViewerNav = {
  windowProfileId: string | null;
  view: string | null;
  project: string | null;
  session: string | null;
  rule: string | null;
  skill: string | null;
  // 選択中セッションの表示用タイトル。ウィンドウレジストリへの報告
  // (issue #83)にのみ使う値で、URL駆動(単一ビュー)のときはここへの
  // 反映先が無いため常に `null`(その場合は呼び出し側が別途、自分自身の
  // 単一タブとして直接報告する)。
  sessionTitle: string | null;
  setView: (next: PaneView) => void;
  setProjectAndSession: (project: string | null, session: string | null) => void;
  setRule: (fileName: string) => void;
  setSkill: (name: string) => void;
  clearProjectAndSession: () => void;
  setSessionTitle: (title: string | null) => void;
};

// URL(`?view=&project=&session=&rule=&skill=` + `?profile=`)を状態源とする
// 実装。タブ非対応の単一ビュー(メインウィンドウでタブが使われる場合はタブ側
// stateを使うため、こちらはPhase 1の別ウィンドウ専用。issue #76の挙動を
// そのまま維持する)。
export function useUrlViewerNav(): ViewerNav {
  const [searchParams, setSearchParams] = useSearchParams();
  const windowProfileId = useWindowProfileId();

  const setView = useCallback(
    (next: PaneView) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === "chat") {
          params.delete("view");
        } else {
          params.set("view", next);
        }
        return params;
      });
    },
    [setSearchParams],
  );

  const setProjectAndSession = useCallback(
    (project: string | null, session: string | null) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (project) params.set("project", project);
        else params.delete("project");
        if (session) params.set("session", session);
        else params.delete("session");
        return params;
      });
    },
    [setSearchParams],
  );

  const setRule = useCallback(
    (fileName: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("rule", fileName);
        return params;
      });
    },
    [setSearchParams],
  );

  const setSkill = useCallback(
    (name: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("skill", name);
        return params;
      });
    },
    [setSearchParams],
  );

  const clearProjectAndSession = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("project");
      params.delete("session");
      return params;
    });
  }, [setSearchParams]);

  // URLにはタイトルの置き場が無い。単一ビューでの報告は呼び出し側
  // (SessionsPage)が自分自身の値から直接組み立てるため、ここは何もしない
  // (issue #83)。
  const setSessionTitle = useCallback(() => {}, []);

  return {
    windowProfileId,
    view: searchParams.get("view"),
    project: searchParams.get("project"),
    session: searchParams.get("session"),
    rule: searchParams.get("rule"),
    skill: searchParams.get("skill"),
    sessionTitle: null,
    setView,
    setProjectAndSession,
    setRule,
    setSkill,
    clearProjectAndSession,
    setSessionTitle,
  };
}

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
