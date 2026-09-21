"use client";

import ActionButton, { type ActionButtonProps } from "./ActionButton";

/**
 * 部品「変更ボタン」。既存の対象の内容を変える操作。
 * 仕様は /ui の「パーツ > 部品 > ボタン」(src/data/uiButton.ts)。
 */
export default function EditButton(props: ActionButtonProps) {
  return <ActionButton kind="edit" {...props} />;
}
