import { createContext, useContext, useEffect } from "react";
import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import type { DockItem } from "command-dock";

// プロファイル切り替え(dock。Layout.tsx)のような、ページをまたぐ操作の前に
// 「未保存の編集を破棄してよいか」を呼び出し側(ページ)に確認してもらう
// ための関数。`true` を返せば続行(未保存の変更が無い、またはユーザーが
// 破棄を確認した)、`false` なら中止する(issue #72)。
export type DirtyGuard = () => boolean;

type DockItemsContextValue = {
  setItems: Dispatch<SetStateAction<DockItem[]>>;
  dirtyGuardRef: MutableRefObject<DirtyGuard | null>;
};

// AppDock はレイアウト側(Layout.tsx)にあり、常設のナビゲーション項目を持つ。
// 「再読み込み」「送信モード」のようにページ固有の項目は、そのページが
// マウントされている間だけ dock に追加したい。子(ページ)から親(Layout)へ
// 値を伝える標準的な方法として、setter 関数を Context 経由で渡す。
// native.md §6 NEVER の対象は「業務状態」であり、これは一時的なUI項目の
// 登録・ページをまたぐ操作の確認に過ぎないため抵触しない。
const DockItemsContext = createContext<DockItemsContextValue | null>(null);

export function DockItemsProvider({
  setItems,
  dirtyGuardRef,
  children,
}: {
  setItems: Dispatch<SetStateAction<DockItem[]>>;
  dirtyGuardRef: MutableRefObject<DirtyGuard | null>;
  children: ReactNode;
}) {
  return (
    <DockItemsContext.Provider value={{ setItems, dirtyGuardRef }}>
      {children}
    </DockItemsContext.Provider>
  );
}

/**
 * 現在のページが command-dock に追加したい項目を登録する。
 * ページがアンマウントされると自動的にクリアされる。
 */
export function usePageDockItems(items: DockItem[]) {
  const ctx = useContext(DockItemsContext);

  useEffect(() => {
    ctx?.setItems(items);
    return () => ctx?.setItems([]);
  }, [items, ctx]);
}

/**
 * 現在のページの「未保存の編集を破棄してよいか」の確認関数を登録する。
 * プロファイル切り替え(dock。Layout.tsx)のようなページをまたぐ操作の前に
 * Layout 側から呼ばれる(issue #72)。`items` と異なり ref に代入するだけ
 * なので、毎レンダーで新しい関数を渡してもレンダーループにはならない。
 */
export function usePageDirtyGuard(guard: DirtyGuard | null) {
  const ctx = useContext(DockItemsContext);

  useEffect(() => {
    if (!ctx) return;
    ctx.dirtyGuardRef.current = guard;
    return () => {
      if (ctx.dirtyGuardRef.current === guard) {
        ctx.dirtyGuardRef.current = null;
      }
    };
  }, [guard, ctx]);
}
