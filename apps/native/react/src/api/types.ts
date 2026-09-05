export type AgentKindDto = "claude-code";

// 送信時のツール実行権限モード。既定は "chat"。
export type AgentModeDto = "chat" | "read";

// プロジェクトの `.claude/` 配下にある設定ファイルの選択(issue #70)。
export type ProjectSettingsFileDto = "settings" | "settings_local";

export type ProjectDto = {
  name: string;
  updated_at: number;
  agent: AgentKindDto;
};

export type RoleDto = "user" | "assistant";

export type MessageDto = {
  role: RoleDto;
  text: string;
  timestamp: string;
};

export type SessionDto = {
  session_id: string;
  messages: MessageDto[];
  agent: AgentKindDto;
};

export type SessionSummaryDto = {
  id: string;
  title: string;
  modified_at: number;
  is_latest: boolean;
  // ハブのグラフ階層(issue #104)。JSONLに記録が無ければ `null`。
  cwd: string | null;
  git_branch: string | null;
};

export type AppErrorDto = {
  code: string;
  message: string;
};

export type SessionChangedEvent = {
  project: string;
  agent: AgentKindDto;
};

export type AppWarningEvent = {
  project: string;
  expected_session_id: string;
  actual_session_id: string;
};

export type GithubProjectDto = {
  owner: string;
  number: number;
};

// プロファイル一覧の1件分(issue #72)。内容(対象リポジトリ等)はアクティブな
// もののみ SettingsDto にフラットに展開される。
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
};

export type SettingsInputDto = {
  repository_path: string | null;
  github_project: GithubProjectDto | null;
  selected_project_folders: string[];
  claude_projects_dir: string | null;
};

export type SettingsCorruptedEvent = {
  message: string;
};

export type ClaudeMdDto = {
  content: string | null;
  modified_at_ms: number | null;
};

export type ClaudeSettingsDto = {
  content: string | null;
  modified_at_ms: number | null;
};

export type DeviceCodeDto = {
  user_code: string;
  verification_uri: string;
};

export type RuleSummaryDto = {
  file_name: string;
  modified_at_ms: number;
};

export type RuleDto = {
  content: string;
};

export type SkillSummaryDto = {
  name: string;
  modified_at_ms: number;
};

export type SkillDto = {
  content: string;
};

export type GithubAuthStatusDto = {
  authenticated: boolean;
  login: string | null;
};

export type GithubProjectSummaryDto = {
  number: number;
  title: string;
  closed: boolean;
};

export type GithubAuthenticatedEvent = {
  login: string;
};

export type GithubAuthFailedEvent = {
  message: string;
};

export type ProjectItemKindDto = "issue" | "pull-request" | "draft-issue";

export type ProjectItemDto = {
  id: string;
  title: string;
  kind: ProjectItemKindDto;
  repository: string | null;
  number: number | null;
  assignees: string[];
  status: string | null;
  url: string | null;
};

export type ProjectStatusOptionDto = {
  id: string;
  name: string;
};

// ウィンドウ内の1タブの表示状態(ハブ化 その1。issue #83)。
// `reportWindowState` の引数と `listWindowStates` の戻り値の両方に使う。
export type WindowTabDto = {
  profile_id: string;
  session_id: string | null;
  session_title: string | null;
};

// `listWindowStates` の1件分(issue #83)。
export type WindowStateDto = {
  label: string;
  tabs: WindowTabDto[];
  active_tab_index: number;
};

export type ProjectItemsPageDto = {
  project_id: string;
  status_field_id: string | null;
  items: ProjectItemDto[];
  next_cursor: string | null;
  status_options: ProjectStatusOptionDto[];
};
