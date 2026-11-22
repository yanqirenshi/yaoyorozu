// フロントから Rust サーバを呼ぶ唯一の入口。
// `apps/native/react/src/api/index.ts` と同じ関数名・引数・戻り値で、中身だけを
// `invoke`/`listen` から `fetch`/`EventSource` に替えている(呼び出し側を変えないため)。
// コンポーネントから `fetch` / `EventSource` を直接使わない(native.md §3.5 と同旨)。

import { listen, openProgressSubscription } from "./events";
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
  AddressedProgressDto,
  ClaudeUsageSnapshotDto,
  PermissionBehaviorDto,
  PermissionSuggestionDto,
  RunningSessionChangedEvent,
  RunningSessionDto,
  RunningSessionRefDto,
  RunningSessionSummaryDto,
  RunningSessionSwitchDto,
  StartRunningSessionDto,
  ClaudeDirPageDto,
  ClaudeMdDto,
  ClaudeSettingsDto,
  ConversationDto,
  MessageImageDto,
  ProjectSettingsFileDto,
  RuleDto,
  RuleSummaryDto,
  SessionChangedEvent,
  SessionSummaryDto,
  SkillDto,
  SkillSummaryDto,
  YyzScaffoldStatusDto,
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
  ClaudeDirEntryDto,
  ClaudeDirEntryKindDto,
  ClaudeDirPageDto,
  ClaudeMdDto,
  ClaudeSettingsDto,
  ConversationDto,
  MessageDto,
  MessageImageDto,
  MessageKindDto,
  MessageStatusDto,
  ProjectSettingsFileDto,
  RoleDto,
  RuleDto,
  RuleSummaryDto,
  SessionChangedEvent,
  SessionSummaryDto,
  SkillDto,
  SkillSummaryDto,
  YyzScaffoldFileStatusDto,
  YyzScaffoldStatusDto,
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
    if (response.status === 413) {
      // 本文が、その command の上限を超えた(サーバの本文の上限。JSON の本文は無い)。
      const tooLarge: AppErrorDto = {
        code: "payload_too_large",
        message: "送ろうとしたデータが大きすぎます",
      };
      throw tooLarge;
    }
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

