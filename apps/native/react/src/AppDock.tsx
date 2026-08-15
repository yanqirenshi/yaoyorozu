import { useEffect, useRef } from "react";
import "command-dock";
import type { CommandDock, DockItem } from "command-dock";
import type { AgentModeDto } from "./api";

type AppDockProps = {
  onReload: () => Promise<void>;
  mode: AgentModeDto;
  onModeChange: (mode: AgentModeDto) => void;
};

function AppDock({ onReload, mode, onModeChange }: AppDockProps) {
  const dockRef = useRef<CommandDock | null>(null);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const items: DockItem[] = [
      {
        id: "reload",
        label: "R",
        title: "再読み込み",
        onClick: onReload,
      },
      {
        id: "mode",
        label: "M",
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
