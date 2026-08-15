export type AgentKindDto = "claude-code";

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

export type AppErrorDto = {
  code: string;
  message: string;
};

export type SessionChangedEvent = {
  project: string;
  agent: AgentKindDto;
};
