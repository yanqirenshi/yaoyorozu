"use client";

import ActionButton, { type ActionButtonProps } from "./ActionButton";

/**
 * 部品「追加ボタン」。新しい対象を作る操作。
 * 仕様は /ui の「パーツ > 部品 > ボタン」(src/data/uiButton.ts)。
 */
export default function AddButton(props: ActionButtonProps) {
  return <ActionButton kind="add" {...props} />;
}
