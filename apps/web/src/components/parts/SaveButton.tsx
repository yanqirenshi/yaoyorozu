"use client";

import ActionButton, { type ActionButtonProps } from "./ActionButton";

/**
 * 部品「保存ボタン」。編集した内容を確定する操作。
 * 見た目は追加ボタンと同じ(塗り)で、違いはラベルだけである。
 * 仕様は /ui の「パーツ > 部品 > ボタン」(src/data/uiButton.ts)。
 */
export default function SaveButton(props: ActionButtonProps) {
  return <ActionButton kind="save" {...props} />;
}
