import DiagramPage from "../DiagramPage";
import UiDesignTab from "../tabs/UiDesignTab";

export default function UiPage() {
  return (
    <DiagramPage wbsStartId={23}>
      <UiDesignTab />
    </DiagramPage>
  );
}
