import DiagramPage from "../../DiagramPage";
import RepoSitemapTab from "../../tabs/RepoSitemapTab";
import SitemapRecord from "../../tabs/sitemap/SitemapRecord";

export default async function RepoSitemapPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return (
    <DiagramPage
      wbsStartId={24}
      // 判断の記録(yyz/spec/sitemap.md)は図と同じ画面のタブに出す(#588)。
      extraTabs={[
        {
          key: "record",
          label: "記録",
          content: <SitemapRecord repo={repo} />,
        },
      ]}
    >
      <RepoSitemapTab repo={repo} />
    </DiagramPage>
  );
}
