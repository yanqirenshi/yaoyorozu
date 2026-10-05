import DiagramPage from "../../DiagramPage";
import RepoDeploymentTab from "../../tabs/RepoDeploymentTab";

export default async function RepoDeploymentDiagramPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return (
    <DiagramPage wbsStartId={10}>
      <RepoDeploymentTab repo={repo} />
    </DiagramPage>
  );
}
