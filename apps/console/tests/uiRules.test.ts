// 画面の小さな判断(純粋なもの)のテスト: とても大きい発言・会話ごとの下書き・起動エラーを出すか・アクティブへ追従する画面。

import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftStore } from "../src/draftStore.ts";
import { holdReason, shouldHoldDisplay } from "../src/followActive.ts";
import { firstCodePoints, LARGE_TEXT_CHARS, PREVIEW_CHARS, viewOfText } from "../src/largeText.ts";
import { busyKind, shouldShowStartError, shouldWaitForRunning } from "../src/startError.ts";

test("1MB までの発言はそのまま Markdown。超えたら先頭だけを素の文字で出し、省略したと添える", () => {
  assert.deepEqual(viewOfText("a".repeat(LARGE_TEXT_CHARS)), { large: false });
  const view = viewOfText("あ".repeat(LARGE_TEXT_CHARS + 1));
  assert.equal(view.large, true);
  if (view.large) {
    assert.equal(Array.from(view.preview).length, PREVIEW_CHARS);
    assert.match(view.note, /大きいため省略しました/);
  }
});

test("会話ごとに下書きと画像を持ち、切り替えると、その会話の下書きが出て、戻ると元の下書きが戻る", () => {
  const store = createDraftStore<string>();
  const a = { text: "A の下書き", attachments: ["img-a"] };
  // A → B: B の下書きは無いので空(A の下書きは B へ持ち越されない)。
  const atB = store.switch("A", a, "B");
  assert.deepEqual(atB, { text: "", attachments: [] });
  // B で書いて、B → A: A の下書きが戻る。
  const backAtA = store.switch("B", { text: "B の下書き", attachments: [] }, "A");
  assert.deepEqual(backAtA, a);
  // A → B: B の下書きが戻る。
  assert.deepEqual(store.switch("A", backAtA, "B"), { text: "B の下書き", attachments: [] });
  // 選択を外す(null)と、いまの会話の下書きは控えられ、何も出ない。
  assert.deepEqual(store.switch("B", { text: "B2", attachments: [] }, null), { text: "", attachments: [] });
  assert.deepEqual(store.switch(null, { text: "", attachments: [] }, "B"), { text: "B2", attachments: [] });
});

test("空の入力は控えない(会話が増えても、メモリが増えない)", () => {
  const store = createDraftStore<string>();
  store.switch("A", { text: "", attachments: [] }, "B");
  assert.equal(store.size(), 0);
});

test("409(起動している最中)でも、取り直して実行中になっていれば、エラーを出さない", () => {
  const busy = { code: "session_busy", message: "この会話は起動している最中です" };
  assert.equal(shouldShowStartError(busy, { process_state: "idle" }), false);
  assert.equal(shouldShowStartError(busy, { process_state: "starting" }), false);
  // 実行中になっていない(終了・見つからない)なら出す。
  assert.equal(shouldShowStartError(busy, { process_state: "exited" }), true);
  assert.equal(shouldShowStartError(busy, null), true);
  // 409 以外は、いつも出す。
  assert.equal(shouldShowStartError({ code: "cwd_missing", message: "x" }, { process_state: "idle" }), true);
  assert.equal(shouldShowStartError(new Error("x"), { process_state: "idle" }), true);
});

test("/settings は、保存していない入力があるときだけ、アクティブが変わっても表示を移さない", () => {
  const base = { followsActive: true, shownId: "p1", activeId: "p2", dirty: true, touched: true, force: false, shownStillExists: true };
  assert.equal(shouldHoldDisplay(base), true);
  // 入力が無いときは、移してよい。
  assert.equal(shouldHoldDisplay({ ...base, dirty: false, touched: false }), false);
  // 利用者が選んだ(force)ときは、移す。
  assert.equal(shouldHoldDisplay({ ...base, force: true }), false);
  // アクティブが同じ・まだ何も読んでいない・プロファイルを指定した画面・表示中のものが削除された、は移す(止めない)。
  assert.equal(shouldHoldDisplay({ ...base, activeId: "p1" }), false);
  assert.equal(shouldHoldDisplay({ ...base, shownId: null }), false);
  assert.equal(shouldHoldDisplay({ ...base, followsActive: false }), false);
  assert.equal(shouldHoldDisplay({ ...base, shownStillExists: false, dirty: false, touched: false }), false);
  // 表示中のものが削除されても、入力が残っているときは、確かめなしに消さない(止めて、知らせる)。
  assert.equal(shouldHoldDisplay({ ...base, shownStillExists: false }), true);
});

