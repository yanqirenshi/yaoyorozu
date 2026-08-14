import DiagramPage from "../DiagramPage";
import DeploymentTab from "../tabs/DeploymentTab";

export default function DeploymentDiagramPage() {
  return (
    <DiagramPage wbsStartId={10}>
      <DeploymentTab />
    </DiagramPage>
  );
}
