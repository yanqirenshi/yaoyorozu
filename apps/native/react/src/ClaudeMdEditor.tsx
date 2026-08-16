import { useEffect, useState } from "react";
import { isAppError } from "./api";
import type { ClaudeMdDto } from "./api";

type ClaudeMdEditorProps = {
  load: () => Promise<ClaudeMdDto>;
  save: (content: string, expectedModifiedAtMs: number | null) => Promise<void>;
  reloadKey: string;
  onDirtyChange?: (dirty: boolean) => void;
};

function ClaudeMdEditor({ load, save, reloadKey, onDirtyChange }: ClaudeMdEditorProps) {
  const [loading, setLoading] = useState(true);
  const [hasFile, setHasFile] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savedContent, setSavedContent] = useState("");
  const [content, setContent] = useState("");
  const [modifiedAtMs, setModifiedAtMs] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    setCreating(false);
    load()
      .then((dto) => {
        setHasFile(dto.content !== null);
        setSavedContent(dto.content ?? "");
        setContent(dto.content ?? "");
        setModifiedAtMs(dto.modified_at_ms);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [reloadKey]);

  const dirty = (hasFile || creating) && content !== savedContent;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleSave = () => {
    setSaving(true);
    setError(null);
    save(content, modifiedAtMs)
      .then(reload)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return <p>読み込み中…</p>;
  }

  if (!hasFile && !creating) {
    return (
      <div className="claude-md-editor">
        <p>CLAUDE.mdがありません。</p>
        <button type="button" onClick={() => setCreating(true)}>
          作成
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="claude-md-editor">
      <div className="claude-md-editor-actions">
        <button type="button" onClick={reload} disabled={saving}>
          再読み込み
        </button>
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      <textarea
        className="claude-md-editor-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default ClaudeMdEditor;
