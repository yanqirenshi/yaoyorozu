import { useEffect, useRef } from "react";
import "command-dock";
import type { CommandDock, DockItem } from "command-dock";

type AppDockProps = {
  items: DockItem[];
  // ページ固有の項目(usePageDockItems で登録されたもの)の id。背景色を
  // 共通ナビと変えるために使う(issue #246)。
  pageItemIds: string[];
  // 表示中の画面のナビ項目の id(issue #253)。背景を金茶-400 にして現在地を示す。
  currentItemId: string | null;
};

// ページ固有項目の背景色(issue #246)。金茶-50。値の正は web のデザイン
// トークン(`apps/web/src/data/uiDesign.ts` の 金茶 トーンスケール。50 = #fbf8f4)
// で、native 側へは `scripts/generate-tokens.ts` が tokens.css の
// `--color-kincha-50` として写している。
const PAGE_ITEM_BACKGROUND = "var(--color-kincha-50)";

// 表示中の画面のナビ項目の背景色(issue #253)。金茶-400(tokens.css の
// `--color-kincha-400`。出典は同じく web の uiDesign.ts)。ページ固有項目
// (金茶-50)と並んでも見分けがつく濃さ。アイコンの線色(墨)とのコントラストは
// 十分あるため、白抜き等の調整はしない。ホバー時(`--dock-bg-hover`)も同じ色に
// して、押しても何も起きない項目が変化して見えないようにする。
const CURRENT_ITEM_BACKGROUND = "var(--color-kincha-400)";

// command-dock Web Component への薄いラッパー。項目の中身(ナビゲーション、
// 再読み込み、送信モード等)はここでは組み立てず、呼び出し側(Layout)から
// 完成した items を受け取って渡すだけにする。
function AppDock({ items, pageItemIds, currentItemId }: AppDockProps) {
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
      if (item.id === currentItemId) {
        buttons?.[i]?.style.setProperty("--dock-bg", CURRENT_ITEM_BACKGROUND);
        buttons?.[i]?.style.setProperty("--dock-bg-hover", CURRENT_ITEM_BACKGROUND);
      }
    });
  }, [items, pageItemIds, currentItemId]);

  return <command-dock ref={dockRef} />;
}

export default AppDock;
