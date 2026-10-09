import DiagramPage from "../DiagramPage";
import UiDesignTab from "../tabs/UiDesignTab";

export default function UiPage() {
  return (
    // /ui は #543 の複数リポジトリ化の対象外(UI デザインはリポジトリに依存しない)
    // なので、WBS タブが読むリポジトリは固定の yaoyorozu にする(#594)。
    <DiagramPage repo="yaoyorozu" wbsStartId={23}>
      <UiDesignTab />
    </DiagramPage>
  );
}
