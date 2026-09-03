import { useParams } from "react-router";

// このウィンドウの対象プロファイルIDをURLパスパラメータ `/profiles/:profileId`
// から解決する唯一の場所(issue #88。旧 `?profile=<id>` クエリから移行)。
// `null` はアクティブ(既定)プロファイルを使うことを意味し、api/ の
// ラッパー関数へそのまま `profileId` として渡す。ハブ(`/`)はこのパラメータを
// 持たないため、メインウィンドウの挙動は従来どおりになる。
export function useWindowProfileId(): string | null {
  const params = useParams<{ profileId?: string }>();
  return params.profileId ?? null;
}
