// フロントから Rust サーバを呼ぶ唯一の入口。
// `apps/native/react/src/api/index.ts` と同じ関数名・引数・戻り値で、中身だけを
// `invoke`/`listen` から `fetch`/`EventSource` に替えている(呼び出し側を変えないため)。
// コンポーネントから `fetch` / `EventSource` を直接使わない(native.md §3.5 と同旨)。

import { listen } from "./events";
import type { AppErrorDto, PingEvent, ProjectDto, SettingsDto } from "./types";

export { onConnectionChange, onReconnected } from "./events";
export type { ConnectionState } from "./events";

export type {
  AppErrorDto,
  PingEvent,
  ProfileSummaryDto,
  ProjectDto,
  SettingsDto,
} from "./types";

/** `POST /api/rpc/<command>`。失敗は `AppErrorDto` を throw する(`isAppError` で見分ける)。 */
async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/rpc/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch {
    const error: AppErrorDto = {
      code: "server_unavailable",
      message: "サーバに接続できません。サーバを起動してください",
    };
    throw error;
  }
  if (!response.ok) {
    const error: AppErrorDto = await response
      .json()
      .then((body: unknown) => (isAppError(body) ? body : null))
      .catch(() => null)
      .then(
        (body) =>
          body ?? {
            code: "io",
            message: `サーバがエラーを返しました(${response.status})`,
          },
      );
    throw error;
  }
  return (await response.json()) as T;
}

// --- Query ---

export function listProjects(): Promise<ProjectDto[]> {
  return invoke<ProjectDto[]>("list_projects");
}

// `profileId` は対象プロファイル。`null`(または undefined)はアクティブ(既定)プロファイル。
export function getSettings(profileId?: string | null): Promise<SettingsDto> {
  return invoke<SettingsDto>("get_settings", { profileId: profileId ?? null });
}

// --- イベント購読 ---

// 配信の確認用(段階 1 のみ。サーバが一定間隔で送る)。
export function onPing(callback: (event: PingEvent) => void): Promise<() => void> {
  return listen<PingEvent>("ping", callback);
}

export function isAppError(error: unknown): error is AppErrorDto {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}
