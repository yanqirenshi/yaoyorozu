"use client";

import AddButton from "./AddButton";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import "./externalLinks";
import "@yanqirenshi/markdown.sitter";
import type { MarkdownWorkspace, ViewMode } from "@yanqirenshi/markdown.sitter";
import { isAppError } from "@/api";
import StaleNotice from "./StaleNotice";
import { armWorkspace, setWorkspaceValue } from "./safeMarkdown";

// CLAUDE.md(issue #27)・settings.json(issue #53)のどちらも
// `{ content, modified_at_ms }` の同形DTOなので、この部品はRust側の
// 個別DTO型に依存せず構造的な形だけを見る。
type FileContentDto = {
  content: string | null;
  modified_at_ms: number | null;
};

type ClaudeMdEditorProps = {
  load: () => Promise<FileContentDto>;
  save: (content: string, expectedModifiedAtMs: number | null) => Promise<void>;
  reloadKey: string;
  onDirtyChange?: (dirty: boolean) => void;
  // ファイルが無いときの案内文と作成ボタンのラベル。既定はCLAUDE.md用。
  emptyMessage?: string;
  createLabel?: string;
  // 「作成」を押した際の初期内容。既定は空文字列(CLAUDE.md用)。
  // settings.jsonでは空オブジェクト `{}` から編集開始する(issue #53)。
  initialContent?: string;
  // workspaceの表示モード。呼び出し元(dockの表示モード切替)が制御する
  // (issue #59)。未指定時は "preview"(/claude のようにdockから制御しない
  // 呼び出し元向けの既定値)。
  mode?: ViewMode;
  // 「作成」が押されたときの通知。表示モードは呼び出し元が制御するため、
  // 既定の "preview" のままだと作成直後に入力欄が出ない。呼び出し元はここで
  // 入力欄のあるモードへ切り替える。
  onCreate?: () => void;
};

// 保存/再読み込みボタンを内部に持たず、呼び出し元(ページのdockアイテム)が
// この2つを呼べるようにする(issue #59: 操作の置き場所をdockに一本化)。
export type ClaudeMdEditorHandle = {
  save: () => Promise<void>;
  // 取り直す(今の入力は捨てる)。dockの「再読み込み」用。
  reload: () => Promise<void>;
  // 自動の取り直し(つなぎ直し・他のタブの変更)。未保存の入力があれば上書きせず、
  // 「ほかで変更されました」と「取り直す」ボタンを出す。
  refresh: () => Promise<void>;
};

