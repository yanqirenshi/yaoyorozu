// stream-json を話す使い捨ての偽 claude CLI(issue #391 の統合テスト用。PoC #382 レポートの
// 実出力の形を写している)。認証・課金・実際の会話ファイルには一切触れない。
//
// 本文の合図で挙動を変える:
//   PERM  → Write の権限の問い合わせ(control_request)を出し、応答(または中断)を待つ
//   ASK   → AskUserQuestion(選択肢の質問。2問・うち1問は複数選択)の問い合わせを出す
//   PLAN  → ExitPlanMode(計画の承認)の問い合わせを出す
//   SLOW  → 100ms ごとに text_delta を出し続け、interrupt で止まる
//   HANG  → 標準入力を閉じても終了しない(kill されるまで生きている)
//   ARGS  → 起動引数(argv)を text_delta で返す(--session-id / --name / --permission-mode の確認用)
//   DIE   → 標準エラーに 1 行出して exit 3(--resume の ID が無いときの実出力に合わせた文言)
//   それ以外 → text_delta を1つ出して result(success)
// 標準入力が閉じたら exit 0(HANG のあとを除く)。
// 制御メッセージ: initialize / interrupt / set_model / set_permission_mode(成功を返す。以降の
// system/init の model / permissionMode に反映する。issue #407)。
const readline = require("readline");
const fs = require("fs");

// 環境変数 FAKE_CLAUDE_SESSION_FILE があれば、実物の CLI と同じく会話ファイル(jsonl)へ
// 行を追記する(送信した user 行と、確定した assistant 行)。画面の「作成中の表示が、確定した
// 行が現れたら消える(二重に見えない)」の確認用。
const SESSION_FILE = process.env.FAKE_CLAUDE_SESSION_FILE;
let lastParent = null;
const append = (obj) => {
  if (!SESSION_FILE) return;
  const line = { parentUuid: lastParent, sessionId: "fake-session", cwd: process.cwd(), timestamp: new Date().toISOString(), ...obj };
  fs.appendFileSync(SESSION_FILE, JSON.stringify(line) + "\n");
  if (obj.uuid) lastParent = obj.uuid;
};
let lastEcho = null;

// 起動引数(--resume=<ID> / --session-id=<UUID> / --name=<名前> / --permission-mode <モード>)。
const ARGV = process.argv.slice(2);
const argValue = (name) => {
  const eq = ARGV.find((a) => a.startsWith(name + "="));
  if (eq) return eq.slice(name.length + 1);
  const i = ARGV.indexOf(name);
  return i >= 0 ? ARGV[i + 1] : undefined;
};
const SESSION_ID = argValue("--session-id") || argValue("--resume") || "fake-session";
let model = "fake";
let permissionMode = argValue("--permission-mode") || "default";
// 実物はエイリアス(haiku など)を解決済みのモデル名にして system/init で返す。
const MODEL_ALIASES = { haiku: "claude-haiku-4-5-20251001", opus: "claude-opus-4-7" };

let uuidCounter = 0;
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const textOf = (message) =>
  (Array.isArray(message.content) ? message.content : [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

let pending = null; // { requestId, toolUseId }
let slowTimer = null;
let hang = false;

const init = () =>
  out({ type: "system", subtype: "init", session_id: SESSION_ID, model, permissionMode });
const delta = (text) =>
  out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, parent_tool_use_id: null });
const result = (isError, subtype = "success") => {
  if (!isError && lastEcho !== null) {
    uuidCounter += 1;
    append({ type: "assistant", uuid: `fake-assistant-${uuidCounter}`, message: { role: "assistant", content: [{ type: "text", text: lastEcho }] } });
    lastEcho = null;
  }
  resultLine(isError, subtype);
};
const resultLine = (isError, subtype = "success") =>
  out({ type: "result", subtype, is_error: isError, result: isError ? "aborted" : "done", num_turns: 1 });
