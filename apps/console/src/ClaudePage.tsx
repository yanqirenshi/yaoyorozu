"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DockItem } from "command-dock";
import type { ViewMode } from "@yanqirenshi/markdown.sitter";
import {
  getClaudeSettingsFile,
  getUserClaudeMd,
  onReconnected,
  saveClaudeSettingsFile,
  saveUserClaudeMd,
} from "@/api";
import ClaudeDirExplorer from "./ClaudeDirExplorer";
import type { ClaudeDirExplorerHandle } from "./ClaudeDirExplorer";
import ClaudeMdEditor from "./ClaudeMdEditor";
import type { ClaudeMdEditorHandle } from "./ClaudeMdEditor";
import { createClaudeMdDockItems } from "./claudeMdDockItems";
import { usePageDockItems } from "./DockItemsContext";
import { RELOAD_ICON } from "./icons";
import JsonFileEditor from "./JsonFileEditor";
import type { JsonFileEditorHandle } from "./JsonFileEditor";
import Tabs, { tabPanelProps } from "./Tabs";
import { createProjectSettingsDockItems } from "./projectSettingsDockItems";

type ClaudeTab = "claude-md" | "settings" | "explorer";

const CLAUDE_TABS: ClaudeTab[] = ["claude-md", "settings", "explorer"];

// URLに `tab` が無いときのタブ(タブ列の先頭)。
const DEFAULT_TAB: ClaudeTab = "claude-md";

const TAB_DEFS = [
  { id: "claude-md", label: "CLAUDE.md" },
  { id: "settings", label: "settings.json" },
  { id: "explorer", label: "Explorer" },
];

// 各タブが対象とする場所(表示用)。実際のパス解決はRust側で行う(native.md §4)。
const TAB_TARGET_PATH: Record<ClaudeTab, string> = {
  "claude-md": "~/.claude/CLAUDE.md",
  settings: "~/.claude/settings.json",
  explorer: "~/.claude",
};

const DISCARD_CONFIRM_MESSAGE = {
  "claude-md": "CLAUDE.mdの編集内容を破棄しますか?保存していない変更は失われます。",
  settings: "settings.jsonの編集内容を破棄しますか?保存していない変更は失われます。",
} as const;

// `~/.claude` の内容を管理する画面(issue #53)。タブで対象を切り替える:
// CLAUDE.md(ユーザーレベルのメモリ)・settings.json の参照/編集/作成と、
// `~/.claude` 配下のフォルダ・ファイルの表示(Explorer)。表示中のタブは
// URL(`?tab=`)に置き、リロードで復元できるようにする(native.md §6)。
function ClaudePage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const tab: ClaudeTab = CLAUDE_TABS.includes(tabParam as ClaudeTab)
    ? (tabParam as ClaudeTab)
    : DEFAULT_TAB;

  const [claudeMdDirty, setClaudeMdDirty] = useState(false);
  const [claudeMdMode, setClaudeMdMode] = useState<ViewMode>("preview");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const claudeMdEditorRef = useRef<ClaudeMdEditorHandle>(null);
  const settingsEditorRef = useRef<JsonFileEditorHandle>(null);
  const explorerRef = useRef<ClaudeDirExplorerHandle>(null);

  // 表示中のタブの未保存編集だけを確認する(非表示のタブのエディタは
  // アンマウントされ、編集内容は残らないため)。
  const confirmDiscardIfDirty = (): boolean => {
    if (tab === "claude-md" && claudeMdDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE["claude-md"]);
    }
    if (tab === "settings" && settingsDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE.settings);
    }
    return true;
  };

  const handleChangeTab = (next: string) => {
    if (next === tab) return;
    if (!confirmDiscardIfDirty()) return;
    const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TAB) {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  // つなぎ直せたら、切れている間の変更を取り込むため表示中のタブを取り直す。
  // 未保存の編集があるときは、編集を上書きしない(エディタが「ほかで変更されました」と
  // 「取り直す」ボタンを出す。`refresh`)。無ければ今までどおり取り直す。
  const reconnectTab = useRef(tab);
  reconnectTab.current = tab;
  useEffect(() => {
    const unlistenPromise = onReconnected(() => {
      const current = reconnectTab.current;
      if (current === "claude-md") {
        void claudeMdEditorRef.current?.refresh();
      } else if (current === "settings") {
        void settingsEditorRef.current?.refresh();
      } else if (current === "explorer") {
        explorerRef.current?.reload();
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const dockItems = useMemo<DockItem[]>(() => {
    switch (tab) {
      case "claude-md":
        return createClaudeMdDockItems({
          mode: claudeMdMode,
          onModeChange: setClaudeMdMode,
          dirty: claudeMdDirty,
          onSave: () => claudeMdEditorRef.current?.save(),
          onReload: () => {
            if (claudeMdDirty && !window.confirm(DISCARD_CONFIRM_MESSAGE["claude-md"])) return;
            return claudeMdEditorRef.current?.reload();
          },
        });
      case "settings":
        // 保存・再読み込みの2トリガーはプロジェクトの settings.json 用と
        // 同じ内容のため、そのまま流用する。
        return createProjectSettingsDockItems({
          dirty: settingsDirty,
          onSave: () => settingsEditorRef.current?.save(),
          onReload: () => {
            if (settingsDirty && !window.confirm(DISCARD_CONFIRM_MESSAGE.settings)) return;
            return settingsEditorRef.current?.reload();
          },
        });
      case "explorer":
        return [
          {
            id: "claude-explorer-reload",
            label: RELOAD_ICON,
            title: "再読み込み",
            onClick: () => explorerRef.current?.reload(),
          },
        ];
    }
  }, [tab, claudeMdMode, claudeMdDirty, settingsDirty]);
  usePageDockItems(dockItems);

  return (
    <div className="claude-page">
      <Tabs
        id="claude-tabs"
        aria-label="Claudeの設定の切り替え"
        size="small"
        items={TAB_DEFS}
        value={tab}
        onChange={handleChangeTab}
      />
      <p className="claude-page-path">{TAB_TARGET_PATH[tab]}</p>
      <section className="claude-page-section" {...tabPanelProps("claude-tabs", tab)}>
        {tab === "claude-md" && (
          <ClaudeMdEditor
            ref={claudeMdEditorRef}
            load={getUserClaudeMd}
            save={saveUserClaudeMd}
            reloadKey="user-claude-md"
            mode={claudeMdMode}
            onDirtyChange={setClaudeMdDirty}
            onCreate={() => setClaudeMdMode("split")}
            emptyMessage="~/.claude/CLAUDE.md がありません。"
          />
        )}
        {tab === "settings" && (
          <JsonFileEditor
            ref={settingsEditorRef}
            load={getClaudeSettingsFile}
            save={saveClaudeSettingsFile}
            reloadKey="claude-settings"
            onDirtyChange={setSettingsDirty}
            emptyMessage="~/.claude/settings.json がありません。"
          />
        )}
        {tab === "explorer" && <ClaudeDirExplorer ref={explorerRef} />}
      </section>
    </div>
  );
}

export default ClaudePage;
