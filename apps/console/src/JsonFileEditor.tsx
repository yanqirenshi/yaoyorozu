"use client";

import AddButton from "./AddButton";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { isAppError } from "@/api";
import StaleNotice from "./StaleNotice";

// CLAUDE.md用の ClaudeMdEditor(issue #57でmarkdown.sitter化)とは異なり、
// 中身がJSONのため素の等幅textareaで編集する(issue #70)。保存・保存前の
// mtime楽観ロック・破棄確認・dockからの操作という骨格はClaudeMdEditorと
// 同じ(issue #59)。
type FileContentDto = {
  content: string | null;
  modified_at_ms: number | null;
};

type JsonFileEditorProps = {
  load: () => Promise<FileContentDto>;
  save: (content: string, expectedModifiedAtMs: number | null) => Promise<void>;
  reloadKey: string;
  emptyMessage: string;
  createLabel?: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export type JsonFileEditorHandle = {
  save: () => Promise<void>;
  // 取り直す(今の入力は捨てる)。dockの「再読み込み」用。
  reload: () => Promise<void>;
  // 自動の取り直し(つなぎ直し・他のタブの変更)。未保存の入力があれば上書きせず、
  // 「ほかで変更されました」と「取り直す」ボタンを出す。
  refresh: () => Promise<void>;
};

const INITIAL_CONTENT = "{}";

const JsonFileEditor = forwardRef<JsonFileEditorHandle, JsonFileEditorProps>(
  function JsonFileEditor(
    { load, save, reloadKey, emptyMessage, createLabel = "作成", onDirtyChange },
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
          setSavedContent(dto.content ?? INITIAL_CONTENT);
          setContent(dto.content ?? INITIAL_CONTENT);
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
        <div className="json-file-editor">
          <p>{emptyMessage}</p>
          <AddButton label={createLabel} onClick={() => setCreating(true)} />
          {error && <p className="error">{error}</p>}
        </div>
      );
    }

    return (
      <div className="json-file-editor">
        {staleNotice}
        <textarea
          className="json-file-editor-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />
        {error && <p className="error">{error}</p>}
      </div>
    );
  },
);

export default JsonFileEditor;
