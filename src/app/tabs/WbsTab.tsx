"use client";

import "regenerator-runtime/runtime";
import WBSTable from "@yanqirenshi/table.wbs";
import { WBS_SOURCE, WBS_COLUMNS } from "@/data/wbs";

export default function WbsTab({ startId = 1 }: { startId?: number }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-auto p-4">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">
          @yanqirenshi/table.wbs
        </h2>
        <WBSTable
          columns={WBS_COLUMNS}
          source={WBS_SOURCE}
          start_id={startId}
        />
      </section>
    </div>
  );
}
