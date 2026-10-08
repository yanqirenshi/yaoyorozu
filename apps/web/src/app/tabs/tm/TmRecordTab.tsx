"use client";

import Alert from "@mui/material/Alert";
import LoadingIcon from "@/components/parts/LoadingIcon";
import Markdown from "@/components/parts/Markdown";
import { useSpecMarkdown } from "@/lib/useSpecMarkdown";

/**
 * `/{repo}/tm` の「判断の記録」タブ(#590)。`{リポジトリ}/yyz/spec/tm.md` を出す。
 *
 * 記録は 300 行あり、図と同じ画面に常時出すと図が見えなくなる。そのため
 * `DiagramPage` の `extraTabs`(画面ごとのタブ)として分けた。URL は `?tab=record`
 * なので、リロードしてもリンクを共有しても開いたままになる(web.md §3)。
 *
 * TM は記録が本体なので実際には必ず存在するが、`useSpecMarkdown` の仕様どおり
 * 「記録なし」(204)も正常として扱う(#587)。
 */
export default function TmRecordTab({ repo }: { repo: string }) {
  const state = useSpecMarkdown(repo, "tm");

  if (state.status === "loading") {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center gap-2 p-4 text-sm text-zinc-500">
        <LoadingIcon size="small" label={`${repo} の TM の判断の記録を読み込み中`} />
        読み込み中…
      </div>
    );
  }

  if (state.status === "none") {
    return (
      <div className="p-4">
        <Alert severity="info">
          このリポジトリには TM の判断の記録({repo}/yyz/spec/tm.md)がありません。
        </Alert>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-4">
        <Alert severity="error">{state.message}</Alert>
      </div>
    );
  }

  return (
    <div className="min-h-0 w-full flex-1 overflow-auto p-6">
      {/* 長い文章なので行長を抑える(読みやすさのため)。 */}
      <div className="max-w-[72rem]">
        <Markdown>{state.markdown}</Markdown>
      </div>
    </div>
  );
}
