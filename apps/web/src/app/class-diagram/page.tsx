import DiagramPage from "../DiagramPage";
import ClassesTab from "../tabs/ClassesTab";
import ClassGuideTab from "../tabs/classes/ClassGuideTab";

export default function ClassDiagramPage() {
  return (
    <DiagramPage
      wbsStartId={25}
      extraTabs={[
        { key: "guide", label: "クラス図の書き方", content: <ClassGuideTab /> },
      ]}
    >
      <ClassesTab />
    </DiagramPage>
  );
}
