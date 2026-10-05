"use client";

import { useMemo } from "react";
import D3Deployment, { Rectum } from "@yanqirenshi/d3.deployment";
import Alert from "@mui/material/Alert";
import LoadingIcon from "@/components/parts/LoadingIcon";
import { useSpecDoc } from "@/lib/useSpecDoc";

// d3.deployment は型を同梱していない(src/types/yanqirenshi.d.ts の手書き宣言は
// Rectum.data(value: Record<string, unknown>) と緩い)。計算を含まない素の値を
// そのまま渡すだけなので、構成図のデータもここでは緩い型で受ける。
type DeploymentData = Record<string, unknown>;

/**
 * `/{repo}/deployment-diagram`(#548)。ビルド時の import ではなく、実行時に
 * `GET /api/spec/{repo}/deployment` を叩いてデータを取る(#543 の第2段)。
 */
export default function RepoDeploymentTab({ repo }: { repo: string }) {
  const state = useSpecDoc<DeploymentData>(repo, "deployment");

  const rectum = useMemo(() => {
    if (state.status !== "ready") return null;
    const instance = new Rectum({});
    instance.data(state.data);
    return instance;
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center gap-2 p-4 text-sm text-zinc-500">
        <LoadingIcon size="small" label={`${repo} の構成図を読み込み中`} />
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
      <D3Deployment rectum={rectum!} />
    </div>
  );
}
