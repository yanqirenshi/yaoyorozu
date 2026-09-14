import { SITEMAP_SITES } from "@/data/sitemap";
import SitemapSiteTab from "../../../tabs/SitemapSiteTab";

// サイトマップは静的データ(src/data/sitemap.ts)なので、全サイトをビルド時に
// 生成し、存在しない id は 404 にする。
export const dynamicParams = false;

export async function generateStaticParams() {
  return SITEMAP_SITES.map((site) => ({ id: String(site.id) }));
}

export default async function SitemapSitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SitemapSiteTab siteId={Number(id)} />;
}
