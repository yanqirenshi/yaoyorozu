import { useState } from "react";
import MessageText from "./MessageText";
import type { PermissionRequestDto, PermissionSuggestionDto } from "./api/types";
import { describeSuggestion } from "./runningSessionLabels";

// CLI から届いた権限の問い合わせ(issue #392。`PermissionRequest`)を、種別で出し分けて
// 表示し、答えを返す。会話の一覧の先頭(最新の位置)に出す。
//  - tool_use: ツール名・説明・入力(JSON は整形して折りたたむ)・「許可」「拒否」・提案があれば
//    「今後も許可」(選んだ提案をそのまま返す)
//  - ask_user_question: 選択肢を出し、選んだ結果を更新後の入力(`answers`)に入れて許可で返す
//    (複数選択にも対応。PoC #382 レポート §2.4)
//  - exit_plan_mode: 計画の本文を出し、「承認」「差し戻し」
// 答え(`respond`)の意味づけ・状態の更新は backend が行う。ここは入力を集めて渡すだけ。
// 中断されて CLI が取り下げたら、問い合わせ自体が一覧から消える(呼び出し側)。

export type PermissionResponder = (
  requestId: string,
  behavior: "allow" | "deny",
  options?: {
    updatedInput?: unknown;
    updatedPermissions?: PermissionSuggestionDto[];
    message?: string;
  },
) => void;