test("先頭の切り方は、符号位置の境目(サロゲートペアの途中で切らない)", () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  // 境目(2,000 番目)が絵文字の途中になる並び: 1,999 文字 + 絵文字 + 続き。
  const text = "a".repeat(PREVIEW_CHARS - 1) + "😀" + "b".repeat(LARGE_TEXT_CHARS);
  const view = viewOfText(text);
  assert.equal(view.large, true);
  if (view.large) {
    assert.equal(lone.test(view.preview), false, "孤立したサロゲートが無い");
    assert.equal(Array.from(view.preview).length, PREVIEW_CHARS);
    assert.ok(view.preview.endsWith("😀"));
  }
  // 絵文字だけの発言でも、符号位置で数える。
  assert.equal(Array.from(firstCodePoints("😀".repeat(5000), 2000)).length, 2000);
  assert.equal(lone.test(firstCodePoints("😀".repeat(5000), 2000)), false);
});

test("送信の最中に別の会話へ切り替えても、後片付けは送った会話の下書きに対して行う", () => {
  const store = createDraftStore<string>();
  // A で書いて送信(要求が返る前)→ B へ切り替え: A の下書き(送った文)が控えられ、B は空。
  const atB = store.switch("A", { text: "送った文", attachments: ["img"] }, "B");
  assert.deepEqual(atB, { text: "", attachments: [] });
  // B で別の下書きを書く。送信が成功して返る: 送った会話(A)の分だけ捨てる。
  store.clear("A");
  // B の下書きは、そのまま。A へ戻ると、空(送った文は残っていない)。
  assert.deepEqual(store.switch("B", { text: "Bの下書き", attachments: [] }, "A"), { text: "", attachments: [] });
  assert.deepEqual(store.switch("A", { text: "", attachments: [] }, "B"), { text: "Bの下書き", attachments: [] });
});

test("409 の種類: 待てば実行中になるものだけ待ち、上限などはすぐ出す", () => {
  const e = (message: string) => ({ code: "session_busy", message });
  assert.equal(busyKind(e("この会話は起動している最中です")), "starting");
  assert.equal(busyKind(e("この会話はすでに実行中です(PID 1)。二重には開けません")), "running");
  assert.equal(busyKind(e("同時に実行できるセッションは 24 個までです。使っていないものを終了してください")), "limit");
  assert.equal(busyKind(e("そのほか")), "other");
  assert.equal(busyKind({ code: "cwd_missing", message: "x" }), null);
  assert.equal(shouldWaitForRunning(e("この会話は起動している最中です")), true);
  assert.equal(shouldWaitForRunning(e("この会話はすでに実行中です(PID 1)")), true);
  assert.equal(shouldWaitForRunning(e("同時に実行できるセッションは 24 個までです")), false);
  assert.equal(shouldWaitForRunning(new Error("x")), false);
});

test("/settings: 保存したあとも自動では移さない。表示中のプロファイルが削除されたとき、入力が残っていれば確かめなしに消さない", () => {
  const base = { followsActive: true, shownId: "p1", activeId: "p2", dirty: false, touched: false, force: false, shownStillExists: true };
  // 何も操作していない: 移してよい。
  assert.equal(holdReason(base), null);
  // 保存した(入力は無いが、操作した): 移さない。
  assert.equal(holdReason({ ...base, touched: true }), "active-changed");
  // 利用者が選んだら、移る。
  assert.equal(holdReason({ ...base, touched: true, force: true }), null);
  // 表示中のプロファイルが削除された: 入力が残っていれば移さず(知らせる)、無ければ移す。
  assert.equal(holdReason({ ...base, shownStillExists: false, dirty: true }), "deleted");
  assert.equal(holdReason({ ...base, shownStillExists: false, dirty: false }), null);
});
