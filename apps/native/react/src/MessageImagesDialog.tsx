import { useEffect, useRef, useState } from "react";
import { getSessionLineImages, isAppError } from "./api";
import type { MessageImageDto } from "./api";

// メッセージに含まれる画像を見せるモーダル(issue #349)。「データ」ボタンの
// `RawLineDialog`(issue #313)と同じ流儀: `<dialog>` の showModal() で開き、Esc・×・
// 外側のクリックで閉じる(親の状態で閉じる)。画像は開いたときにだけ、uuid 指定で
// その行の分だけを取る(メッセージ一覧には画像本体を載せない。画像が大きいため)。
type MessageImagesDialogProps = {
  project: string;
  sessionId: string;
  uuid: string;
  onClose: () => void;
};

function MessageImagesDialog({ project, sessionId, uuid, onClose }: MessageImagesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [images, setImages] = useState<MessageImageDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 開発時の StrictMode では effect が2回走るため、開いていなければ開く。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSessionLineImages(project, sessionId, uuid)
      .then((result) => {
        if (!cancelled) setImages(result);
      })
      .catch((e) => {
        if (!cancelled) setError(isAppError(e) ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [project, sessionId, uuid]);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog raw-line-dialog"
      aria-labelledby="message-images-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-dialog-body raw-line-dialog-body">
        <div className="raw-line-dialog-head">
          <h3 id="message-images-dialog-title">画像</h3>
          <button
            type="button"
            className="raw-line-dialog-close"
            onClick={onClose}
            title="閉じる"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        {error ? (
          <p className="error">{error}</p>
        ) : images === null ? (
          <p>読み込み中…</p>
        ) : images.length === 0 ? (
          <p>表示できる画像がありません。</p>
        ) : (
          <div className="message-images-list">
            {images.map((image, i) => (
              <img
                key={i}
                className="message-images-item"
                src={`data:${image.media_type};base64,${image.data}`}
                alt={`画像 ${i + 1}`}
              />
            ))}
          </div>
        )}
        <div className="settings-dialog-actions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default MessageImagesDialog;
