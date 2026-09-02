import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { isAppError } from "./api";

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
  reload: () => Promise<void>;
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
    const [error, setError] = useState<string | null>(null);

    const reload = (): Promise<void> => {
      setLoading(true);
      setError(null);
      setCreating(false);
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

    useEffect(() => {
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey]);

    const dirty = (hasFile || creating) && content !== savedContent;

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const handleSave = (): Promise<void> => {
      if (saving) return Promise.resolve();
      setSaving(true);
      setError(null);
      return save(content, modifiedAtMs)
        .then(() => reload())
        .catch((e) => setError(isAppError(e) ? e.message : String(e)))
        .finally(() => setSaving(false));
    };

    useImperativeHandle(ref, () => ({
      save: handleSave,
      reload,
    }));

    if (loading) {
      return <p>読み込み中…</p>;
    }

    if (!hasFile && !creating) {
      return (
        <div className="json-file-editor">
          <p>{emptyMessage}</p>
          <button type="button" onClick={() => setCreating(true)}>
            {createLabel}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      );
    }

    return (
      <div className="json-file-editor">
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
