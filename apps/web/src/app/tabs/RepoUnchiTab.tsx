"use client";

import { useMemo } from "react";
import D3Unchi, { Rectum } from "@yanqirenshi/d3.unchi";
import Alert from "@mui/material/Alert";
import LoadingIcon from "@/components/parts/LoadingIcon";
import { useSpecDoc } from "@/lib/useSpecDoc";
import { buildUnchiData, type UnchiSpec } from "@/lib/unchi";

// 図全体が収まる初期倍率。図の中はホイールで拡大・ドラッグで移動できる。
const INITIAL_SCALE = 0.75;

/**
 * `/{repo}/unchi`(#548)。ビルド時の import ではなく、実行時に
 * `GET /api/spec/{repo}/unchi` を叩いてデータを取る(#543 の第2段)。
 */
export default function RepoUnchiTab({ repo }: { repo: string }) {
  const state = useSpecDoc<UnchiSpec>(repo, "unchi");

  const rectum = useMemo(() => {
    if (state.status !== "ready") return null;
    // d3.svg は x・y を倍率倍してしまうため 0 のままにする。
    const instance = new Rectum({ transform: { k: INITIAL_SCALE, x: 0, y: 0 } });
    instance.data(buildUnchiData(state.data));
    return instance;
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center gap-2 p-4 text-sm text-zinc-500">
        <LoadingIcon size="small" label={`${repo} のポンチ絵を読み込み中`} />
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
    <div className="flex min-h-0 w-full flex-1">
      <D3Unchi rectum={rectum!} />
    </div>
  );
}
