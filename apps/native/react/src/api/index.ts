import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentModeDto,
  AppErrorDto,
  AppWarningEvent,
  ClaudeMdDto,
  DeviceCodeDto,
  GithubAuthFailedEvent,
  GithubAuthStatusDto,
  GithubAuthenticatedEvent,
  GithubProjectSummaryDto,
  ProjectDto,
  SessionChangedEvent,
  SessionDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
} from "./types";

export type {
  AgentKindDto,
  AgentModeDto,
  AppErrorDto,
  AppWarningEvent,
  ClaudeMdDto,
  DeviceCodeDto,
  GithubAuthFailedEvent,
  GithubAuthStatusDto,
  GithubAuthenticatedEvent,
  GithubProjectDto,
  GithubProjectSummaryDto,
  MessageDto,
  ProjectDto,
  RoleDto,
  SessionChangedEvent,
  SessionDto,
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

export function getRepositoryClaudeMd(): Promise<ClaudeMdDto> {
  return invoke<ClaudeMdDto>("get_repository_claude_md");
}

export function saveRepositoryClaudeMd(
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_repository_claude_md", { content, expectedModifiedAtMs });
}

export function getProjectClaudeMd(project: string): Promise<ClaudeMdDto> {
  return invoke<ClaudeMdDto>("get_project_claude_md", { project });
}

export function saveProjectClaudeMd(
  project: string,
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_project_claude_md", {
    project,
    content,
    expectedModifiedAtMs,
  });
}

export function getGithubAuthStatus(): Promise<GithubAuthStatusDto> {
  return invoke<GithubAuthStatusDto>("get_github_auth_status");
}

export function githubLoginStart(): Promise<DeviceCodeDto> {
  return invoke<DeviceCodeDto>("github_login_start");
}

export function githubLogout(): Promise<void> {
  return invoke<void>("github_logout");
}

export function listGithubProjects(): Promise<GithubProjectSummaryDto[]> {
  return invoke<GithubProjectSummaryDto[]>("list_github_projects");
}

export function onGithubAuthenticated(
  callback: (event: GithubAuthenticatedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<GithubAuthenticatedEvent>("github:authenticated", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

export function onGithubAuthFailed(
  callback: (event: GithubAuthFailedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<GithubAuthFailedEvent>("github:auth_failed", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

export function onGithubLoggedOut(callback: () => void): Promise<() => void> {
  const unlisten = listen("github:logged_out", () => callback());
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
