import DiagramPage from "../../DiagramPage";
import RepoClassesTab from "../../tabs/RepoClassesTab";
import ClassGuideTab from "../../tabs/classes/ClassGuideTab";
import RepoClassesRecordTab from "../../tabs/classes/RepoClassesRecordTab";

export default async function RepoClassDiagramPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return (
    <DiagramPage
      repo={repo}
      wbsStartId={25}
      extraTabs={[
        {
          key: "record",
          label: "判断の記録",
          content: <RepoClassesRecordTab repo={repo} />,
        },
        { key: "guide", label: "クラス図の書き方", content: <ClassGuideTab /> },
      ]}
    >
      <RepoClassesTab repo={repo} />
    </DiagramPage>
  );
}
