import { useEffect, useMemo, useRef, useState } from "react";
import AddButton from "./AddButton";

// タブに出すセッションを選ぶモーダル(issue #353)。ヘッダのタブ列の左端の「+」で
// 開く。対象フォルダの全セッションを一覧し、複数選んで一度に追加できる。
// すでにタブにあるものは選べない表示にする。件数が多いので絞り込み欄を持つ。
// 開き方・閉じ方は既存のモーダル(`RawLineDialog`・プロファイル削除確認。#237/#313)
// と同じ: `<dialog>` の showModal()、Esc・×・外側クリックで閉じる。閉じるときは
// close() を呼ばず、親の状態を戻して(アンマウントして)閉じる。
export type SessionPickerCandidate = {
  // 選択の同一性に使う鍵(呼び出し側の「フォルダ|セッション ID」)。
  key: string;
  folder: string;
  title: string;
  modifiedAt: number;
};

type SessionPickerDialogProps = {
  candidates: SessionPickerCandidate[];
  // すでにタブにある鍵(選べない表示にする)。
  openKeys: Set<string>;
  // 対象フォルダが複数のときだけフォルダ名を出す。
  showFolder: boolean;
  // 選んだ鍵を、選んだ順で渡す。
  onAdd: (keys: string[]) => void;
  onClose: () => void;
};

function SessionPickerDialog({
  candidates,
  openKeys,
  showFolder,
  onAdd,
  onClose,
}: SessionPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  // 選んだ順(追加したタブの並びになる)。
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    // 開発時の StrictMode では effect が2回走るため、開いていなければ開く。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // 絞り込み(大文字・小文字を区別しない部分一致。タイトルとフォルダ名が対象)。
  // 表示を絞るだけで選択状態には影響しない。
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.title.toLowerCase().includes(q) || c.folder.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const toggle = (key: string) => {
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog session-picker"
      aria-labelledby="session-picker-title"
      onCancel={(e) => {
        // Esc。ブラウザ既定の閉じ方を止め、親の状態で閉じる。
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        // 外側(背景)のクリックは、中身ではなくダイアログ要素そのものに届く。
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-dialog-body session-picker-body">
        <div className="session-picker-head">
          <h3 id="session-picker-title">セッションを追加</h3>
          <button
            type="button"
            className="session-picker-close"
            onClick={onClose}
            title="閉じる"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        <input
          type="search"
          className="session-picker-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="タイトル・フォルダ名で絞り込み"
          aria-label="セッションを絞り込む"
        />
        <ul className="session-picker-list">
          {visible.map((c) => {
            const already = openKeys.has(c.key);
            return (
              <li key={c.key}>
                <label
                  className={`session-picker-item${already ? " disabled" : ""}${
                    picked.includes(c.key) ? " selected" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={already || picked.includes(c.key)}
                    disabled={already}
                    onChange={() => toggle(c.key)}
                  />
                  <span className="session-picker-text">
                    <span className="session-picker-title" title={c.title}>
                      {c.title}
                    </span>
                    <span className="session-picker-meta">
                      {showFolder && `${c.folder} ・ `}
                      {new Date(c.modifiedAt).toLocaleString()}
                      {already && " ・ 追加済み"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {candidates.length === 0 && <p>追加できるセッションがありません。</p>}
        {candidates.length > 0 && visible.length === 0 && (
          <p>「{query.trim()}」に一致するセッションはありません。</p>
        )}
        <div className="settings-dialog-actions">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <AddButton
            size="small"
            label={picked.length > 0 ? `追加(${picked.length})` : "追加"}
            disabled={picked.length === 0}
            onClick={() => onAdd(picked)}
          />
        </div>
      </div>
    </dialog>
  );
}

export default SessionPickerDialog;
