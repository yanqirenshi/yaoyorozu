"use client";

import "regenerator-runtime/runtime";
import Alert from "@mui/material/Alert";
import WBSTable from "@yanqirenshi/table.wbs";
import LoadingIcon from "@/components/parts/LoadingIcon";
import { useSpecDoc } from "@/lib/useSpecDoc";
import { WBS_COLUMNS, type WbsSource } from "@/lib/wbs";

/**
 * `/{repo}/wbs`(#544)。ビルド時の import ではなく、実行時に
 * `GET /api/spec/{repo}/wbs` を叩いてデータを取る(#543 の第1段)。
 */
export default function RepoWbsTab({ repo }: { repo: string }) {
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
        <WBSTable columns={WBS_COLUMNS} source={state.data} start_id={1} />
      </section>
    </div>
  );
}
