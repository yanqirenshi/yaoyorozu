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

// 設定の保存(`update_settings`)の入力。対象はアクティブ(または指定)プロファイルの 3 項目 +
// グローバル項目の `claude_projects_dir`。`apps/native/react/src/api/types.ts` と同じ。
export type SettingsInputDto = {
  repository_path: string | null;
  github_project: GithubProjectDto | null;
  selected_project_folders: string[];
  claude_projects_dir: string | null;
  // 省略・null は「変えない」。
  restore_running_sessions?: boolean | null;
};

// `settings:corrupted` イベントのペイロード(設定ファイルの破損から復旧したとき)。
export type SettingsCorruptedEvent = {
  message: string;
};

// `app:warning` イベントのペイロード(処理は続くが、利用者に伝えたいこと)。
export type AppWarningEvent = {
  message: string;
};

// 起動直後に出て、画面が取りこぼした警告の控え(`list_pending_warnings`。この構成だけの Query)。
// 画面は開いたときと、つなぎ直したときに取る。閉じたら `dismiss_pending_warning`。
export type PendingWarningDto = {
  id: number;
  kind: "settings:corrupted" | "app:warning";
  message: string;
};

// パスの手入力の確認(`check_folder`。この構成だけの Query。Tauri 版のフォルダ選択ダイアログの代わり)。
export type FolderCheckDto = {
  path: string;
  exists: boolean;
  is_dir: boolean;
  is_git_repository: boolean;
};
