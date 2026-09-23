"use client";

import ActionButton, { type ActionButtonProps } from "./ActionButton";

/**
 * 部品「選択ボタン」。候補の中から対象を指定する操作。
 * 形は変更ボタンと同じ(線)で、色だけ墨(ニュートラル)にしている。
 * 仕様は /ui の「パーツ > 部品 > ボタン」(src/data/uiButton.ts)。
 */
export default function SelectButton(props: ActionButtonProps) {
  return <ActionButton kind="select" {...props} />;
}
