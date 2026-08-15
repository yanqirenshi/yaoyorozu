import { useEffect, useRef } from "react";
import "command-dock";
import type { CommandDock, DockItem } from "command-dock";

type AppDockProps = {
  onReload: () => Promise<void>;
};

function AppDock({ onReload }: AppDockProps) {
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
    ];
    dock.items = items;
  }, [onReload]);

  return <command-dock ref={dockRef} />;
}

export default AppDock;
