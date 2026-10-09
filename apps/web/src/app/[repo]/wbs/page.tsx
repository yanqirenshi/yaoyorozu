import WbsTab from "../../tabs/WbsTab";

export default async function RepoWbsPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <WbsTab repo={repo} />;
}
