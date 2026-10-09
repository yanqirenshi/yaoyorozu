"use client";

import "regenerator-runtime/runtime";
import Alert from "@mui/material/Alert";
import WBSTable from "@yanqirenshi/table.wbs";
import LoadingIcon from "@/components/parts/LoadingIcon";
import { useSpecDoc } from "@/lib/useSpecDoc";
import { WBS_COLUMNS, type WbsSource } from "@/lib/wbs";

/**
 * WBS タブ。`DiagramPage` の「WBS」サブタブ(`startId` でページごとの開始位置を
 * 変える)と `/{repo}/wbs`(常に startId=1)の両方から使う。実行時に
 * `GET /api/spec/{repo}/wbs` を叩いてデータを取る(#543・#544)。
 * 元は `RepoWbsTab.tsx` と内容が同じだったため統合した(#594)。
 */
export default function WbsTab({
  repo,
  startId = 1,
}: {
  repo: string;
  startId?: number;
}) {
  const state = useSpecDoc<WbsSource>(repo, "wbs");

  if (state.status === "loading") {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center gap-2 p-4 text-sm text-zinc-500">
        <LoadingIcon size="small" label={`${repo} の WBS を読み込み中`} />
        読み込み中…
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
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-auto p-4">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">
          @yanqirenshi/table.wbs
        </h2>
        <WBSTable columns={WBS_COLUMNS} source={state.data} start_id={startId} />
      </section>
    </div>
  );
}
