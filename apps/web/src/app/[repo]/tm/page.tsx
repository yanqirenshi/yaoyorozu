import DiagramPage from "../../DiagramPage";
import RepoTmTab from "../../tabs/RepoTmTab";
import TmRecordTab from "../../tabs/tm/TmRecordTab";

/**
 * `/{repo}/tm`(#590。#543 の最終段)。
 *
 * 判断の記録(`yyz/spec/tm.md`)は 300 行あるので図と同じ画面には出さず、
 * DiagramPage の「その画面だけのタブ」として並べる(`?tab=record`)。
 */
export default async function RepoTmPage({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return (
    <DiagramPage
      repo={repo}
      wbsStartId={26}
      extraTabs={[
        {
          key: "record",
          label: "判断の記録",
          content: <TmRecordTab repo={repo} />,
        },
      ]}
    >
      <RepoTmTab repo={repo} />
    </DiagramPage>
  );
}
