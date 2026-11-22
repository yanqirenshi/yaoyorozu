// 画面の小さな判断(純粋なもの)のテスト: とても大きい発言・会話ごとの下書き・起動エラーを出すか・アクティブへ追従する画面。

import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftStore } from "../src/draftStore.ts";
import { shouldHoldDisplay } from "../src/followActive.ts";
import { LARGE_TEXT_CHARS, PREVIEW_CHARS, viewOfText } from "../src/largeText.ts";
import { shouldShowStartError } from "../src/startError.ts";

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
  const base = { followsActive: true, shownId: "p1", activeId: "p2", dirty: true, force: false, shownStillExists: true };
  assert.equal(shouldHoldDisplay(base), true);
  // 入力が無いときは、移してよい。
  assert.equal(shouldHoldDisplay({ ...base, dirty: false }), false);
  // 利用者が選んだ(force)ときは、移す。
  assert.equal(shouldHoldDisplay({ ...base, force: true }), false);
  // アクティブが同じ・まだ何も読んでいない・プロファイルを指定した画面・表示中のものが削除された、は移す(止めない)。
  assert.equal(shouldHoldDisplay({ ...base, activeId: "p1" }), false);
  assert.equal(shouldHoldDisplay({ ...base, shownId: null }), false);
  assert.equal(shouldHoldDisplay({ ...base, followsActive: false }), false);
  assert.equal(shouldHoldDisplay({ ...base, shownStillExists: false }), false);
});
