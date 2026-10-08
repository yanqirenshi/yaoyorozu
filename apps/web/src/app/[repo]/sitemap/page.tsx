import DiagramPage from "../../DiagramPage";
import RepoSitemapTab from "../../tabs/RepoSitemapTab";

export default async function RepoSitemapPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return (
    <DiagramPage wbsStartId={24}>
      <RepoSitemapTab repo={repo} />
    </DiagramPage>
  );
}
