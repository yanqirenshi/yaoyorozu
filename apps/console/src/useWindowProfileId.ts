"use client";

import { useParams } from "next/navigation";

// このタブの対象プロファイル ID を、URL のパスパラメータ `/profiles/<profileId>` から解決する
// 唯一の場所(Tauri 版の `useWindowProfileId` の写し。issue #88)。`null` はアクティブ(既定)
// プロファイルを使うことを意味し、api 層のラッパー関数へそのまま `profileId` として渡す。
// ルートは `[[...profileId]]`(省略可の catch-all)なので、値は配列で届く。先頭だけを使う。
export function useWindowProfileId(): string | null {
  const params = useParams<{ profileId?: string[] }>();
  const first = params.profileId?.[0];
  return first ? decodeURIComponent(first) : null;
}
