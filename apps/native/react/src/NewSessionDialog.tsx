import { useEffect, useRef, useState } from "react";
import AddButton from "./AddButton";
import type { RunningPermissionModeDto } from "./api/types";
import { PERMISSION_MODE_LABELS } from "./runningSessionLabels";

// 新規セッションを作るモーダル(issue #409)。表示名(任意)と権限モードを入れて「作成」で、
// app が新しい会話(`--session-id`)を起動する。開き方・閉じ方は既存のモーダル
// (`SessionPickerDialog` など)と同じ: `<dialog>` の showModal()、Esc・×・外側クリックで
// 閉じる。閉じるときは close() を呼ばず、親の状態を戻して(アンマウントして)閉じる。
// 作成の失敗(同時数の上限など)は、親が既存のバナーで理由を出す。

export type NewSessionInput = {
  /** 表示名(`--name`)。空なら `null`。 */
  name: string | null;
  mode: RunningPermissionModeDto;
};

type NewSessionDialogProps = {
  /** 権限モードの初期値(ビューアで選んでいる「次の起動」のモード)。 */
  initialMode: RunningPermissionModeDto;
  onCreate: (input: NewSessionInput) => void;
  onClose: () => void;
};

const MODES: RunningPermissionModeDto[] = ["default", "plan", "accept_edits", "auto"];

/** 表示名の長さの上限(backend の `MAX_NAME_CHARS` と同じ。超過は backend が断る)。 */
const MAX_NAME_CHARS = 100;

function NewSessionDialog({ initialMode, onCreate, onClose }: NewSessionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<RunningPermissionModeDto>(initialMode);

  useEffect(() => {
    // 開発時の StrictMode では effect が2回走るため、開いていなければ開く。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog new-session"
      aria-labelledby="new-session-title"
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
          onCreate({ name: name.trim() === "" ? null : name.trim(), mode });
        }}
      >
        <div className="session-picker-head">
          <h3 id="new-session-title">新規セッション</h3>
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
          <span className="new-session-label">表示名(任意)</span>
          <input
            type="text"
            className="new-session-name"
            value={name}
            maxLength={MAX_NAME_CHARS}
            onChange={(e) => setName(e.target.value)}
            placeholder="会話のタイトルになります"
          />
        </label>
        <fieldset className="new-session-field new-session-modes">
          <legend className="new-session-label">権限モード</legend>
          {MODES.map((value) => (
            <label key={value} className="new-session-mode">
              <input
                type="radio"
                name="new-session-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>{PERMISSION_MODE_LABELS[value]}</span>
            </label>
          ))}
        </fieldset>
        <p className="new-session-note">
          プロファイルのリポジトリで新しい会話を始めます。会話ファイルは、最初のメッセージを送ると
          できます。
        </p>
        <div className="settings-dialog-actions">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <AddButton size="small" label="作成" type="submit" />
        </div>
      </form>
    </dialog>
  );
}

export default NewSessionDialog;
