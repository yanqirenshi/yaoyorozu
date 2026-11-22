// Rust サーバの場所とトークンを読む(Next のサーバ側だけ。ブラウザへは渡さない)。
// サーバのデータフォルダの決め方は `apps/native/server/src/config.rs` と同じ:
// 環境変数 YAOYOROZU_DATA_DIR、無ければ %APPDATA%\com.yaoyorozu.server。
// MSI 版(com.yaoyorozu.native)は読まない。

import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PORT = 14210;
const FORBIDDEN_DIR_NAME = "com.yaoyorozu.native";

function dataDir(): string | null {
  const fromEnv = process.env.YAOYOROZU_DATA_DIR?.trim();
  const dir = fromEnv
    ? fromEnv
    : process.env.APPDATA
      ? path.join(process.env.APPDATA, "com.yaoyorozu.server")
      : null;
  if (!dir) return null;
  const forbidden = dir
    .split(/[\\/]+/)
    .some((part) => part.toLowerCase() === FORBIDDEN_DIR_NAME);
  return forbidden ? null : dir;
}

async function readDataFile(name: string): Promise<string | null> {
  const dir = dataDir();
  if (!dir) return null;
  try {
    return (
      await readFile(/* turbopackIgnore: true */ path.join(dir, name), "utf-8")
    ).trim();
  } catch {
    // サーバが一度も起動していない(ファイルが無い)場合もここに来る。
    return null;
  }
}

export async function readServerToken(): Promise<string | null> {
  return readDataFile("server-token");
}

export async function readServerPort(): Promise<number> {
  const raw = await readDataFile("server-port");
  const port = raw ? Number(raw) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65536
    ? port
    : DEFAULT_PORT;
}
