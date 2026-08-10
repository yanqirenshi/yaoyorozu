import { invoke } from "@tauri-apps/api/core";
import type { AppErrorDto, MessageDto, ProjectDto } from "./types";

export type { AppErrorDto, MessageDto, ProjectDto, RoleDto } from "./types";

export function listProjects(): Promise<ProjectDto[]> {
  return invoke<ProjectDto[]>("list_projects");
}

export function getLatestSession(project: string): Promise<MessageDto[]> {
  return invoke<MessageDto[]>("get_latest_session", { project });
}

export function sendMessage(project: string, text: string): Promise<void> {
  return invoke<void>("send_message", { project, text });
}

export function isAppError(error: unknown): error is AppErrorDto {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}
