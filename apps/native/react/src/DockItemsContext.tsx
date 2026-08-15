import { createContext, useContext, useEffect } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { DockItem } from "command-dock";

// AppDock はレイアウト側(Layout.tsx)にあり、常設のナビゲーション項目を持つ。
// 「再読み込み」「送信モード」のようにページ固有の項目は、そのページが
// マウントされている間だけ dock に追加したい。子(ページ)から親(Layout)へ
// 値を伝える標準的な方法として、setter 関数を Context 経由で渡す。
// native.md §6 NEVER の対象は「業務状態」であり、これは一時的なUI項目の
// 登録に過ぎないため抵触しない。
const DockItemsContext = createContext<Dispatch<SetStateAction<DockItem[]>> | null>(null);

export function DockItemsProvider({
  setItems,
  children,
}: {
  setItems: Dispatch<SetStateAction<DockItem[]>>;
  children: ReactNode;
}) {
  return (
    <DockItemsContext.Provider value={setItems}>{children}</DockItemsContext.Provider>
  );
}

/**
 * 現在のページが command-dock に追加したい項目を登録する。
 * ページがアンマウントされると自動的にクリアされる。
 */
export function usePageDockItems(items: DockItem[]) {
  const setItems = useContext(DockItemsContext);

  useEffect(() => {
    setItems?.(items);
    return () => setItems?.([]);
  }, [items, setItems]);
}
