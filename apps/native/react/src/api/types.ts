export type ProjectDto = {
  name: string;
  updated_at: number;
};

export type RoleDto = "user" | "assistant";

export type MessageDto = {
  role: RoleDto;
  text: string;
  timestamp: string;
};

export type AppErrorDto = {
  code: string;
  message: string;
};
