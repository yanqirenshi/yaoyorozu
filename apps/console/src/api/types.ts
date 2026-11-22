// DTO の型。`apps/native/react/src/api/types.ts` から、段階 1 で使う分だけを写したもの
// (Rust の `server/src/dto.rs` と 1 対 1)。

export type AgentKindDto = "claude-code";

export type ProjectDto = {
  name: string;
  updated_at: number;
  agent: AgentKindDto;
};

export type AppErrorDto = {
  code: string;
  message: string;
};

export type GithubProjectDto = {
  owner: string;
  number: number;
};

export type ProfileSummaryDto = {
  id: string;
  name: string;
};

export type SettingsDto = {
  active_profile_id: string;
  profiles: ProfileSummaryDto[];
  repository_path: string | null;
  github_project: GithubProjectDto | null;
  selected_project_folders: string[];
  claude_projects_dir: string | null;
  effective_projects_dir: string;
  restore_running_sessions: boolean;
};

/** 確認用の `ping` イベントのペイロード(段階 1 のみ)。 */
export type PingEvent = {
  n: number;
};
