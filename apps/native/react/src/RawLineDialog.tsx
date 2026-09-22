import { useEffect, useRef, useState } from "react";
import { getSessionLineRaw, isAppError } from "./api";

// メッセージの元データ(.jsonl の該当行)を整形して見せるモーダル(issue #313)。
// 閉じる操作は プロファイル削除の確認(`DeleteProfileDialog`。issue #237)と同じ流儀:
// `<dialog>` の showModal() で開き、Esc・×・ダイアログの外側のクリックで閉じる。
// 閉じるときは close() を呼ばず、親の状態を戻して(アンマウントして)閉じる
// (close イベントは遅れて届くため、それに頼ると閉じたダイアログが残りうる)。
//
// 行の取得は開いたときにだけ行う(メッセージ一覧に生の行を載せない。tool 結果などで
// 行が非常に大きいことがあるため)。取得できなければ(ファイル変更後など)エラーを
// 出す。生のテキストは「コピー」で取れる(整形前の1行そのまま)。
type RawLineDialogProps = {
  project: string;
  sessionId: string;
  uuid: string;
  onClose: () => void;
};

// 整形表示用。JSON として読めなければ生のテキストのまま出す。
function prettyPrint(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function RawLineDialog({ project, sessionId, uuid, onClose }: RawLineDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 開発時の StrictMode では effect が2回走るため、開いていなければ開く。
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSessionLineRaw(project, sessionId, uuid)
      .then((text) => {
        if (!cancelled) setRaw(text);
      })
      .catch((e) => {
        if (!cancelled) setError(isAppError(e) ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [project, sessionId, uuid]);

  const handleCopy = () => {
    if (raw === null) return;
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog raw-line-dialog"
      aria-labelledby="raw-line-dialog-title"
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
      <div className="settings-dialog-body raw-line-dialog-body">
        <div className="raw-line-dialog-head">
          <h3 id="raw-line-dialog-title">データ</h3>
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
        <p className="raw-line-dialog-uuid" title={uuid}>
          uuid: {uuid}
        </p>
        {error ? (
          <p className="error">{error}</p>
        ) : raw === null ? (
          <p>読み込み中…</p>
        ) : (
          <pre className="raw-line-dialog-pre">{prettyPrint(raw)}</pre>
        )}
        <div className="settings-dialog-actions">
          <button type="button" onClick={handleCopy} disabled={raw === null}>
            {copied ? "コピーしました" : "コピー"}
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default RawLineDialog;
