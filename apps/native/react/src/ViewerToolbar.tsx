import { useEffect, useRef, useState } from "react";
import type { DockItem } from "command-dock";

type ViewerToolbarProps = {
  items: DockItem[];
};

// ビューア(`/profiles/:id`)のページ内ツールバー(issue #257)。ビューアでは
// dock を表示しない(会話表示に重なって邪魔になるため)ので、dock にしか
// 無かった操作(再読み込み・送信モード切替・CLAUDE.md / settings 系の表示
// モード切替・保存・再読み込み)をここへ移した。項目は dock と同じ `DockItem`
// (設定画面と共有する `createClaudeMdDockItems` 等をそのまま使う)を受け取り、
// 機能・挙動は変えずに置き場所だけを変える。
// - 即アクション型: クリックで `onClick`。Promise を返す間は無効化(dock の busy と
//   同じく二重実行を防ぐ)。`disabled` は真偽値または述語。
// - 吹き出し型(`popup`): クリックでメニューを開き、項目の選択で `onSelect`
//   (`closeOnSelect` が false でなければ閉じる)。外クリックで閉じる。
// アイコン(`label`)は icons.ts の固定の SVG 文字列で、dock も同様に innerHTML で描く。
function ViewerToolbar({ items }: ViewerToolbarProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openId]);

  const run = (id: string, action: () => void | Promise<void>) => {
    const result = action();
    if (result instanceof Promise) {
      setBusyId(id);
      result.catch((e) => console.error(e)).finally(() => setBusyId(null));
    }
  };

  return (
    <div className="viewer-toolbar" ref={rootRef}>
      {items.map((item) => {
        if ("popup" in item) {
          const groups = Array.isArray(item.popup) ? item.popup : [];
          const menuItems = groups.flatMap((g) => ("items" in g ? g.items : [g]));
          return (
            <div key={item.id} className="viewer-toolbar-item">
              <button
                type="button"
                className={`viewer-toolbar-button${openId === item.id ? " open" : ""}`}
                title={item.title}
                aria-haspopup="true"
                onClick={() => setOpenId((id) => (id === item.id ? null : item.id))}
                dangerouslySetInnerHTML={{ __html: item.label }}
              />
              {openId === item.id && (
                <div className="viewer-toolbar-menu" role="menu">
                  {menuItems.map((m, index) => {
                    const active = typeof m.active === "function" ? m.active() : !!m.active;
                    return (
                      <button
                        key={m.label}
                        type="button"
                        role="menuitem"
                        className={`viewer-toolbar-menu-item${active ? " active" : ""}`}
                        onClick={() => {
                          m.onSelect?.({ dockId: item.id, index });
                          if (m.closeOnSelect !== false) setOpenId(null);
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }
        const disabled = typeof item.disabled === "function" ? item.disabled() : !!item.disabled;
        return (
          <div key={item.id} className="viewer-toolbar-item">
            <button
              type="button"
              className="viewer-toolbar-button"
              title={item.title}
              disabled={disabled || busyId === item.id}
              onClick={() => run(item.id, () => item.onClick({ dockId: item.id }))}
              dangerouslySetInnerHTML={{ __html: item.label }}
            />
          </div>
        );
      })}
    </div>
  );
}

export default ViewerToolbar;
