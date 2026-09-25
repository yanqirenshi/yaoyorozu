import { useCallback, useEffect, useState } from "react";
import { listRunningSessions, onRunningSessionChanged } from "./api";
import type { RunningSessionSummaryDto } from "./api/types";

// app が起動している実行中セッションの一覧(issue #409)。ビューアの左の一覧に、会話ファイルが
// まだ無い新規のセッションを出すために使う。状態はイベント(`running-session:changed`)→ Query
// で取り直す(楽観更新しない)。表示中の会話の詳細(答え待ち・途中経過)は
// `useRunningSession` が持つ。

export function useRunningSessionList(): RunningSessionSummaryDto[] {
  const [list, setList] = useState<RunningSessionSummaryDto[]>([]);

  const refresh = useCallback(() => {
    listRunningSessions()
      .then(setList)
      .catch(() => {
        // 一覧が取れなくても、会話の表示・送信は止めない(次の通知で取り直す)。
      });
  }, []);

  useEffect(() => {
    refresh();
    const unlistenPromise = onRunningSessionChanged(() => refresh());
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh]);

  return list;
}
