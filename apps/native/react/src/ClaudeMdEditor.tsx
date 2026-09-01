import { useEffect, useState } from "react";
import { isAppError } from "./api";

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
};

function ClaudeMdEditor({
  load,
  save,
  reloadKey,
  onDirtyChange,
  emptyMessage = "CLAUDE.mdがありません。",
  createLabel = "作成",
  initialContent = "",
}: ClaudeMdEditorProps) {
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
        setSavedContent(dto.content ?? initialContent);
        setContent(dto.content ?? initialContent);
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
        <p>{emptyMessage}</p>
        <button type="button" onClick={() => setCreating(true)}>
          {createLabel}
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
