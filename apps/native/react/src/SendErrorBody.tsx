import type { MessageStatusDto } from "./api/types";

/**
 * 送信に失敗したことを示すエラー行の吹き出しの中身(issue #364)。
 *
 * 会話ファイルには、送信に失敗すると「答えのない質問」と AI 側のエラー行が残る
 * (Claude Code 自体の動き)。ここでは普通の返事と見分けがつくよう、控えめに
 * 「送信に失敗しました」と出し、エラーの内容(元の本文)は折りたたんで見られるようにする。
 * 直前が答えのない質問のときだけ、次に送信するとその質問にもまとめて答えることを添える
 * (返答の途中で失敗した場合は質問に答えが出ているので添えない)。
 */
export function SendErrorBody({ text, status }: { text: string; status: MessageStatusDto }) {
  return (
    <div className="send-error">
      <p className="send-error-title">送信に失敗しました</p>
      {status === "error_for_question" && (
        <p className="send-error-hint">
          直前の質問には答えが返っていません。次に送信すると、この質問にもまとめて答えます。
        </p>
      )}
      {text.trim() && (
        <details className="send-error-details">
          <summary>エラーの内容</summary>
          <pre className="send-error-text">{text}</pre>
        </details>
      )}
    </div>
  );
}
