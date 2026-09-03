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
// 「1ウィンドウ = 1プロファイル」への一本化(issue #91)でウィンドウ内タブ
// バーを廃止したため、画面状態は再びURL(クエリ)を状態源とする
// (native.md §6)。プロファイル文脈はパスパラメータ(issue #88)で決まる。
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

// `/profiles/:profileId?` の画面状態をURLクエリで管理する(issue #91)。
export function useUrlViewerNav(): ViewerNav {
  const windowProfileId = useWindowProfileId();
  const [searchParams, setSearchParams] = useSearchParams();

  const setView = useCallback(
    (next: PaneView) => {
      setSearchParams((prev) => withParam(prev, "view", next === "chat" ? null : next));
    },
    [setSearchParams],
  );
  const setProjectAndSession = useCallback(
    (project: string | null, session: string | null) => {
      setSearchParams((prev) => withParam(withParam(prev, "project", project), "session", session));
    },
    [setSearchParams],
  );
  const setRule = useCallback(
    (fileName: string) => {
      setSearchParams((prev) => withParam(prev, "rule", fileName));
    },
    [setSearchParams],
  );
  const setSkill = useCallback(
    (name: string) => {
      setSearchParams((prev) => withParam(prev, "skill", name));
    },
    [setSearchParams],
  );
  const clearProjectAndSession = useCallback(() => {
    setSearchParams((prev) => withParam(withParam(prev, "project", null), "session", null));
  }, [setSearchParams]);

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
