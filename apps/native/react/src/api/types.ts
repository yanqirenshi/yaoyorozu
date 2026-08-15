export type AgentKindDto = "claude-code";

// 送信時のツール実行権限モード。既定は "chat"。
export type AgentModeDto = "chat" | "read";

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

export type AppWarningEvent = {
  project: string;
  expected_session_id: string;
  actual_session_id: string;
};