const toolResult = (toolUseId, isError) =>
  out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: isError ? "The user doesn't want to proceed" : "ok", ...(isError ? { is_error: true } : {}) }] }, parent_tool_use_id: null });

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.type === "user") {
    const text = textOf(msg.message || {});
    if (text.includes("DIE")) {
      process.stderr.write("No conversation found with session ID: fake\n");
      process.exit(3);
    }
    init();
    out({ type: "system", subtype: "status", status: "requesting" });
    delta(`echo: ${text}`);
    lastEcho = `echo: ${text}`;
    uuidCounter += 1;
    append({ type: "user", uuid: `fake-uuid-${uuidCounter}`, message: { role: "user", content: text } });
    out({ type: "user", message: msg.message, session_id: "fake-session", parent_tool_use_id: null, uuid: `fake-uuid-${uuidCounter}`, timestamp: new Date().toISOString(), isReplay: true });
    if (text.includes("ASK") || text.includes("PLAN")) {
      const ask = text.includes("ASK");
      pending = { requestId: `perm-${uuidCounter}`, toolUseId: `toolu_${uuidCounter}` };
      out({
        type: "control_request",
        request_id: pending.requestId,
        request: {
          subtype: "can_use_tool",
          tool_name: ask ? "AskUserQuestion" : "ExitPlanMode",
          display_name: ask ? "AskUserQuestion" : "ExitPlanMode",
          tool_use_id: pending.toolUseId,
          input: ask
            ? { questions: [
                { question: "どの方針にしますか?", header: "方針", multiSelect: false, options: [{ label: "A案", description: "速いが粗い" }, { label: "B案", description: "遅いが丁寧" }] },
                { question: "追加で行うものは?(複数可)", header: "追加", multiSelect: true, options: [{ label: "テスト" }, { label: "ドキュメント" }, { label: "整形" }] },
              ] }
            : { plan: ["## 計画", "", "1. 調べる", "2. 直す", "3. 確かめる", "", "変更するのは `a.txt` だけです。"].join("\n") },
        },
      });
    } else if (text.includes("PERM")) {
      pending = { requestId: `perm-${uuidCounter}`, toolUseId: `toolu_${uuidCounter}` };
      out({
        type: "control_request",
        request_id: pending.requestId,
        request: {
          subtype: "can_use_tool",
          tool_name: "Write",
          display_name: "Write",
          description: "poc.txt",
          tool_use_id: pending.toolUseId,
          input: { content: "hello", file_path: "poc.txt" },
          permission_suggestions: [{ destination: "session", mode: "acceptEdits", type: "setMode" }],
        },
      });
    } else if (text.includes("ARGS")) {
      delta(`args: ${JSON.stringify(ARGV)}`);
      result(false);
    } else if (text.includes("SLOW")) {
      let n = 0;
      slowTimer = setInterval(() => delta(String(++n)), 100);
    } else if (text.includes("HANG")) {
      hang = true;
      result(false);
    } else {
      result(false);
    }
    return;
  }

  if (msg.type === "control_response" && pending && msg.response && msg.response.request_id === pending.requestId) {
    const behavior = msg.response.response && msg.response.response.behavior;
    const { toolUseId } = pending;
    pending = null;
    out(msg); // 実物は応答をエコーする(レポート §2.1)
    const updated = msg.response.response && msg.response.response.updatedInput;
    if (updated && updated.answers) {
      lastEcho = `answers: ${JSON.stringify(updated.answers)}`;
      delta(lastEcho);
    }
    toolResult(toolUseId, behavior !== "allow");
    result(false);
    return;
  }

  if (msg.type === "control_request" && msg.request && msg.request.subtype === "initialize") {
    // 実物の応答にはアカウント情報(メールアドレスを含む)が入る。app は中身を読まない。
    out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response: { account: { email: "secret@example.com" }, models: [{ value: "default", displayName: "Default (recommended)", description: "Fake default" }, { value: "sonnet", displayName: "Sonnet" }, { value: "haiku", displayName: "Haiku" }], commands: [], pid: process.pid } } });
    return;
  }

  if (msg.type === "control_request" && msg.request && msg.request.subtype === "set_model") {
    model = MODEL_ALIASES[msg.request.model] || msg.request.model;
    out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id } });
    return;
  }

  if (msg.type === "control_request" && msg.request && msg.request.subtype === "set_permission_mode") {
    permissionMode = msg.request.mode;
    out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response: { mode: msg.request.mode } } });
    return;
  }

  if (msg.type === "control_request" && msg.request && msg.request.subtype === "interrupt") {
    if (pending) {
      out({ type: "control_cancel_request", request_id: pending.requestId });
      out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id } });
      toolResult(pending.toolUseId, true);
      pending = null;
      result(true, "error_during_execution");
    } else {
      if (slowTimer) { clearInterval(slowTimer); slowTimer = null; }
      out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id } });
      result(true, "error_during_execution");
    }
  }
});

rl.on("close", () => {
  if (hang) {
    setInterval(() => {}, 1000); // 標準入力を閉じても終了しない(kill されるまで)
    return;
  }
  process.exit(0);
});
