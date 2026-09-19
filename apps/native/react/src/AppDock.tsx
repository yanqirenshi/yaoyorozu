import { useEffect, useRef } from "react";
import "command-dock";
import type { CommandDock, DockItem } from "command-dock";

type AppDockProps = {
  items: DockItem[];
  // ページ固有の項目(usePageDockItems で登録されたもの)の id。背景色を
  // 共通ナビと変えるために使う(issue #246)。
  pageItemIds: string[];
};

// ページ固有項目の背景色(issue #246)。金茶-50。値の正は web のデザイン
// トークン(`apps/web/src/data/uiDesign.ts` の 金茶 トーンスケール。50 = #fbf8f4)
// で、native 側へは `scripts/generate-tokens.ts` が tokens.css の
// `--color-kincha-50` として写している。
const PAGE_ITEM_BACKGROUND = "var(--color-kincha-50)";

// command-dock Web Component への薄いラッパー。項目の中身(ナビゲーション、
// 再読み込み、送信モード等)はここでは組み立てず、呼び出し側(Layout)から
// 完成した items を受け取って渡すだけにする。
function AppDock({ items, pageItemIds }: AppDockProps) {
  const dockRef = useRef<CommandDock | null>(null);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    dock.items = items;
    // command-dock は項目ごとのスタイル指定を持たないため、`items` の代入で
    // 同期的に再描画された各ボタン(Shadow DOM 内。公開された `part="circle"`。
    // 項目と同じ並び順)に、テーマ契約の CSS 変数 `--dock-bg` をボタン単位で
    // 上書きする。ホバー時の背景は変数 `--dock-bg-hover` のため影響を受けない。
    const buttons = dock.shadowRoot?.querySelectorAll<HTMLElement>("[part~='circle']");
    items.forEach((item, i) => {
      if (pageItemIds.includes(item.id)) {
        buttons?.[i]?.style.setProperty("--dock-bg", PAGE_ITEM_BACKGROUND);
      }
    });
  }, [items, pageItemIds]);

  return <command-dock ref={dockRef} />;
}

export default AppDock;
