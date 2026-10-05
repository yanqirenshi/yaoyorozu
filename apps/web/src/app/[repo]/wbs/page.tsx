import RepoWbsTab from "../../tabs/RepoWbsTab";

export default async function RepoWbsPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <RepoWbsTab repo={repo} />;
}
