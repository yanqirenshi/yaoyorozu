/**
 * command とイベントの突き合わせ(Tauri 版 → Rust サーバ → フロントの api 層)。目視にしない。
 *
 *   node scripts/diff-commands.ts            # 表を標準出力へ(Markdown)
 *   node scripts/diff-commands.ts --check    # 「まだ」が残っていれば終了コード 1
 *
 * 取り出すもの:
 * - Tauri: `apps/native/tauri/src/lib.rs` の `generate_handler![...]`(command)と、`emit(` で発行するイベント名。
 * - サーバ: `apps/native/server/src/rpc/mod.rs` の `.route("/rpc/<名前>", ...)`、`events.emit("<名前>", ...)`。
 * - フロント: `apps/console/src/api/index.ts` の `invoke<...>("<名前>"` と `listen<...>("<名前>"`。
 *
 * 判定:
 * - 作らない: #620 で決めた(複数ウィンドウ 4 つ + イベント 2 つ)+ `ensure_web_app_running`(「仕様」ボタン)。
 * - 実装済み: サーバに有る。
 * - まだ: サーバに無い(後の段階)。
 * Node は 24 以上を前提とし、TypeScript のまま実行する。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

// --- 作らないもの(#620 の決定) ---
const NOT_BUILT_COMMANDS = new Set([
  "open_profile_window",
  "focus_window",
  "report_window_state",
  "list_window_states",
  "ensure_web_app_running", // 「仕様」ボタン
]);
const NOT_BUILT_EVENTS = new Set(["windows:changed", "viewer:navigate"]);
// イベントではなく Query で置き換えたもの(起動直後は誰も購読していないため、取りこぼす)。
const REPLACED_EVENTS = new Map([["settings:corrupted", "list_pending_warnings"]]);

// --- Tauri ---
const tauriLib = read("apps", "native", "tauri", "src", "lib.rs");
const handlerBlock = /generate_handler!\[([\s\S]*?)\]/.exec(tauriLib)?.[1] ?? "";
const tauriCommands = handlerBlock
  .split(",")
  .map((s) => s.trim().replace(/^.*::/, ""))
  .filter(Boolean);

// 定数で渡されるイベント名(`pub const X_EVENT: &str = "..."`)を解決する。
const tauriSources = ["lib.rs", "running_session.rs", "session_scan_queue.rs", "local_api.rs", "web_dev_server.rs"]
  .map((f) => read("apps", "native", "tauri", "src", f))
  .join("\n");
const consts = new Map<string, string>();
for (const m of tauriSources.matchAll(/const (\w+): &str = "([^"]+)"/g)) consts.set(m[1], m[2]);
const tauriEvents = new Set<string>();
for (const m of tauriSources.matchAll(/\.emit\(\s*(?:"([^"]+)"|(\w+))/g)) {
  const name = m[1] ?? consts.get(m[2]);
  if (name) tauriEvents.add(name);
}
// `ViewerNavigate` のようにフロントだけが使うイベントも、api 層の listen から拾う(下)。
const nativeApi = read("apps", "native", "react", "src", "api", "index.ts");
for (const m of nativeApi.matchAll(/listen[<(][^"]*"([^"]+)"/g)) tauriEvents.add(m[1]);

// --- サーバ ---
const rpcMod = read("apps", "native", "server", "src", "rpc", "mod.rs");
const serverCommands = new Set(
  [...rpcMod.matchAll(/"\/rpc\/([a-z_]+)"/g)].map((m) => m[1]).filter((n) => n !== "command"),
);
const serverSrc = ["lib.rs", "main.rs", "watcher.rs", "running.rs", join("rpc", "settings.rs"), join("rpc", "viewer.rs"), join("rpc", "claude.rs"), join("rpc", "running.rs")]
  .map((f) => {
    try {
      return read("apps", "native", "server", "src", f);
    } catch {
      return "";
    }
  })
  .join("\n");
// 定数で渡されるイベント名(`pub const X_EVENT: &str = "..."`)も解決する。SSE にだけ流すもの
// (`Event::default().event(...)`。途中経過と接続の ID)も拾う。
const serverConsts = new Map<string, string>();
for (const m of serverSrc.matchAll(/const (\w+): &str = "([^"]+)"/g)) serverConsts.set(m[1], m[2]);
const serverEvents = new Set<string>();
for (const m of serverSrc.matchAll(/\.(?:emit|event)\(\s*(?:"([^"]+)"|(?:\w+::)*([A-Z][A-Z_]+))/g)) {
  const name = m[1] ?? serverConsts.get(m[2]);
  if (name) serverEvents.add(name);
}

// --- フロント ---
const consoleApi = read("apps", "console", "src", "api", "index.ts");
const consoleCommands = new Set(
  [...consoleApi.matchAll(/invoke<[^>]*>\(\s*"([a-z_]+)"/g)].map((m) => m[1]),
);
const consoleEvents = new Set(
  [...consoleApi.matchAll(/listen<[^>]*>\(\s*"([^"]+)"/g)].map((m) => m[1]),
);

function status(name: string, built: Set<string>, notBuilt: Set<string>) {
  if (notBuilt.has(name)) return "作らない";
  return built.has(name) ? "実装済み" : "まだ";
}
// Tauri 版との、引数・動きの違い(command 名の突き合わせでは見えないもの)。
const DIFFERENCES: [string, string][] = [
  ["update_settings", "`profileId` は必須(省略・null は 400。アクティブへは保存しない。削除済みなら 404)。`expectedRevision`(保存先のプロファイルの版)と `expectedGlobalRevision`(全体の欄の版)も必須(どちらかが古ければ 409)。版はプロファイルごと(`get_settings` は `revision` と `global_revision` を返す)"],
];

const mark = (b: boolean) => (b ? "○" : "―");

let missing = 0;
const lines: string[] = [];

lines.push(`### command(Tauri ${tauriCommands.length} 個)`, "");
lines.push("| command | 状態 | サーバ `/rpc` | フロント api |", "|---|---|---|---|");
for (const name of tauriCommands) {
  const st = status(name, serverCommands, NOT_BUILT_COMMANDS);
  if (st === "まだ") missing++;
  lines.push(`| ${name} | ${st} | ${mark(serverCommands.has(name))} | ${mark(consoleCommands.has(name))} |`);
}
const extraCommands = [...serverCommands].filter((c) => !tauriCommands.includes(c));
lines.push("", `この構成だけの command(Tauri 版には無い): ${extraCommands.length ? extraCommands.join("、") : "なし"}`);
const apiNotInServer = [...consoleCommands].filter((c) => !serverCommands.has(c));
const serverNotInApi = [...serverCommands].filter((c) => !consoleCommands.has(c));
lines.push(`フロント api にあるがサーバに無い command: ${apiNotInServer.length ? apiNotInServer.join("、") : "なし"}`);
lines.push(`サーバにあるがフロント api に無い command: ${serverNotInApi.length ? serverNotInApi.join("、") : "なし"}`);

lines.push("", "Tauri 版との違い:");
for (const [name, text] of DIFFERENCES) lines.push(`- ${name}: ${text}`);

const eventList = [...tauriEvents].sort();
lines.push("", `### イベント(Tauri ${eventList.length} 種)`, "");
lines.push("| イベント | 状態 | サーバが発行 | フロントが購読 |", "|---|---|---|---|");
for (const name of eventList) {
  const replaced = REPLACED_EVENTS.get(name);
  const st = replaced ? `代替(${replaced})` : status(name, serverEvents, NOT_BUILT_EVENTS);
  if (st === "まだ") missing++;
  lines.push(`| ${name} | ${st} | ${mark(serverEvents.has(name))} | ${mark(consoleEvents.has(name))} |`);
}
const extraEvents = [...serverEvents].filter((e) => !tauriEvents.has(e));
lines.push("", `この構成だけのイベント: ${extraEvents.length ? extraEvents.join("、") : "なし"}`);

const count = (names: string[], s: string) => names.filter((n) => status(n, serverCommands, NOT_BUILT_COMMANDS) === s).length;
const ecount = (s: string) =>
  eventList.filter((n) => !REPLACED_EVENTS.has(n) && status(n, serverEvents, NOT_BUILT_EVENTS) === s).length;
lines.push(
  "",
  `集計: command は 実装済み ${count(tauriCommands, "実装済み")} / まだ ${count(tauriCommands, "まだ")} / 作らない ${count(tauriCommands, "作らない")}。` +
    `イベントは 実装済み ${ecount("実装済み")} / 代替 ${REPLACED_EVENTS.size} / まだ ${ecount("まだ")} / 作らない ${ecount("作らない")}。`,
);

console.log(lines.join("\n"));
if (process.argv.includes("--check") && missing > 0) process.exit(1);
