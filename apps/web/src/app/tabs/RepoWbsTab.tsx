"use client";

import "regenerator-runtime/runtime";
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import WBSTable from "@yanqirenshi/table.wbs";
import LoadingIcon from "@/components/parts/LoadingIcon";
import { WBS_COLUMNS, type WbsSource } from "@/lib/wbs";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; source: WbsSource };

/**
 * `/{repo}/wbs`(#544)。ビルド時の import ではなく、実行時に
 * `GET /api/spec/{repo}/wbs` を叩いてデータを取る(#543 の第1段)。
 */
export default function RepoWbsTab({ repo }: { repo: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // repo が変わったら即「読み込み中」に戻す(レンダー中の setState で行う。
  // useEffect の中で直接 setState すると react-hooks/set-state-in-effect に当たる
  // ため、TmInspector と同じ流儀で prop の変化をレンダー中に検知する)。
  const [loadedRepo, setLoadedRepo] = useState(repo);
  if (repo !== loadedRepo) {
    setLoadedRepo(repo);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/spec/${encodeURIComponent(repo)}/wbs`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `読み込みに失敗しました(${res.status})`);
        }
        return (await res.json()) as WbsSource;
      })
      .then((source) => {
        if (!cancelled) setState({ status: "ready", source });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repo]);

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
        <WBSTable columns={WBS_COLUMNS} source={state.source} start_id={1} />
      </section>
    </div>
  );
}
