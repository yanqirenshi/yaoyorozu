import { redirect } from "next/navigation";

// #588: サイトの詳細ページも /{リポジトリ名}/sitemap/sites/{id} へ移した。
// 図の下位にあるものは URL でも下位に置く(判断の記録は yyz/spec/sitemap.md)。
export default async function SitemapSitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/yaoyorozu/sitemap/sites/${id}`);
}
