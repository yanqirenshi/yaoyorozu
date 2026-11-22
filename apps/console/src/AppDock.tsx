import { useEffect, useRef } from "react";
import "command-dock";
import type { CommandDock } from "command-dock";
import type { PageDockItem } from "./DockItemsContext";

type AppDockProps = {
  items: PageDockItem[];
  // ページ固有の項目(usePageDockItems で登録されたもの)の id。共通ナビと
  // 配色を変えるために使う(issue #246・#255)。
  pageItemIds: string[];
  // 表示中の画面のナビ項目の id(issue #253)。背景を金茶-400 にして現在地を示す。
  currentItemId: string | null;
};

// 表示中の画面のナビ項目の背景色(issue #253)。金茶-400(tokens.css の
// `--color-kincha-400`。値の正は web のデザイントークン
// `apps/web/src/data/uiDesign.ts` の 金茶 トーンスケールで、native 側へは
// `scripts/generate-tokens.ts` が tokens.css に写している)。ページ固有項目
// (草色系)と並んでも見分けがつく濃さ。アイコンの線色(墨)とのコントラストは
// 十分あるため、白抜き等の調整はしない。ホバー時(`--dock-bg-hover`)も同じ色に
// して、押しても何も起きない項目が変化して見えないようにする。
const CURRENT_ITEM_BACKGROUND = "var(--color-kincha-400)";

// ページ固有項目の配色(issue #255。従来の金茶-50 から草色系へ変更)。草色の
// トーン(kusairo-100/200/300)も tokens.css(値の正は同じく uiDesign.ts)。
// - 背景: 未選択=草色-100、選択=草色-300。「選択」は吹き出しを開いている間
//   (command-dock の `popup` 型は `.active`、ページ側で開閉を持つ項目は
//   `data-open`)。即アクション型は選択状態を持たないため常に未選択の色。
// - 枠線(吹き出しを開閉する項目のみ): 閉=草色-200、開=草色-100、いずれも 3px。
//
// command-dock は項目ごとのスタイル指定を持たず、開閉(`.active`)は dock 内部の
// クラスの付け外しだけで React からは見えない。そのため、Shadow DOM に
// (公開された `part="circle"` のボタンへ)スタイルシートを一度だけ注入し、
// ボタンへ付ける属性(`data-page-item`・`data-popup-item`・`data-open`)と
// dock 自身のクラス(`.popup-trigger`・`.active`)で状態に追従させる。背景は
// テーマ契約の変数 `--dock-bg` を上書きするので、dock 側の詳細度の高い
// `.active` の指定(`background: var(--dock-bg)`)にもそのまま効く。枠線は
// dock 側が `.popup-trigger.active` で透明にするため、それより詳細度の高い
// セレクタで上書きする(inline style では開閉に追従できない)。
const PAGE_ITEM_CSS = `
[part~='circle'][data-page-item] {
  --dock-bg: var(--color-kusairo-100);
}
[part~='circle'][data-page-item].active,
[part~='circle'][data-page-item][data-open] {
  --dock-bg: var(--color-kusairo-300);
}
[part~='circle'][data-page-item].popup-trigger,
[part~='circle'][data-page-item][data-popup-item] {
  border-width: 3px;
  border-color: var(--color-kusairo-200);
}
[part~='circle'][data-page-item].popup-trigger.active,
[part~='circle'][data-page-item][data-popup-item][data-open] {
  border-color: var(--color-kusairo-100);
}
`;
let pageItemSheet: CSSStyleSheet | null = null;

// command-dock Web Component への薄いラッパー。項目の中身(ナビゲーション、
// 再読み込み、送信モード等)はここでは組み立てず、呼び出し側(Layout)から
// 完成した items を受け取って渡すだけにする。
function AppDock({ items, pageItemIds, currentItemId }: AppDockProps) {
  const dockRef = useRef<CommandDock | null>(null);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    dock.items = items;

    const root = dock.shadowRoot;
    if (root) {
      if (!pageItemSheet) {
        pageItemSheet = new CSSStyleSheet();
        pageItemSheet.replaceSync(PAGE_ITEM_CSS);
      }
      if (!root.adoptedStyleSheets.includes(pageItemSheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, pageItemSheet];
      }
    }

    // `items` の代入で同期的に再描画された各ボタン(Shadow DOM 内。公開された
    // `part="circle"`。項目と同じ並び順)へ、状態を属性で伝える。
    const buttons = root?.querySelectorAll<HTMLElement>("[part~='circle']");
    items.forEach((item, i) => {
      const button = buttons?.[i];
      if (!button) return;
      if (pageItemIds.includes(item.id)) {
        button.setAttribute("data-page-item", "");
        if (item.popupOpen !== undefined) {
          button.setAttribute("data-popup-item", "");
          if (item.popupOpen) button.setAttribute("data-open", "");
        }
      }
      if (item.id === currentItemId) {
        button.style.setProperty("--dock-bg", CURRENT_ITEM_BACKGROUND);
        button.style.setProperty("--dock-bg-hover", CURRENT_ITEM_BACKGROUND);
      }
    });
  }, [items, pageItemIds, currentItemId]);

  return <command-dock ref={dockRef} />;
}

export default AppDock;
