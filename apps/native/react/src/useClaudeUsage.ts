import { useEffect, useState } from "react";
import { getClaudeUsage, onClaudeUsageUpdated } from "./api";
import type { ClaudeUsageSnapshotDto } from "./api/types";

// Claude.ai の利用状況(5時間枠・7日枠・モデル別。issue #613)。アカウント単位の値で、
// 会話(実行中セッション)ごとではない。状態はイベント(claude-usage:updated)→ そのまま
// 反映(ペイロードが Query と同じ形のため取り直さない)。マウント時に一度 Query して、
// app 起動後まだ一度も取得していない・この画面を開く前に取得済みだった値を取りに行く。

const EMPTY: ClaudeUsageSnapshotDto = { usage: null, fetched_at_ms: null };

export function useClaudeUsage(): ClaudeUsageSnapshotDto {
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshotDto>(EMPTY);

  useEffect(() => {
    getClaudeUsage()
      .then(setSnapshot)
      .catch(() => {
        // 取れなくても、最後の値(無ければ EMPTY)のまま表示を続ける。
      });
    const unlistenPromise = onClaudeUsageUpdated(setSnapshot);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return snapshot;
}
