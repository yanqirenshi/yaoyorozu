import RepoUnchiTab from "../../tabs/RepoUnchiTab";

export default async function RepoUnchiPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <RepoUnchiTab repo={repo} />;
}
