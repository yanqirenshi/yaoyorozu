import type { MouseEventHandler } from "react";

// 追加ボタン・保存ボタン・変更ボタン・選択ボタンの共通の土台(issue #277。
// 保存は #334、選択は #339)。見た目は仕様(apps/web の `src/data/uiButton.ts`。
// 説明は `/ui?item=part-button`)を tokens.css の CSS 変数だけで写したもの
// (App.css の `.action-button*`)で、ここには値を持たない。画面から直接使わず、
// AddButton / SaveButton / EditButton / SelectButton を使う。どれもアイコンは
// 付けず、文字だけのラベルで構成する。
// 仕様を変えたいときは apps/native 側で値を変えず、デザイン (UI) に相談する
// (正は uiButton.ts)。

export type ActionButtonSize = "small" | "medium" | "large";

export type ActionButtonProps = {
  size?: ActionButtonSize;
  /** 省略時は種類ごとの既定のラベル(追加 / 保存 / 変更 / 選択)。 */
  label?: string;
  disabled?: boolean;
  /** フォーム送信のときだけ `submit`。既定は `button`。 */
  type?: "button" | "submit";
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

type ActionButtonKind = "add" | "save" | "edit" | "select";

const DEFAULT_LABELS: Record<ActionButtonKind, string> = {
  add: "追加",
  save: "保存",
  edit: "変更",
  select: "選択",
};

export default function ActionButton({
  kind,
  size = "medium",
  label,
  disabled = false,
  type = "button",
  onClick,
}: ActionButtonProps & { kind: ActionButtonKind }) {
  return (
    <button
      type={type}
      className={`action-button action-button-${kind} action-button-${size}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label ?? DEFAULT_LABELS[kind]}
    </button>
  );
}
