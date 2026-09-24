import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

// 共通部品「タブ」(issue #287)。仕様の正は apps/web の `uiTab.ts`
// (`/ui?item=part-tab`)。旧 `PaneTabs` を置き換えた。
// WAI-ARIA の Tabs パターン: tablist / tab / aria-selected / ロービング
// タブインデックス。選択中の値は持たず、`value` / `onChange` で親が持つ。
// 矢印・Home/End はフォーカスを動かすだけで選択しない(Enter / Space で選択)。
// 未保存の編集を持つ内容で意図しない切り替えを起こさないため。
type TabItem = {
  id: string;
  label: string;
  // ツールチップ(title 属性)。省略時はラベル全体(仕様どおり)。補足情報を足したい
  // ときだけ指定する(issue #348: セッションタブに日時・フォルダ名を足す)。
  title?: string;
  disabled?: boolean;
};

type TabsProps = {
  // タブ・パネルの id の元。表示中の内容(`role="tabpanel"`)側は
  // `tabPanelProps(id, value)` を展開して結びつける。
  id: string;
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  // 何を切り替えるか(tablist のラベル)
  "aria-label": string;
  size?: "small" | "medium";
};

function tabId(baseId: string, value: string): string {
  return `${baseId}-tab-${value}`;
}

function tabPanelId(baseId: string): string {
  return `${baseId}-panel`;
}

// 表示中の内容に展開して、タブと結びつける。
function tabPanelProps(baseId: string, value: string) {
  return {
    role: "tabpanel" as const,
    id: tabPanelId(baseId),
    "aria-labelledby": tabId(baseId, value),
  };
}

function Tabs({
  id,
  items,
  value,
  onChange,
  "aria-label": ariaLabel,
  size = "medium",
}: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  // 選択中のタブが横スクロールで見えない位置にあるとき(URL からの復元・
  // 外部からの切替など)、見える位置まで寄せる。見えているときは動かさない
  // (issue #348。タブが多いセッションタブで必要になった)。
  useEffect(() => {
    refs.current[value]?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [value]);

  const focusTab = (index: number) => {
    const item = items[index];
    if (item) refs.current[item.id]?.focus();
  };

  // 無効のタブを飛ばして、`from` から `step` 方向に次のタブを探す(端で回る)。
  const findEnabled = (from: number, step: 1 | -1): number => {
    const n = items.length;
    for (let i = 1; i <= n; i++) {
      const idx = (((from + step * i) % n) + n) % n;
      if (!items[idx].disabled) return idx;
    }
    return from;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => refs.current[item.id] === document.activeElement);
    if (current < 0) return;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = findEnabled(current, 1);
        break;
      case "ArrowLeft":
        next = findEnabled(current, -1);
        break;
      case "Home":
        next = items[0]?.disabled ? findEnabled(0, 1) : 0;
        break;
      case "End":
        next = items[items.length - 1]?.disabled
          ? findEnabled(items.length - 1, -1)
          : items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusTab(next);
  };

  // 選択中が無効・不在でも Tab キーで入れるよう、先頭の有効なタブを代わりの入口にする。
  const selectedIndex = items.findIndex((item) => item.id === value && !item.disabled);
  const entryIndex = selectedIndex >= 0 ? selectedIndex : items.findIndex((i) => !i.disabled);

  return (
    <div
      className={`tabs tabs-${size}`}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            id={tabId(id, item.id)}
            type="button"
            role="tab"
            className="tab"
            aria-selected={selected}
            aria-controls={selected ? tabPanelId(id) : undefined}
            tabIndex={index === entryIndex ? 0 : -1}
            disabled={item.disabled}
            title={item.title ?? item.label}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
export { tabPanelProps };
export type { TabItem };
