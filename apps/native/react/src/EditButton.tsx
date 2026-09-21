import ActionButton from "./ActionButton";
import type { ActionButtonProps } from "./ActionButton";

// 部品「変更ボタン」(線)。既存の対象への副次的な操作(issue #277)。現時点で
// 適用先は無く、今後の「変更」操作で使う。文字色(金茶-500 on 白)はコントラスト
// 基準(4.5:1)に届かないが、ユーザー判断で採用された仕様のため直さない
// (仕様の正は apps/web の `src/data/uiButton.ts`)。
export default function EditButton(props: ActionButtonProps) {
  return <ActionButton kind="edit" {...props} />;
}
