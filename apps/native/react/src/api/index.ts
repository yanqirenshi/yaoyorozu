import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentModeDto,
  AppErrorDto,
  AppWarningEvent,
  ProjectDto,
  SessionChangedEvent,
  SessionDto,
  SessionSummaryDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
} from "./types";

export type {
  AgentKindDto,
  AgentModeDto,
  AppErrorDto,
  AppWarningEvent,
  GithubProjectDto,
  MessageDto,
  ProjectDto,
  RoleDto,
  SessionChangedEvent,
  SessionDto,
  SessionSummaryDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
} from "./types";

export function listProjects(): Promise<ProjectDto[]> {
  return invoke<ProjectDto[]>("list_projects");
}

export function getLatestSession(
  project: string,
  offset: number,
  limit: number,
): Promise<SessionDto> {
  return invoke<SessionDto>("get_latest_session", { project, offset, limit });
}

export function sendMessage(
  project: string,
  sessionId: string,
  text: string,
  mode: AgentModeDto,
): Promise<void> {
  return invoke<void>("send_message", { project, sessionId, text, mode });
}

export function onSessionChanged(
  callback: (event: SessionChangedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<SessionChangedEvent>("session:changed", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

export function onAppWarning(
  callback: (event: AppWarningEvent) => void,
): Promise<() => void> {
  const unlisten = listen<AppWarningEvent>("app:warning", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

export function getProjectName(path: string): Promise<string> {
  return invoke<string>("get_project_name", { path });
}

export function listSessions(project: string): Promise<SessionSummaryDto[]> {
  return invoke<SessionSummaryDto[]>("list_sessions", { project });
}

export function getSettings(): Promise<SettingsDto> {
  return invoke<SettingsDto>("get_settings");
}

export function updateSettings(input: SettingsInputDto): Promise<void> {
  return invoke<void>("update_settings", { input });
}

export function onSettingsCorrupted(
  callback: (event: SettingsCorruptedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<SettingsCorruptedEvent>("settings:corrupted", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

export function isAppError(error: unknown): error is AppErrorDto {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}