// native の `updateSettings(input, profileId)` との違い: `profileId` は必須(省略・null は 400。アクティブへは保存しない。
// 対象が削除されていれば 404)。`expectedRevision`(保存先のプロファイルの版。`getSettings` の `revision`)と
// `expectedGlobalRevision`(全体の欄の版。`global_revision`)が必須で、どちらかが古ければ `settings_conflict`(409)で
// 断られる(別のタブが変えた別の欄を、古い値で黙って戻さないため)。戻り値は保存後の 2 つの版(次の保存に使える)。
export function updateSettings(
  input: SettingsInputDto,
  profileId: string,
  expectedRevision: number,
  expectedGlobalRevision: number,
): Promise<{ revision: number; global_revision: number }> {
  return invoke<{ revision: number; global_revision: number }>("update_settings", {
    input,
    profileId,
    expectedRevision,
    expectedGlobalRevision,
  });
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

// --- ~/.claude(/claude 画面。対象パスはサーバ側で固定解決し、パスは受け取らない) ---

export function getUserClaudeMd(): Promise<ClaudeMdDto> {
  return invoke<ClaudeMdDto>("get_user_claude_md");
}

export function saveUserClaudeMd(
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_user_claude_md", { content, expectedModifiedAtMs });
}

export function getClaudeSettingsFile(): Promise<ClaudeSettingsDto> {
  return invoke<ClaudeSettingsDto>("get_claude_settings_file");
}

export function saveClaudeSettingsFile(
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_claude_settings_file", { content, expectedModifiedAtMs });
}

// `~/.claude` 配下の `path`(`~/.claude` からの相対パス。区切りは `/`、ルートは空文字列)直下を一覧する。
export function listClaudeDir(
  path: string,
  offset: number,
  limit: number,
): Promise<ClaudeDirPageDto> {
  return invoke<ClaudeDirPageDto>("list_claude_dir", { path, offset, limit });
}


// --- 段階 2 C: ビューア(閲覧と編集) ---

export function getSession(
  project: string,
  sessionId: string,
  offset: number,
  limit: number,
): Promise<ConversationDto> {
  return invoke<ConversationDto>("get_session", { project, sessionId, offset, limit });
}

// メッセージの元の jsonl 行(生のテキスト)。オンデマンドで取る(issue #313)。
export function getSessionLineRaw(
  project: string,
  sessionId: string,
  uuid: string,
): Promise<string> {
  return invoke<string>("get_session_line_raw", { project, sessionId, uuid });
}

export function listSessions(project: string): Promise<SessionSummaryDto[]> {
  return invoke<SessionSummaryDto[]>("list_sessions", { project });
}

// 画像を 1 枚添付する前の事前検証(issue #349)。違反なら理由つきの AppErrorDto で reject される。
export function checkImageAttachment(data: string, existingCount: number): Promise<void> {
  return invoke<void>("check_image_attachment", { data, existingCount });
}

// メッセージ(uuid)に含まれる画像をオンデマンドで取る(「画像 n 枚」。issue #349)。
export function getSessionLineImages(
  project: string,
  sessionId: string,
  uuid: string,
): Promise<MessageImageDto[]> {
  return invoke<MessageImageDto[]>("get_session_line_images", { project, sessionId, uuid });
}

// yyz/ の状態を確かめる(副作用なし。issue #547)。repository_path が未設定ならエラー。
export function getYyzScaffoldStatus(
  profileId?: string | null,
): Promise<YyzScaffoldStatusDto> {
  return invoke<YyzScaffoldStatusDto>("get_yyz_scaffold_status", {
    profileId: profileId ?? null,
  });
}

// yyz/ のうち足りないものだけ作る(既存のファイルは絶対に上書きしない)。
export function createYyzScaffold(
  profileId?: string | null,
): Promise<YyzScaffoldStatusDto> {
  return invoke<YyzScaffoldStatusDto>("create_yyz_scaffold", {
    profileId: profileId ?? null,
  });
}

// ビューアの CLAUDE.md / Rules / Skills / settings 系は、対象リポジトリを backend が
// プロファイルの `repository_path` から解決する(パスは渡さない。issue #269)。
export function getProjectClaudeMd(profileId: string | null): Promise<ClaudeMdDto> {
  return invoke<ClaudeMdDto>("get_project_claude_md", { profileId });
}

export function saveProjectClaudeMd(
  profileId: string | null,
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_project_claude_md", {
    profileId,
    content,
    expectedModifiedAtMs,
  });
}

export function listRules(profileId: string | null): Promise<RuleSummaryDto[]> {
  return invoke<RuleSummaryDto[]>("list_rules", { profileId });
}

export function getRule(profileId: string | null, fileName: string): Promise<RuleDto> {
  return invoke<RuleDto>("get_rule", { profileId, fileName });
}

export function listSkills(profileId: string | null): Promise<SkillSummaryDto[]> {
  return invoke<SkillSummaryDto[]>("list_skills", { profileId });
}

export function getSkill(profileId: string | null, name: string): Promise<SkillDto> {
  return invoke<SkillDto>("get_skill", { profileId, name });
}

export function getProjectSettingsFile(
  profileId: string | null,
  which: ProjectSettingsFileDto,
): Promise<ClaudeSettingsDto> {
  return invoke<ClaudeSettingsDto>("get_project_settings_file", { profileId, which });
}

export function saveProjectSettingsFile(
  profileId: string | null,
  which: ProjectSettingsFileDto,
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_project_settings_file", {
    profileId,
    which,
    content,
    expectedModifiedAtMs,
  });
}

