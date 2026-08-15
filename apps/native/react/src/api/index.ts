import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppErrorDto,
  MessageDto,
  ProjectDto,
  SessionChangedEvent,
} from "./types";

export type {
  AppErrorDto,
  MessageDto,
  ProjectDto,
  RoleDto,
  SessionChangedEvent,
} from "./types";

export function listProjects(): Promise<ProjectDto[]> {
  return invoke<ProjectDto[]>("list_projects");
}

export function getLatestSession(
  project: string,
  offset: number,
  limit: number,
): Promise<MessageDto[]> {
  return invoke<MessageDto[]>("get_latest_session", { project, offset, limit });
}

export function sendMessage(project: string, text: string): Promise<void> {
  return invoke<void>("send_message", { project, text });
}

export function onSessionChanged(
  callback: (event: SessionChangedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<SessionChangedEvent>("session:changed", (event) => {
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
