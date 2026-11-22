// 中継の本文の上限(`src/server/bodyLimits.ts`)が、サーバ(Rust)の上限と同じであることを、Rust のソースを読んで確かめる。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bodyLimitFor, IMAGE_CHECK_BODY_LIMIT, SEND_BODY_LIMIT, DEFAULT_BODY_LIMIT } from "../src/server/bodyLimits.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const rust = fs.readFileSync(path.join(here, "..", "..", "native", "server", "src", "rpc", "mod.rs"), "utf8");

/** `pub const NAME: usize = <a> * 1024 * 1024;` の MB 数。 */
function rustMegabytes(name: string): number {
  const m = rust.match(new RegExp("pub const " + name + ": usize = (\\d+) \\* 1024 \\* 1024;"));
  assert.ok(m, `${name} が mod.rs に見つからない`);
  return Number(m[1]) * 1024 * 1024;
}

test("中継の上限は、サーバの上限と同じ(サーバが正)", () => {
  assert.equal(SEND_BODY_LIMIT, rustMegabytes("SEND_BODY_LIMIT"));
  assert.equal(IMAGE_CHECK_BODY_LIMIT, rustMegabytes("IMAGE_CHECK_BODY_LIMIT"));
  assert.equal(DEFAULT_BODY_LIMIT, 2 * 1024 * 1024); // axum の既定
});

test("command ごとの上限", () => {
  assert.equal(bodyLimitFor("rpc/check_image_attachment"), IMAGE_CHECK_BODY_LIMIT);
  assert.equal(bodyLimitFor("rpc/send_to_running_session"), SEND_BODY_LIMIT);
  assert.equal(bodyLimitFor("rpc/get_settings"), DEFAULT_BODY_LIMIT);
  // 画像 1 枚の上限(base64 で 5,000,000 文字)は、画像の事前の検証の上限の内側。
  assert.ok(5_000_000 < IMAGE_CHECK_BODY_LIMIT);
});
