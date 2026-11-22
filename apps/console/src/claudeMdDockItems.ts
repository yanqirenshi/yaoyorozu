import type { DockItem } from "command-dock";
import type { ViewMode } from "@yanqirenshi/markdown.sitter";
import { RELOAD_ICON, SAVE_ICON, VIEW_MODE_ICON } from "./icons";

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  editor: "編集",
  split: "分割",
  preview: "表示",
};

type CreateClaudeMdDockItemsOptions = {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  dirty: boolean;
  onSave: () => void | Promise<void>;
  onReload: () => void | Promise<void>;
};

// CLAUDE.mdタブ表示中にdockへ出す3トリガー(表示モード/保存/再読み込み)。
// ビューア(SessionsPage)・設定(SettingsPage)の両方で同じ内容を出すため
// 共通関数化する(issue #59)。
export function createClaudeMdDockItems({
  mode,
  onModeChange,
  dirty,
  onSave,
  onReload,
}: CreateClaudeMdDockItemsOptions): DockItem[] {
  return [
    {
      id: "claude-md-mode",
      label: VIEW_MODE_ICON,
      title: "表示モード",
      popup: (Object.keys(VIEW_MODE_LABELS) as ViewMode[]).map((value) => ({
        label: VIEW_MODE_LABELS[value],
        active: mode === value,
        onSelect: () => onModeChange(value),
      })),
    },
    {
      id: "claude-md-save",
      label: SAVE_ICON,
      title: "保存",
      disabled: !dirty,
      onClick: onSave,
    },
    {
      id: "claude-md-reload",
      label: RELOAD_ICON,
      title: "再読み込み",
      onClick: onReload,
    },
  ];
}
