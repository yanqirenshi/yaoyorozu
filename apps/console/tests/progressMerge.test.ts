// 途中経過と取り直しの合わせ方(`src/progressMerge.ts`)のテスト。重なり・抜け・順番の前後・「ここまで」より先に届いた分。

import assert from "node:assert/strict";
import { test } from "node:test";
import { createProgressMerger } from "../src/progressMerge.ts";

const items = (merged: { item: string }[]) => merged.map((m) => m.item);

test("「ここまで」以下の断片は捨て、続きだけを渡す", () => {
  const m = createProgressMerger<string>();
  m.begin();
  assert.deepEqual(m.setFloor(950), []);
  assert.deepEqual(items(m.push(949, "949")), []);
  assert.deepEqual(items(m.push(950, "950")), []);
  assert.deepEqual(items(m.push(951, "951")), ["951"]);
  assert.deepEqual(items(m.push(952, "952")), ["952"]);
});

test("重なり(同じ番号・前の番号が遅れて届く)は渡さない。順番は崩れない", () => {
  const m = createProgressMerger<string>();
  m.begin();
  m.setFloor(0);
  assert.deepEqual(items(m.push(1, "a")), ["a"]);
  assert.deepEqual(items(m.push(2, "b")), ["b"]);
  assert.deepEqual(items(m.push(2, "b'")), []);
  assert.deepEqual(items(m.push(1, "a'")), []);
  assert.deepEqual(items(m.push(3, "c")), ["c"]);
});

test("抜けは、届いたものをそのまま渡し、抜けた数を返す", () => {
  const m = createProgressMerger<string>();
  m.begin();
  m.setFloor(10);
  assert.deepEqual(m.push(11, "k"), [{ item: "k", seq: 11, missed: 0 }]);
  assert.deepEqual(m.push(15, "o"), [{ item: "o", seq: 15, missed: 3 }]);
});

test("「ここまで」が分かる前に届いた分は、ためて、続きだけを番号の順に渡す", () => {
  const m = createProgressMerger<string>();
  m.begin();
  assert.deepEqual(items(m.push(12, "12")), []);
  assert.deepEqual(items(m.push(10, "10")), []);
  assert.deepEqual(items(m.push(11, "11")), []);
  assert.deepEqual(items(m.push(13, "13")), []);
  // 取り直しは 11 まで反映済み: 10・11 は捨て、12・13 を順に渡す。
  assert.deepEqual(items(m.setFloor(11)), ["12", "13"]);
  assert.deepEqual(items(m.push(14, "14")), ["14"]);
});

test("「ここまで」は、begin のあとの最初の 1 回だけ使う(返答の最中の取り直しで、これから届く断片を捨てない)", () => {
  const m = createProgressMerger<string>();
  m.begin();
  m.setFloor(5);
  assert.deepEqual(items(m.push(6, "6")), ["6"]);
  // 状態の変化による 2 回目以降の取り直し(番号 9)は、floor を動かさない。
  assert.deepEqual(m.setFloor(9), []);
  assert.deepEqual(items(m.push(7, "7")), ["7"]); // 床は 5 のまま(9 には動かない)
});

test("進行中のターンのここまでの分(replay)は、「ここまで」を決めるとき先頭に渡し、続きは重ならずにつながる", () => {
  const m = createProgressMerger<string>();
  m.begin();
  assert.equal(m.awaitingFloor(), true);
  // 「ここまで」が分かる前に届いた断片(うち 1 つは replay と重なる)。
  m.push(43, "43");
  m.push(41, "41"); // 重なり
  const merged = m.setFloor(42, [
    { seq: 42, item: "42" },
    { seq: 40, item: "40" },
    { seq: 41, item: "41" },
    { seq: 99, item: "99" }, // 「ここまで」より後のものは、replay からは渡さない
  ]);
  // replay は番号の順で先頭、そのあと、ためてあった「ここまで」より後の分(43)。重なり(41)は 1 回だけ。
  assert.deepEqual(items(merged), ["40", "41", "42", "43"]);
  assert.equal(m.awaitingFloor(), false);
  assert.deepEqual(items(m.push(44, "44")), ["44"]);
  assert.deepEqual(items(m.push(43, "43")), [], "渡した番号以下は渡さない");
});

test("replay の先頭が欠けていても(古いほうが捨てられた)、あるものを渡す", () => {
  const m = createProgressMerger<string>();
  m.begin();
  const merged = m.setFloor(300, [
    { seq: 271, item: "271" },
    { seq: 272, item: "272" },
  ]);
  assert.deepEqual(items(merged), ["271", "272"]);
  assert.deepEqual(items(m.push(301, "301")), ["301"]);
});
