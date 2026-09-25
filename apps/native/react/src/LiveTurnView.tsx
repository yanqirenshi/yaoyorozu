import MessageText from "./MessageText";
import type { MessageDto } from "./api/types";
import type { LiveTurn } from "./useRunningSession";

// 返答中の表示(issue #392): 送信中の行・作成中の AI の吹き出し・ツール。会話の一覧の
// 先頭(最新の位置)に出す。確定した行(ファイル監視で届く。#314)が一覧に現れたら、
// 同じ内容の作成中の表示は消す(二重に見えない):
//  - 送信中の行: `SentLineConfirmed` の uuid の行が一覧に現れたら消す
//  - 作成中の吹き出し(区間ごと): このターンを始めたあとに現れた assistant 行のうち、本文が
//    同じものがあれば消す(途中経過には assistant 行の uuid が無いので、本文で突き合わせる)

/** 作成中の吹き出しのうち、まだ確定した行が現れていない区間だけを返す。 */
export function unconfirmedSegments(live: LiveTurn, messages: MessageDto[]) {
  const baseline = new Set(live.baselineUuids);
  const confirmed = messages
    .filter((m) => m.role === "assistant" && (m.uuid === null || !baseline.has(m.uuid)))
    .map((m) => m.text.trim());
  return live.segments.filter((segment) => !confirmed.includes(segment.text.trim()));
}

/** 送信中の行が、まだ確定した行として現れていないか。 */
export function isPendingLineVisible(live: LiveTurn, messages: MessageDto[]) {
  const pending = live.pendingLine;
  if (!pending) return false;
  return pending.uuid === null || !messages.some((m) => m.uuid === pending.uuid);
}

type Props = {
  live: LiveTurn;
  messages: MessageDto[];
};

const TOOL_STATE_LABEL = { running: "実行中", done: "完了", error: "エラー" } as const;

/** 一覧の先頭に置く要素(新しい順なので、上から 作成中の AI → 送信中の行)。 */
export default function LiveTurnView({ live, messages }: Props) {
  const segments = unconfirmedSegments(live, messages);
  const showPending = isPendingLineVisible(live, messages);
  const hasAssistantPart = segments.length > 0 || live.tools.length > 0;
  if (!showPending && !hasAssistantPart) return null;

  return (
    <>
      {hasAssistantPart && (
        <div className="message-row message-row-assistant message-row-live">
          <div className="message-meta message-meta-assistant">
            <span className="message-meta-role">assistant</span>
            <span className="message-meta-live">作成中</span>
          </div>
          <div className="message message-assistant message-live">
            {segments.map((segment) => (
              <MessageText key={segment.id} text={segment.text} />
            ))}
            {live.tools.length > 0 && (
              <ul className="live-tools" aria-label="使用中のツール">
                {live.tools.map((tool) => (
                  <li key={tool.toolUseId} className={`live-tool live-tool-${tool.state}`}>
                    <span className="live-tool-name">{tool.toolName}</span>
                    <span className="live-tool-state">{TOOL_STATE_LABEL[tool.state]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {showPending && live.pendingLine && (
        <div className="message-row message-row-user message-row-live">
          <div className="message-meta message-meta-user">
            <span className="message-meta-role">user</span>
            <span className="message-meta-live">送信中</span>
          </div>
          <div className="message message-user message-live">
            {live.pendingLine.text && <MessageText text={live.pendingLine.text} />}
            {live.pendingLine.imageCount > 0 && (
              <span className="message-images-count">画像 {live.pendingLine.imageCount} 枚</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
