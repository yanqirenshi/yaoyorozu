import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import DOMPurify from "dompurify";
import "@yanqirenshi/markdown.sitter";
import type { MarkdownWorkspace, ViewMode } from "@yanqirenshi/markdown.sitter";
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
  // workspaceの表示モード。呼び出し元(dockの表示モード切替)が制御する
  // (issue #59)。未指定時は "split"(/claude のようにdockから制御しない
  // 呼び出し元向けの既定値)。
  mode?: ViewMode;
};

// 保存/再読み込みボタンを内部に持たず、呼び出し元(ページのdockアイテム)が
// この2つを呼べるようにする(issue #59: 操作の置き場所をdockに一本化)。
export type ClaudeMdEditorHandle = {
  save: () => Promise<void>;
  reload: () => Promise<void>;
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
      mode = "split",
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
    const [error, setError] = useState<string | null>(null);

    const workspaceRef = useRef<MarkdownWorkspace | null>(null);

    const reload = (): Promise<void> => {
      setLoading(true);
      setError(null);
      setCreating(false);
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

    useEffect(() => {
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey]);

    // React state(ロード/再読み込みで得た内容)をworkspaceへ一方向に反映する。
    // ユーザー入力はworkspaceの `input` イベント経由でReact側へ戻すため
    // (下のuseEffect)、既に同じ値ならDOMへ書き戻さない(往復を防ぐ)。
    useEffect(() => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      if (workspace.value !== content) {
        workspace.value = content;
      }
    }, [content, hasFile, creating]);

    // workspaceが(再)マウントされるたびに、sanitizeフックの設定と
    // inputイベントの購読をやり直す。sanitizeは既定が素通しのため必須で
    // 設定する: CLAUDE.mdはAIやアプリ外からも書き換わるファイルであり、
    // 素通しだとMarkdown内の生HTML/scriptがTauri WebView(= invoke で
    // backendを呼べる環境)で実行されうる(issue #57)。
    useEffect(() => {
      const workspace = workspaceRef.current;
      if (!workspace) return;

      const viewer = workspace.viewer;
      if (viewer) {
        viewer.sanitize = (html) => DOMPurify.sanitize(html);
      }

      const handleInput = () => setContent(workspace.value);
      workspace.addEventListener("input", handleInput);
      return () => workspace.removeEventListener("input", handleInput);
    }, [hasFile, creating]);

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
