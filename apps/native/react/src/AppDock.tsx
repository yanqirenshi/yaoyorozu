import { useEffect, useRef } from "react";
import "command-dock";
import type { CommandDock, DockItem } from "command-dock";

type AppDockProps = {
  items: DockItem[];
};

// command-dock Web Component への薄いラッパー。項目の中身(ナビゲーション、
// 再読み込み、送信モード等)はここでは組み立てず、呼び出し側(Layout)から
// 完成した items を受け取って渡すだけにする。
function AppDock({ items }: AppDockProps) {
  const dockRef = useRef<CommandDock | null>(null);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    dock.items = items;
  }, [items]);

  return <command-dock ref={dockRef} />;
}

export default AppDock;
