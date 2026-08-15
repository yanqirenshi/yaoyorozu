import { useEffect, useRef } from "react";
import "command-dock";
import type { CommandDock, DockItem } from "command-dock";
import type { AgentModeDto } from "./api";

type AppDockProps = {
  onReload: () => Promise<void>;
  mode: AgentModeDto;
  onModeChange: (mode: AgentModeDto) => void;
};

// command-dock の DockItemBase.label は文字列だけでなく SVG/HTML 文字列も
// 受け付ける。色は currentColor にして、トリガーの通常/hover/active/busy の
// 配色(command-dock 側の CSS 変数)がそのまま効くようにする(hex 直書きしない)。
const RELOAD_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <path d="M16 10a6 6 0 1 1-2-4.47" />
  <path d="M16 3v4h-4" />
</svg>`;

const MODE_ICON = `
<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
     xmlns="http://www.w3.org/2000/svg">
  <line x1="4" y1="16" x2="4" y2="12" />
  <line x1="4" y1="9" x2="4" y2="3" />
  <circle cx="4" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
  <line x1="10" y1="16" x2="10" y2="9" />
  <line x1="10" y1="6" x2="10" y2="3" />
  <circle cx="10" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
  <line x1="16" y1="16" x2="16" y2="13" />
  <line x1="16" y1="10" x2="16" y2="3" />
  <circle cx="16" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
</svg>`;

function AppDock({ onReload, mode, onModeChange }: AppDockProps) {
  const dockRef = useRef<CommandDock | null>(null);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const items: DockItem[] = [
      {
        id: "reload",
        label: RELOAD_ICON,
        title: "再読み込み",
        onClick: onReload,
      },
      {
        id: "mode",
        label: MODE_ICON,
        title: "送信モード",
        popup: [
          {
            label: "会話のみ(chat)",
            active: mode === "chat",
            onSelect: () => onModeChange("chat"),
          },
          {
            label: "読み取り専用(read)",
            active: mode === "read",
            onSelect: () => onModeChange("read"),
          },
        ],
      },
    ];
    dock.items = items;
  }, [onReload, mode, onModeChange]);

  return <command-dock ref={dockRef} />;
}

export default AppDock;
