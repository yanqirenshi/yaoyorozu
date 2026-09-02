import { useSearchParams } from "react-router";

// このウィンドウの対象プロファイルIDをURLクエリ `?profile=<id>` から解決する
// 唯一の場所(issue #76)。`null` はアクティブ(既定)プロファイルを使うことを
// 意味し、api/ のラッパー関数へそのまま `profileId` として渡す。メイン
// ウィンドウはこのクエリを持たないため、挙動は従来どおりになる。
export function useWindowProfileId(): string | null {
  const [searchParams] = useSearchParams();
  return searchParams.get("profile");
}
