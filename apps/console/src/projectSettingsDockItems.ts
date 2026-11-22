import type { DockItem } from "command-dock";
import { RELOAD_ICON, SAVE_ICON } from "./icons";

type CreateProjectSettingsDockItemsOptions = {
  dirty: boolean;
  onSave: () => void | Promise<void>;
  onReload: () => void | Promise<void>;
};

// settings.json/settings.local.jsonタブ表示中にdockへ出す2トリガー
// (保存・再読み込み)。JSONのため表示モード切替は無い(issue #70。
// CLAUDE.mdタブ用の createClaudeMdDockItems と同じ考え方。issue #59)。
export function createProjectSettingsDockItems({
  dirty,
  onSave,
  onReload,
}: CreateProjectSettingsDockItemsOptions): DockItem[] {
  return [
    {
      id: "project-settings-save",
      label: SAVE_ICON,
      title: "保存",
      disabled: !dirty,
      onClick: onSave,
    },
    {
      id: "project-settings-reload",
      label: RELOAD_ICON,
      title: "再読み込み",
      onClick: onReload,
    },
  ];
}
