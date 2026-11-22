// フロントから Rust サーバを呼ぶ唯一の入口。
// `apps/native/react/src/api/index.ts` と同じ関数名・引数・戻り値で、中身だけを
// `invoke`/`listen` から `fetch`/`EventSource` に替えている(呼び出し側を変えないため)。
// コンポーネントから `fetch` / `EventSource` を直接使わない(native.md §3.5 と同旨)。

import { listen } from "./events";
import type {
  AppErrorDto,
  AppWarningEvent,
  FolderCheckDto,
  PendingWarningDto,
  PingEvent,
  ProfileSummaryDto,
  ProjectDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
} from "./types";

export { onConnectionChange, onReconnected } from "./events";
export type { ConnectionState } from "./events";

export type {
  AppErrorDto,
  AppWarningEvent,
  FolderCheckDto,
  GithubProjectDto,
  PendingWarningDto,
  PingEvent,
  ProfileSummaryDto,
  ProjectDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
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

// --- Command(設定。native の api/index.ts と同じ関数名・引数・戻り値) ---

export function updateSettings(
  input: SettingsInputDto,
  profileId?: string | null,
): Promise<void> {
  return invoke<void>("update_settings", { input, profileId: profileId ?? null });
}

export function switchProfile(profileId: string): Promise<void> {
  return invoke<void>("switch_profile", { profileId });
}

export function createProfile(name?: string | null): Promise<ProfileSummaryDto> {
  return invoke<ProfileSummaryDto>("create_profile", { name: name ?? null });
}

export function deleteProfile(profileId: string): Promise<void> {
  return invoke<void>("delete_profile", { profileId });
}

export function renameProfile(profileId: string, name: string): Promise<void> {
  return invoke<void>("rename_profile", { profileId, name });
}

// --- この構成だけの Query(Tauri 版には無い) ---

// 起動直後に出て、画面が取りこぼした警告の控え。画面を開いたときと、つなぎ直したときに取る。
export function listPendingWarnings(): Promise<PendingWarningDto[]> {
  return invoke<PendingWarningDto[]>("list_pending_warnings");
}

export function dismissPendingWarning(id: number): Promise<void> {
  return invoke<void>("dismiss_pending_warning", { id });
}

// パスの手入力の確認(存在するか・フォルダか・リポジトリか)。
export function checkFolder(path: string): Promise<FolderCheckDto> {
  return invoke<FolderCheckDto>("check_folder", { path });
}

// --- イベント購読 ---

// 設定(アクティブプロファイルの内容含む)が変わったことの通知(settings:updated)。
export function onSettingsUpdated(callback: () => void): Promise<() => void> {
  return listen<null>("settings:updated", () => callback());
}

// app:warning(処理は続くが利用者に伝えたいこと)。
export function onAppWarning(
  callback: (event: AppWarningEvent) => void,
): Promise<() => void> {
  return listen<AppWarningEvent>("app:warning", callback);
}

// settings:corrupted(設定ファイルの破損から復旧した)。起動直後に出て取りこぼしやすいので、
// 画面は listPendingWarnings でも取る。
export function onSettingsCorrupted(
  callback: (event: SettingsCorruptedEvent) => void,
): Promise<() => void> {
  return listen<SettingsCorruptedEvent>("settings:corrupted", callback);
}


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
