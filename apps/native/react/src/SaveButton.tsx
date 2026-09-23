import ActionButton from "./ActionButton";
import type { ActionButtonProps } from "./ActionButton";

// 部品「保存ボタン」(塗り)。編集した内容を確定する操作(issue #334)。
// 見た目は追加ボタンと同じで、違いはラベル(既定「保存」)だけ。
// 仕様は apps/web の `src/data/uiButton.ts`(`/ui?item=part-button`)。
export default function SaveButton(props: ActionButtonProps) {
  return <ActionButton kind="save" {...props} />;
}
