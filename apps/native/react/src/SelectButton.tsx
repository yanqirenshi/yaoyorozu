import ActionButton from "./ActionButton";
import type { ActionButtonProps } from "./ActionButton";

// 部品「選択ボタン」(線)。候補の中から対象を指定する操作(issue #339)。
// 形は変更ボタンと同じで、色だけ墨(ニュートラル)にしている。
// 仕様は apps/web の `src/data/uiButton.ts`(`/ui?item=part-button`)。
export default function SelectButton(props: ActionButtonProps) {
  return <ActionButton kind="select" {...props} />;
}
