import ActionButton from "./ActionButton";
import type { ActionButtonProps } from "./ActionButton";

// 部品「追加ボタン」(塗り)。新しい対象を作る、画面の主要な操作(issue #277)。
// 仕様は apps/web の `src/data/uiButton.ts`(`/ui?item=part-button`)。
export default function AddButton(props: ActionButtonProps) {
  return <ActionButton kind="add" {...props} />;
}
