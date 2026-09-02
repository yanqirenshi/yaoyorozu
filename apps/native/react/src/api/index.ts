import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentModeDto,
  AppErrorDto,
  AppWarningEvent,
  ClaudeMdDto,
  ClaudeSettingsDto,
  DeviceCodeDto,
  GithubAuthFailedEvent,
  GithubAuthStatusDto,
  GithubAuthenticatedEvent,
  GithubProjectSummaryDto,
  ProjectDto,
  ProjectItemsPageDto,
  ProjectSettingsFileDto,
  RuleDto,
  RuleSummaryDto,
  SessionChangedEvent,
  SessionDto,
  SessionSummaryDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
  SkillDto,
  SkillSummaryDto,
} from "./types";

export type {
  AgentKindDto,
  AgentModeDto,
  AppErrorDto,
  AppWarningEvent,
  ClaudeMdDto,
  ClaudeSettingsDto,
  DeviceCodeDto,
  GithubAuthFailedEvent,
  GithubAuthStatusDto,
  GithubAuthenticatedEvent,
  GithubProjectDto,
  GithubProjectSummaryDto,
  MessageDto,
  ProjectDto,
  ProjectItemDto,
  ProjectItemKindDto,
  ProjectItemsPageDto,
  ProjectSettingsFileDto,
  ProjectStatusOptionDto,
  RoleDto,
  RuleDto,
  RuleSummaryDto,
  SessionChangedEvent,
  SessionDto,
  SessionSummaryDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
  SkillDto,
  SkillSummaryDto,
} from "./types";

export function listProjects(): Promise<ProjectDto[]> {
  return invoke<ProjectDto[]>("list_projects");
}

export function getSession(
  project: string,
  sessionId: string,
  offset: number,
  limit: number,
): Promise<SessionDto> {
  return invoke<SessionDto>("get_session", { project, sessionId, offset, limit });
}

export function listSessions(project: string): Promise<SessionSummaryDto[]> {
  return invoke<SessionSummaryDto[]>("list_sessions", { project });
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

export function listRules(project: string): Promise<RuleSummaryDto[]> {
  return invoke<RuleSummaryDto[]>("list_rules", { project });
}

export function getRule(project: string, fileName: string): Promise<RuleDto> {
  return invoke<RuleDto>("get_rule", { project, fileName });
}

export function listSkills(project: string): Promise<SkillSummaryDto[]> {
  return invoke<SkillSummaryDto[]>("list_skills", { project });
}

export function getSkill(project: string, name: string): Promise<SkillDto> {
  return invoke<SkillDto>("get_skill", { project, name });
}

export function getClaudeSettingsFile(): Promise<ClaudeSettingsDto> {
  return invoke<ClaudeSettingsDto>("get_claude_settings_file");
}

export function saveClaudeSettingsFile(
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_claude_settings_file", {
    content,
    expectedModifiedAtMs,
  });
}

export function getProjectSettingsFile(
  project: string,
  which: ProjectSettingsFileDto,
): Promise<ClaudeSettingsDto> {
  return invoke<ClaudeSettingsDto>("get_project_settings_file", { project, which });
}

export function saveProjectSettingsFile(
  project: string,
  which: ProjectSettingsFileDto,
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_project_settings_file", {
    project,
    which,
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

export function listGithubProjectItems(cursor: string | null): Promise<ProjectItemsPageDto> {
  return invoke<ProjectItemsPageDto>("list_github_project_items", { cursor });
}

export function updateGithubProjectItemStatus(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string | null,
): Promise<void> {
  return invoke<void>("update_github_project_item_status", {
    projectId,
    itemId,
    fieldId,
    optionId,
  });
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
