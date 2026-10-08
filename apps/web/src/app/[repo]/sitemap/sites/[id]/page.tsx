import RepoSitemapSiteTab from "../../../../tabs/RepoSitemapSiteTab";

// #588: サイトマップのデータはリポジトリの外(`{リポジトリ}/yyz/spec/sitemap.json`)
// にあるため、ビルド時に id を列挙できない(以前は generateStaticParams で全 id を
// 静的生成していた)。実行時に読んで引く。
export default async function RepoSitemapSitePage({
  params,
}: {
  params: Promise<{ repo: string; id: string }>;
}) {
  const { repo, id } = await params;
  return <RepoSitemapSiteTab repo={repo} siteId={Number(id)} />;
}