// 会話ファイルが増えた・変わったことの通知(session:changed)。データ本体は Query で取り直す。
export function onSessionChanged(
  callback: (event: SessionChangedEvent) => void,
): Promise<() => void> {
  return listen<SessionChangedEvent>("session:changed", callback);
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

// ---- 実行中セッション(段階 3。native の api と同じ関数名・引数・戻り値) ----
// 対象は `RunningSessionRefDto`(pid_domain + pid + started_at)で指す。パスは渡さない(サーバが会話ファイル・
// プロファイルから解決する)。`profileId` は**必ず**画面が開いているプロファイルの ID を渡す(省略に頼らない)。

export type {
  AvailableModelDto,
  RunningSessionSummaryDto,
  ProcessStateDto,
  ProgressEventDto,
  RunningPermissionModeDto,
  StartModelDto,
  WorktreeSpecDto,
} from "./types";

export function startRunningSession(
  profileId: string,
  request: StartRunningSessionDto,
): Promise<RunningSessionDto> {
  return invoke<RunningSessionDto>("start_running_session", { profileId, request });
}

export function listRunningSessions(): Promise<RunningSessionSummaryDto[]> {
  return invoke<RunningSessionSummaryDto[]>("list_running_sessions");
}

export function getRunningSession(target: RunningSessionRefDto): Promise<RunningSessionDto | null> {
  return invoke<RunningSessionDto | null>("get_running_session", { target });
}

export function getClaudeUsage(): Promise<ClaudeUsageSnapshotDto> {
  return invoke<ClaudeUsageSnapshotDto>("get_claude_usage");
}

// 途中経過を、この画面(タブの接続)へ流し始める。返る関数で購読をやめる。接続が切れたら、つなぎ直したときに
// 購読し直す(接続の持ち方は `events.ts` の中に閉じている)。同期で返る(購読の確立は裏で行う)。
export function subscribeRunningSessionProgress(
  target: RunningSessionRefDto,
  onProgress: (progress: AddressedProgressDto, seq: number) => void,
): Promise<() => void> {
  const stop = openProgressSubscription(
    (connectionId) =>
      invoke<number>("subscribe_running_session_progress", { target, connectionId }),
    (subscriptionId, connectionId) =>
      invoke<void>("unsubscribe_running_session_progress", { subscriptionId, connectionId }),
    (progress, seq) => onProgress(progress as AddressedProgressDto, seq),
  );
  return Promise.resolve(stop);
}

export function sendToRunningSession(
  target: RunningSessionRefDto,
  text: string,
  images: string[],
): Promise<void> {
  return invoke<void>("send_to_running_session", { target, text, images });
}

export function respondPermission(
  target: RunningSessionRefDto,
  requestId: string,
  behavior: PermissionBehaviorDto,
  options: {
    updatedInput?: unknown;
    updatedPermissions?: PermissionSuggestionDto[];
    message?: string;
  } = {},
): Promise<void> {
  return invoke<void>("respond_permission", {
    target,
    requestId,
    behavior,
    updatedInput: options.updatedInput ?? null,
    updatedPermissions: options.updatedPermissions ?? null,
    message: options.message ?? null,
  });
}

export function interruptRunningSession(target: RunningSessionRefDto): Promise<void> {
  return invoke<void>("interrupt_running_session", { target });
}

export function switchRunningSession(
  target: RunningSessionRefDto,
  switchTo: RunningSessionSwitchDto,
): Promise<void> {
  return invoke<void>("switch_running_session", { target, switch: switchTo });
}

export function stopRunningSession(target: RunningSessionRefDto): Promise<void> {
  return invoke<void>("stop_running_session", { target });
}

export function archiveSession(project: string, sessionId: string): Promise<void> {
  return invoke<void>("archive_session", { project, sessionId });
}

export function unarchiveSession(project: string, sessionId: string): Promise<void> {
  return invoke<void>("unarchive_session", { project, sessionId });
}

export function renameSession(project: string, sessionId: string, title: string): Promise<void> {
  return invoke<void>("rename_session", { project, sessionId, title });
}

export function onRunningSessionChanged(
  callback: (event: RunningSessionChangedEvent) => void,
): Promise<() => void> {
  return listen<RunningSessionChangedEvent>("running-session:changed", callback);
}

export function onClaudeUsageUpdated(
  callback: (event: ClaudeUsageSnapshotDto) => void,
): Promise<() => void> {
  return listen<ClaudeUsageSnapshotDto>("claude-usage:updated", callback);
}
