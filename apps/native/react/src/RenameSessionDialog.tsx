import { useEffect, useRef, useState } from "react";
import SaveButton from "./SaveButton";
import { MAX_SESSION_NAME_CHARS } from "./runningSessionLabels";

// セッション名(会話のタイトル)を変えるモーダル(issue #524)。開き方・閉じ方は既存の
// モーダル(`NewSessionDialog` など)と同じ: `<dialog>` の showModal()、Esc・×・外側
// クリックで閉じる。
//
// 共有層(issue #523)の調査で分かったこと: 実行中の CLI にタイトルを変える手段は無く、
// 会話ファイルへ custom-title 行を追記する方式になった。変わるのは会話のタイトルだけで、
// 実行中プロセスの宛先名(起動時の --name。セッション間メッセージの宛先)は次にその会話を
// 起動し直すまで古いまま。見落とされやすい挙動のため、注意書きを常に出す。

type RenameSessionDialogProps = {
  /** 現在のタイトル(入力欄の初期値)。 */
  initialTitle: string;
  onRename: (title: string) => void;
  onClose: () => void;
};

function RenameSessionDialog({ initialTitle, onRename, onClose }: RenameSessionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    // 開発時の StrictMode では effect が2回走るため、開いていなければ開く。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const trimmed = title.trim();

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog new-session"
      aria-labelledby="rename-session-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="settings-dialog-body new-session-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed === "") return;
          onRename(trimmed);
        }}
      >
        <div className="session-picker-head">
          <h3 id="rename-session-title">セッション名を変更</h3>
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
        <label className="new-session-field">
          <span className="new-session-label">セッション名</span>
          <input
            type="text"
            className="new-session-name"
            value={title}
            maxLength={MAX_SESSION_NAME_CHARS}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>
        <p className="new-session-note">
          実行中のセッションの宛先名は、次に起動し直すまで変わりません。
        </p>
        <div className="settings-dialog-actions">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <SaveButton size="small" label="変更" type="submit" disabled={trimmed === ""} />
        </div>
      </form>
    </dialog>
  );
}

export default RenameSessionDialog;