const ClaudeMdEditor = forwardRef<ClaudeMdEditorHandle, ClaudeMdEditorProps>(
  function ClaudeMdEditor(
    {
      load,
      save,
      reloadKey,
      onDirtyChange,
      emptyMessage = "CLAUDE.mdがありません。",
      createLabel = "作成",
      initialContent = "",
      mode = "preview",
      onCreate,
    },
    ref,
  ) {
    const [loading, setLoading] = useState(true);
    const [hasFile, setHasFile] = useState(false);
    const [creating, setCreating] = useState(false);
    const [savedContent, setSavedContent] = useState("");
    const [content, setContent] = useState("");
    const [modifiedAtMs, setModifiedAtMs] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);

    const workspaceRef = useRef<MarkdownWorkspace | null>(null);

    // 入力中の内容を取り直しで上書きしないための印(`refresh` と `StaleNotice`)。
    const [targetChanged, setTargetChanged] = useState(false);
    const firstLoadDone = useRef(false);
    const dirtyRef = useRef(false);
    const [stale, setStale] = useState(false);

    // 取り直す(今の入力は捨てる)。dockの「再読み込み」・「取り直す」ボタン用。
    const reload = (): Promise<void> => {
      setLoading(true);
      setError(null);
      setCreating(false);
      setStale(false);
      setTargetChanged(false);
      return load()
        .then((dto) => {
          setHasFile(dto.content !== null);
          setSavedContent(dto.content ?? initialContent);
          setContent(dto.content ?? initialContent);
          setModifiedAtMs(dto.modified_at_ms);
        })
        .catch((e) => setError(isAppError(e) ? e.message : String(e)))
        .finally(() => setLoading(false));
    };

    // 最初の読み込みと、対象(reloadKey)が変わったとき。対象が変わったときに未保存の入力があれば、
    // 上書きせず「ほかで変更されました」を出す(別のファイルになったので、保存は取り直すまで止める)。
    useEffect(() => {
      if (firstLoadDone.current && dirtyRef.current) {
        setStale(true);
        setTargetChanged(true);
        return;
      }
      firstLoadDone.current = true;
      void reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey]);

    // React state(ロード/再読み込みで得た内容)をworkspaceへ一方向に反映する。
    // ユーザー入力はworkspaceの `input` イベント経由でReact側へ戻すため(下のuseEffect)、
    // 既に同じ値ならDOMへ書き戻さない(往復を防ぐ)。
    //
    // **無害化は、内容を渡す前に必ず仕込む**(`setWorkspaceValue` が先にプレビューへ無害化を仕込み、
    // 仕込めなければ渡さない)。以前は「内容を入れる effect」が「無害化を設定する effect」より先に走り、
    // 最初の描画が素通しで行われて、`<img onerror>` が画面のオリジンで実行された(XSS)。
    // effect の宣言順に頼らない(`safeMarkdown.ts`)。
    useEffect(() => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      if (workspace.value !== content) {
        setWorkspaceValue(workspace, content);
      }
    }, [content, hasFile, creating]);

    // workspaceが(再)マウントされるたびに、無害化の仕込みと input イベントの購読をやり直す
    // (ユーザーの入力が live のプレビューへ流れる前に、プレビューへ無害化を仕込む)。
    useEffect(() => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      armWorkspace(workspace);

      const handleInput = () => {
        armWorkspace(workspace);
        setContent(workspace.value);
      };
      workspace.addEventListener("input", handleInput);
      return () => workspace.removeEventListener("input", handleInput);
    }, [hasFile, creating]);

    const dirty = (hasFile || creating) && content !== savedContent;
    dirtyRef.current = dirty;

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    // 自動の取り直し(つなぎ直し・他のタブの変更など)。未保存の入力があれば上書きせず、
    // 「ほかで変更されました」を出す(「取り直す」で取り直す)。無ければ今までどおり取り直す。
    const refresh = (): Promise<void> => {
      if (dirtyRef.current) {
        setStale(true);
        return Promise.resolve();
      }
      return reload();
    };

    // 保存に失敗(サーバ停止など)しても、入力・未保存の状態はそのまま残す(`reload` は成功時だけ)。
    const handleSave = (): Promise<void> => {
      // 状態は再描画までの間は古いままなので、同じ瞬間の 2 回目は ref で止める。
      if (saving || savingRef.current) return Promise.resolve();
      if (targetChanged) {
        setError("保存先が変わったため保存できません。「取り直す」で取り直してください。");
        return Promise.resolve();
      }
      savingRef.current = true;
      setSaving(true);
      setError(null);
      return save(content, modifiedAtMs)
        .then(() => reload())
        .catch((e) => setError(isAppError(e) ? e.message : String(e)))
        .finally(() => {
          savingRef.current = false;
          setSaving(false);
        });
    };

    useImperativeHandle(ref, () => ({
      save: handleSave,
      reload,
      refresh,
    }));

    const staleNotice = stale ? (
      <StaleNotice
        onReload={() => void reload()}
        message={
          targetChanged
            ? "保存先が変わりました。入力中の内容は残してありますが、取り直すまで保存できません。"
            : undefined
        }
      />
    ) : null;

    if (loading) {
      return <p>読み込み中…</p>;
    }

    if (!hasFile && !creating) {
      return (
        <div className="claude-md-editor">
          <p>{emptyMessage}</p>
          <AddButton
            label={createLabel}
            onClick={() => {
              setCreating(true);
              onCreate?.();
            }}
          />
          {error && <p className="error">{error}</p>}
        </div>
      );
    }

    return (
      <div className="claude-md-editor">
        {staleNotice}
        <markdown-workspace
          ref={workspaceRef}
          mode={mode}
          live
          className="claude-md-editor-workspace"
        >
          <markdown-editor slot="editor" placeholder="Markdownを入力" />
          <markdown-viewer slot="preview" foldable />
        </markdown-workspace>
        {error && <p className="error">{error}</p>}
      </div>
    );
  },
);

export default ClaudeMdEditor;
