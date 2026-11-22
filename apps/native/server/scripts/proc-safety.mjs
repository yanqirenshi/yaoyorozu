// 確認スクリプトが、**自分が起動したプロセスだけ**を止めるための共通部分(1 か所)。
//
// なぜ: 終わったプロセスの PID は、数秒で別のプロセスに再利用される。PID だけで「生きている」「自分のもの」と
// 決めて止めると、起動していないプロセス(ほかのセッションの claude・app など)を止めるおそれがある。親の PID も
// 再利用されるので、親 PID だけで子孫をたどらない。
//
// 決まり:
// - 自分が起動した(または、起動した直後に PID を知った)プロセスは、**PID と開始時刻の組**を、すぐ控える(`recordIdentity`)。
// - 止める前に、いまの開始時刻が控えと一致することを確かめる。**一致しない・控えが無いものは止めない**(ログに出すだけ)。
// - 子孫は、控えのあるプロセスから、**親の開始時刻より前に始まったものは子とみなさない**(PID の再利用で、無関係な
//   プロセスの親 PID が一致しても、たどらない)形でたどる。止めるのも、確かめたものを 1 つずつ(`/T` の一括は使わない)。
// - 生死の判定(`alive`)も、控えのあるものは開始時刻まで見る(PID が別のプロセスに再利用されていたら「死んだ」)。

import { execFileSync } from "node:child_process";

/** pid → 控えた開始時刻(CreationDate の Ticks の文字列)。 */
const identities = new Map();

const LIST_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId),$($_.CreationDate.Ticks),$($_.Name)\" }";

/** いまの全プロセスの表(pid → {ppid, created, name})。 */
export function processTable() {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", LIST_SCRIPT], { encoding: "utf8" });
  const table = new Map();
  for (const line of out.split(/\r?\n/)) {
    const [pid, ppid, created, ...name] = line.split(",");
    if (!pid || !Number(pid)) continue;
    table.set(Number(pid), { ppid: Number(ppid), created: String(created ?? ""), name: name.join(",").trim().toLowerCase() });
  }
  return table;
}

/** その PID のいまのプロセスの開始時刻。無ければ `null`。 */
export function currentStart(pid, table = null) {
  const row = (table ?? processTable()).get(pid);
  return row ? row.created : null;
}

/** 起動した(または、起動した直後に PID を知った)プロセスの、PID と開始時刻の組を控える。生きていなければ `false`。 */
export function recordIdentity(pid, table = null) {
  const start = currentStart(pid, table);
  if (start === null) return false;
  identities.set(pid, start);
  return true;
}

/** 控えを、指定の開始時刻で直接入れる(テスト用)。 */
export function setIdentityForTest(pid, start) {
  identities.set(pid, start);
}

export function hasIdentity(pid) {
  return identities.has(pid);
}

/** 控えた開始時刻と、いまの開始時刻が一致するか(控えが無ければ `false`)。 */
export function isMine(pid, table = null) {
  const recorded = identities.get(pid);
  return recorded !== undefined && currentStart(pid, table) === recorded;
}

/**
 * 生きているか。控えのあるものは、開始時刻まで見る(PID が別のプロセスに再利用されていたら、死んだ扱い)。
 * 控えの無いものは、PID が存在するかだけ(止める判断には使わない)。
 */
export function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!identities.has(pid)) return true;
  return isMine(pid);
}

/**
 * `root`(控えのあるプロセス)の子孫を、確かめながら集める。親の開始時刻より前に始まったものは、
 * 親 PID が一致しても子とみなさない。`root` 自身が控えと違う(別のプロセスに再利用された)ときは、空。
 * 戻り値は `{pid, created}` の配列(親に近い順)。コンソールのホスト(conhost.exe)は入れない。
 */
export function verifiedDescendants(root, table = processTable()) {
  if (!isMine(root, table)) return [];
  const found = [];
  const walk = (parent, parentCreated) => {
    for (const [pid, row] of table) {
      if (row.ppid !== parent || pid === parent) continue;
      if (BigInt(row.created || "0") < BigInt(parentCreated || "0")) continue; // 親より前に始まったものは、子ではない
      if (found.some((f) => f.pid === pid)) continue;
      if (row.name !== "conhost.exe") found.push({ pid, created: row.created });
      walk(pid, row.created);
    }
  };
  walk(root, table.get(root).created);
  return found;
}

/** 子孫の PID の一覧(確かめたもの)。 */
export function descendantsOf(root) {
  return verifiedDescendants(root).map((d) => d.pid);
}

/**
 * 控えのあるプロセス 1 つを止める。開始時刻が一致しなければ止めない(`false`。ログに出す)。`/T` は使わない。
 */
export function killIfMine(pid, { log = console.log } = {}) {
  if (!isMine(pid)) {
    if (alive(pid) || hasIdentity(pid)) {
      log(`  止めません: PID ${pid} は、自分が起動したものか確かめられません(開始時刻が違う・控えが無い)`);
    }
    return false;
  }
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * `root`(控えのあるプロセス)と、その確かめた子孫を、子孫から順に 1 つずつ止める(`/T` は使わない)。
 * 止めた PID の一覧を返す。
 */
export function killTreeIfMine(root, { log = console.log } = {}) {
  if (!isMine(root)) {
    if (alive(root) || hasIdentity(root)) {
      log(`  止めません: PID ${root} は、自分が起動したものか確かめられません(開始時刻が違う・控えが無い)`);
    }
    return [];
  }
  const table = processTable();
  const tree = verifiedDescendants(root, table);
  const killed = [];
  for (const { pid, created } of [...tree].reverse()) {
    // 止める直前に、同じ表の開始時刻と一致することを確かめる(表の取得から止めるまでの間に別のものになっていないか)。
    if (currentStart(pid) !== created) continue;
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "pipe" });
      killed.push(pid);
    } catch {
      // すでに終わっている。
    }
  }
  if (killIfMine(root, { log })) killed.push(root);
  return killed;
}
