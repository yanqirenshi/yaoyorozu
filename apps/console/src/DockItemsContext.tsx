import { createContext, useContext, useEffect } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { DockItem } from "command-dock";

// ページ固有の dock 項目(issue #255)。`popupOpen` は、その項目が吹き出しを
// 開閉するものであることと、いま開いているかどうかを表す(command-dock の
// `popup` 型は項目リストしか持てないため、スライダー等を置く吹き出しは
// 即アクション型+ページ側の状態で作る。例: ハブの「グラフの調整」)。指定した
// 項目には吹き出し用の枠線と、開いている間の選択色が付く(AppDock 参照)。
// command-dock は未知のフィールドを無視するため、そのまま渡してよい。
export type PageDockItem = DockItem & { popupOpen?: boolean };

type DockItemsContextValue = {
  setItems: Dispatch<SetStateAction<PageDockItem[]>>;
};

// AppDock はレイアウト側(Layout.tsx)にあり、常設のナビゲーション項目を持つ。
// 「再読み込み」「送信モード」のようにページ固有の項目は、そのページが
// マウントされている間だけ dock に追加したい。子(ページ)から親(Layout)へ
// 値を伝える標準的な方法として、setter 関数を Context 経由で渡す。
// native.md §6 NEVER の対象は「業務状態」であり、これは一時的なUI項目の
// 登録に過ぎないため抵触しない。
const DockItemsContext = createContext<DockItemsContextValue | null>(null);

export function DockItemsProvider({
  setItems,
  children,
}: {
  setItems: Dispatch<SetStateAction<PageDockItem[]>>;
  children: ReactNode;
}) {
  return (
    <DockItemsContext.Provider value={{ setItems }}>{children}</DockItemsContext.Provider>
  );
}

/**
 * 現在のページが command-dock に追加したい項目を登録する。
 * ページがアンマウントされると自動的にクリアされる。
 */
export function usePageDockItems(items: PageDockItem[]) {
  const ctx = useContext(DockItemsContext);

  useEffect(() => {
    ctx?.setItems(items);
    return () => ctx?.setItems([]);
  }, [items, ctx]);
}