type Props = {
  request: PermissionRequestDto;
  respond: PermissionResponder;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** ツールの入力(JSON)を整形して折りたたむ。 */
function InputDetails({ input }: { input: unknown }) {
  return (
    <details className="permission-details">
      <summary>入力</summary>
      <pre className="permission-input">{formatJson(input)}</pre>
    </details>
  );
}

function ToolUseBody({ request, respond }: Props) {
  const title = request.display_name ?? request.tool_name;
  return (
    <>
      <p className="permission-title">
        ツールの使用を許可しますか?<span className="permission-tool">{title}</span>
      </p>
      {request.description && <p className="permission-description">{request.description}</p>}
      {request.blocked_path && (
        <p className="permission-description">対象のパス: {request.blocked_path}</p>
      )}
      <InputDetails input={request.tool_input} />
      <div className="permission-actions">
        <button
          type="button"
          className="permission-button permission-button-primary"
          onClick={() => respond(request.request_id, "allow")}
        >
          許可
        </button>
        <button
          type="button"
          className="permission-button"
          onClick={() => respond(request.request_id, "deny")}
        >
          拒否
        </button>
      </div>
      {request.suggestions.length > 0 && (
        <div className="permission-suggestions">
          {request.suggestions.map((suggestion, i) => (
            <button
              // 提案には ID が無く、並びは問い合わせごとに固定なので位置をキーにする。
              key={i}
              type="button"
              className="permission-button permission-button-suggestion"
              onClick={() =>
                respond(request.request_id, "allow", { updatedPermissions: [suggestion] })
              }
            >
              {describeSuggestion(suggestion)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

type Question = {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: { label: string; description: string | null }[];
};

/** `AskUserQuestion` の入力(`questions`)を読む。形が違えば空(→ 拒否だけ出す)。 */
function parseQuestions(input: unknown): Question[] {
  const questions = asRecord(input)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((q) => {
    const r = asRecord(q);
    if (!r || typeof r.question !== "string") return [];
    const options = (Array.isArray(r.options) ? r.options : []).flatMap((o) => {
      const or = asRecord(o);
      if (!or || typeof or.label !== "string") return [];
      return [
        {
          label: or.label,
          description: typeof or.description === "string" ? or.description : null,
        },
      ];
    });
    return [
      {
        question: r.question,
        header: typeof r.header === "string" ? r.header : null,
        multiSelect: r.multiSelect === true,
        options,
      },
    ];
  });
}

/** 選択肢の質問。選んだ結果を `answers`(質問文 → 選んだラベル。複数は「, 」でつなぐ)に入れる。 */
function AskUserQuestionBody({ request, respond }: Props) {
  const questions = parseQuestions(request.tool_input);
  // 質問ごとの選択(ラベルの配列)と、自由入力(「その他」)。
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});

  const answerFor = (index: number): string => {
    const labels = selected[index] ?? [];
    const free = (other[index] ?? "").trim();
    return [...labels, ...(free ? [free] : [])].join(", ");
  };
  const complete = questions.length > 0 && questions.every((_, i) => answerFor(i) !== "");

  const toggle = (index: number, label: string, multi: boolean) =>
    setSelected((prev) => {
      const current = prev[index] ?? [];
      if (!multi) return { ...prev, [index]: [label] };
      return {
        ...prev,
        [index]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      };
    });

  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, i) => {
      answers[q.question] = answerFor(i);
    });
    respond(request.request_id, "allow", {
      updatedInput: { ...(asRecord(request.tool_input) ?? {}), answers },
    });
  };

  return (
    <>
      <p className="permission-title">AI からの質問</p>
      {questions.length === 0 && (
        <>
          <p className="permission-description">質問の内容を読み取れませんでした。</p>
          <InputDetails input={request.tool_input} />
        </>
      )}
      {questions.map((q, i) => (
        <fieldset key={i} className="permission-question">
          <legend className="permission-question-text">
            {q.header && <span className="permission-question-header">{q.header}</span>}
            {q.question}
            {q.multiSelect && <span className="permission-question-note">(複数選べます)</span>}
          </legend>
          {q.options.map((o) => (
            <label key={o.label} className="permission-option">
              <input
                type={q.multiSelect ? "checkbox" : "radio"}
                name={`${request.request_id}-${i}`}
                checked={(selected[i] ?? []).includes(o.label)}
                onChange={() => toggle(i, o.label, q.multiSelect)}
              />
              <span className="permission-option-label">{o.label}</span>
              {o.description && (
                <span className="permission-option-description">{o.description}</span>
              )}
            </label>
          ))}
          <label className="permission-option permission-option-other">
            <span className="permission-option-label">その他</span>
            <input
              type="text"
              className="permission-other-input"
              placeholder="選択肢にない答えを入力"
              value={other[i] ?? ""}
              onChange={(e) => setOther((prev) => ({ ...prev, [i]: e.target.value }))}
            />
          </label>
        </fieldset>
      ))}
      <div className="permission-actions">
        <button
          type="button"
          className="permission-button permission-button-primary"
          disabled={!complete}
          onClick={submit}
        >
          答える
        </button>
        <button
          type="button"
          className="permission-button"
          onClick={() => respond(request.request_id, "deny", { message: "質問には答えませんでした" })}
        >
          答えない
        </button>
      </div>
    </>
  );
}

/** 計画の承認。本文は `plan`(Markdown)。差し戻しには理由を添えられる。 */
function ExitPlanModeBody({ request, respond }: Props) {
  const plan = asRecord(request.tool_input)?.plan;
  const [feedback, setFeedback] = useState("");
  return (
    <>
      <p className="permission-title">計画を承認しますか?</p>
      {typeof plan === "string" && plan.trim() ? (
        <div className="permission-plan">
          <MessageText text={plan} />
        </div>
      ) : (
        <InputDetails input={request.tool_input} />
      )}
      <input
        type="text"
        className="permission-other-input permission-feedback"
        placeholder="差し戻す理由(任意)"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <div className="permission-actions">
        <button
          type="button"
          className="permission-button permission-button-primary"
          onClick={() => respond(request.request_id, "allow")}
        >
          承認
        </button>
        <button
          type="button"
          className="permission-button"
          onClick={() =>
            respond(request.request_id, "deny", {
              message: feedback.trim() || "計画を差し戻しました。修正してください",
            })
          }
        >
          差し戻し
        </button>
      </div>
    </>
  );
}

export default function PermissionRequestCard({ request, respond }: Props) {
  return (
    <div className="permission-card" role="group" aria-label="AI からの問い合わせ">
      {request.request_kind === "ask_user_question" ? (
        <AskUserQuestionBody request={request} respond={respond} />
      ) : request.request_kind === "exit_plan_mode" ? (
        <ExitPlanModeBody request={request} respond={respond} />
      ) : (
        <ToolUseBody request={request} respond={respond} />
      )}
    </div>
  );
}
