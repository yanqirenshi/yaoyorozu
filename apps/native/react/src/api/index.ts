import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppErrorDto,
  ClaudeDirPageDto,
  ClaudeMdDto,
  ClaudeSettingsDto,
  ConversationDto,
  DeviceCodeDto,
  GithubAuthFailedEvent,
  GithubAuthStatusDto,
  GithubAuthenticatedEvent,
  GithubProjectSummaryDto,
  CameraDto,
  HubLayoutDto,
  HubTuningDto,
  MessageImageDto,
  NodePositionDto,
  PcDto,
  PermissionBehaviorDto,
  PermissionSuggestionDto,
  ProfileSummaryDto,
  ProgressEventDto,
  ProjectDto,
  ProjectItemsPageDto,
  ProjectSettingsFileDto,
  RuleDto,
  RuleSummaryDto,
  RunningPermissionModeDto,
  RunningSessionChangedEvent,
  RunningSessionDto,
  SessionChangedEvent,
  SessionSummaryDto,
  ViewerTabDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
  SkillDto,
  SkillSummaryDto,
  WindowStateDto,
  WindowTabDto,
} from "./types";

export type {
  PermissionBehaviorDto,
  PermissionRequestDto,
  PermissionRequestKindDto,
  PermissionSuggestionDto,
  ProcessStateDto,
  ProgressEventDto,
  RunningPermissionModeDto,
  RunningSessionChangedEvent,
  RunningSessionDto,
  AgentKindDto,
  AppErrorDto,
  ClaudeDirEntryDto,
  ClaudeDirEntryKindDto,
  ClaudeDirPageDto,
  ClaudeMdDto,
  ClaudeSettingsDto,
  ConversationDto,
  DeviceCodeDto,
  GitBranchDto,
  GitRepositoryDto,
  GitWorktreeDto,
  GithubAuthFailedEvent,
  GithubAuthStatusDto,
  GithubAuthenticatedEvent,
  GithubProjectDto,
  GithubProjectSummaryDto,
  CameraDto,
  HubLayoutDto,
  HubTuningDto,
  MessageDto,
  MessageImageDto,
  NodePositionDto,
  PcDto,
  ProfileSummaryDto,
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
  SessionFileDto,
  SessionSummaryDto,
  ViewerTabDto,
  SettingsCorruptedEvent,
  SettingsDto,
  SettingsInputDto,
  SkillDto,
  SkillSummaryDto,
  UserDto,
  WindowStateDto,
  WindowTabDto,
} from "./types";

export function listProjects(): Promise<ProjectDto[]> {
  return invoke<ProjectDto[]>("list_projects");
}

export function getSession(
  project: string,
  sessionId: string,
  offset: number,
  limit: number,
): Promise<ConversationDto> {
  return invoke<ConversationDto>("get_session", { project, sessionId, offset, limit });
}

// メッセージの元の jsonl 行(生のテキスト)。オンデマンドで取る(issue #313)。
export function getSessionLineRaw(
  project: string,
  sessionId: string,
  uuid: string,
): Promise<string> {
  return invoke<string>("get_session_line_raw", { project, sessionId, uuid });
}

// ビューアのセッションタブの並び(プロファイルごと。issue #353)。
export function getViewerTabs(profileId: string): Promise<ViewerTabDto[]> {
  return invoke<ViewerTabDto[]>("get_viewer_tabs", { profileId });
}

export function saveViewerTabs(profileId: string, tabs: ViewerTabDto[]): Promise<void> {
  return invoke<void>("save_viewer_tabs", { profileId, tabs });
}

export function listSessions(project: string): Promise<SessionSummaryDto[]> {
  return invoke<SessionSummaryDto[]>("list_sessions", { project });
}

// 画像を1枚添付する前の事前検証(issue #349)。existingCount は添付済みの枚数。
// 違反なら理由つきの AppErrorDto で reject される。
export function checkImageAttachment(data: string, existingCount: number): Promise<void> {
  return invoke<void>("check_image_attachment", { data, existingCount });
}

// メッセージ(uuid)に含まれる画像をオンデマンドで取る(「画像 n 枚」。issue #349)。
export function getSessionLineImages(
  project: string,
  sessionId: string,
  uuid: string,
): Promise<MessageImageDto[]> {
  return invoke<MessageImageDto[]>("get_session_line_images", { project, sessionId, uuid });
}

// ---- 実行中セッション(issue #391)。app が claude CLI を起動したまま持ち、対話する。 ----
// cwd やパスは渡さない(backend が会話ファイルから解決する。native.md §4)。

// 会話 sessionId を子プロセスの claude として起動する(--resume)。Phase 1 は同時に1つ。
// 途中経過は onProgress へ、順序どおりに届く(Channel)。
export function startRunningSession(
  profileId: string | null,
  project: string,
  sessionId: string,
  mode: RunningPermissionModeDto,
  onProgress: (event: ProgressEventDto) => void,
): Promise<RunningSessionDto> {
  const channel = new Channel<ProgressEventDto>();
  channel.onmessage = onProgress;
  return invoke<RunningSessionDto>("start_running_session", {
    profileId,
    project,
    sessionId,
    mode,
    onProgress: channel,
  });
}

// 起動済みの実行中セッションの現在の状態(答え待ちの問い合わせを含む)。無ければ null。
export function getRunningSession(): Promise<RunningSessionDto | null> {
  return invoke<RunningSessionDto | null>("get_running_session");
}

// 実行中セッションへ user メッセージ(本文と画像 base64)を送る。
export function sendToRunningSession(text: string, images: string[]): Promise<void> {
  return invoke<void>("send_to_running_session", { text, images });
}

// 権限の問い合わせに答える。allow は updatedInput(書き換えた入力。省略で問い合わせの
// 入力のまま)と updatedPermissions(「今後も許可」にする提案)を、deny は message を添えられる。
export function respondPermission(
  requestId: string,
  behavior: PermissionBehaviorDto,
  options: {
    updatedInput?: unknown;
    updatedPermissions?: PermissionSuggestionDto[];
    message?: string;
  } = {},
): Promise<void> {
  return invoke<void>("respond_permission", {
    requestId,
    behavior,
    updatedInput: options.updatedInput ?? null,
    updatedPermissions: options.updatedPermissions ?? null,
    message: options.message ?? null,
  });
}

// 生成中(権限待ちを含む)の中断。プロセスは生きたまま、次の入力を送れる。
export function interruptRunningSession(): Promise<void> {
  return invoke<void>("interrupt_running_session");
}

// 実行中セッションを止める(標準入力を閉じて終了を待つ。約1秒)。
export function stopRunningSession(): Promise<void> {
  return invoke<void>("stop_running_session");
}

// 状態変化・権限の問い合わせの到着/決着の通知(軽量)。詳細は getRunningSession で取り直す。
export function onRunningSessionChanged(
  callback: (event: RunningSessionChangedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<RunningSessionChangedEvent>("running-session:changed", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

export function onSessionChanged(
  callback: (event: SessionChangedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<SessionChangedEvent>("session:changed", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

// `profileId` は対象プロファイル。`null`(またはundefined)はアクティブ
// (既定)プロファイルを対象にする(メインウィンドウの挙動不変。issue #76。
// `useWindowProfileId` で解決した値をそのまま渡す)。
export function getSettings(profileId?: string | null): Promise<SettingsDto> {
  return invoke<SettingsDto>("get_settings", { profileId: profileId ?? null });
}

export function updateSettings(
  input: SettingsInputDto,
  profileId?: string | null,
): Promise<void> {
  return invoke<void>("update_settings", { input, profileId: profileId ?? null });
}

export function onSettingsCorrupted(
  callback: (event: SettingsCorruptedEvent) => void,
): Promise<() => void> {
  const unlisten = listen<SettingsCorruptedEvent>("settings:corrupted", (event) => {
    callback(event.payload);
  });
  return unlisten.then((fn) => fn);
}

// プロファイルの切り替え・作成・削除・名前変更(issue #72)。
export function switchProfile(profileId: string): Promise<void> {
  return invoke<void>("switch_profile", { profileId });
}

export function createProfile(name?: string | null): Promise<ProfileSummaryDto> {
  return invoke<ProfileSummaryDto>("create_profile", { name: name ?? null });
}

export function deleteProfile(profileId: string): Promise<void> {
  return invoke<void>("delete_profile", { profileId });
}

export function renameProfile(profileId: string, name: string): Promise<void> {
  return invoke<void>("rename_profile", { profileId, name });
}

// 指定プロファイルを対象に新しいウィンドウを開く(マルチウィンドウ Phase 1。
// issue #76)。ウィンドウ生成はRust側で行う(native.md §4)。
export function openProfileWindow(profileId: string): Promise<void> {
  return invoke<void>("open_profile_window", { profileId });
}

// このウィンドウの表示状態(タブの配列+アクティブタブ)をレジストリへ
// 報告する(ハブ化 その1。issue #83)。ウィンドウのラベルはRust側が呼び出し元
// から取得するため引数に含めない。
export function reportWindowState(
  tabs: WindowTabDto[],
  activeTabIndex: number,
): Promise<void> {
  return invoke<void>("report_window_state", { tabs, activeTabIndex });
}

export function listWindowStates(): Promise<WindowStateDto[]> {
  return invoke<WindowStateDto[]>("list_window_states");
}

export function focusWindow(label: string): Promise<void> {
  return invoke<void>("focus_window", { label });
}

// このPC・ログインユーザー情報を取得する(オブジェクトモデル実装 第1弾。
// issue #182)。
export function getPc(): Promise<PcDto> {
  return invoke<PcDto>("get_pc");
}

// 登録済み全リポジトリのGit状態(ブランチ・worktree)を再観測し、台帳を
// 更新する(オブジェクトモデル実装 第3弾。issue #193)。ハブの「再読み込み」
// 操作から呼ぶ。反映された結果は次の `getPc` で取得できる。
export function reconcileGitState(): Promise<void> {
  return invoke<void>("reconcile_git_state");
}

// 起動直後は空で始まるGit台帳・セッション一覧(issue #212。初回表示の
// ラグ解消のため、jsonl走査・git観測をバックグラウンド化した)の読み込みが
// 完了したときに1回だけ発火する。ペイロードは持たず、購読側が `getPc` で
// 取り直す(`onWindowsChanged` 等と同じ流儀)。
export function onPcDataLoaded(callback: () => void): Promise<() => void> {
  const unlisten = listen("pc:data_loaded", () => callback());
  return unlisten.then((fn) => fn);
}

// 手動の再読み込み(`reconcileGitState`)を開始したときに発火する
// (issue #245)。`onPcDataLoaded` と対で、購読側が `getPc` で取り直すと
// `data_loaded` が `false` に戻っている(「読み込み中」を表示できる)。
export function onPcDataLoading(callback: () => void): Promise<() => void> {
  const unlisten = listen("pc:data_loading", () => callback());
  return unlisten.then((fn) => fn);
}

// セッションファイル(.jsonl)の変更をファイル監視が検知し、変更のあった
// ファイルだけを再走査して `AppState` へ反映したときに発火する(issue #311。
// ハブの自動更新)。ペイロードは無し。購読側が `getPc` で取り直す
// (`onPcDataLoaded` と同じ軽量通知+pull の流儀)。
export function onPcSessionsUpdated(callback: () => void): Promise<() => void> {
  const unlisten = listen("pc:sessions_updated", () => callback());
  return unlisten.then((fn) => fn);
}

// 走査キュー(PoC)の進捗。会話ファイル1件の走査が完了するたびに発火する。
// ペイロードは進捗表示用の件数のみで、データ本体は購読側が `getPc` で
// 取り直す(`onPcDataLoaded` と同じ流儀)。
export type ScanProgress = { completed: number; total: number };
export function onPcDataProgress(
  callback: (progress: ScanProgress) => void,
): Promise<() => void> {
  const unlisten = listen<ScanProgress>("pc:data_progress", (event) =>
    callback(event.payload),
  );
  return unlisten.then((fn) => fn);
}

// ハブグラフのノード位置(ドラッグ固定)を取得する(issue #121)。
export function getHubLayout(): Promise<HubLayoutDto> {
  return invoke<HubLayoutDto>("get_hub_layout");
}

// ハブグラフのノード位置を丸ごと置き換えて保存する(issue #121)。マージ
// ではなく置き換えなので、呼び出し側は現在有効な全ノード分の位置を渡すこと。
export function saveHubLayout(
  positions: Record<string, NodePositionDto>,
  camera: CameraDto | null,
): Promise<void> {
  return invoke<void>("save_hub_layout", { positions, camera });
}

// ハブグラフの調整値(issue #249)を取得する。保存値が無い/壊れている場合は
// 既定値が返る。
export function getHubTuning(): Promise<HubTuningDto> {
  return invoke<HubTuningDto>("get_hub_tuning");
}

// ハブグラフの調整値を保存する(issue #249)。呼び出し側でデバウンスする。
export function saveHubTuning(tuning: HubTuningDto): Promise<void> {
  return invoke<void>("save_hub_tuning", { tuning });
}

// レジストリが変わるたびに発火する(ウィンドウの状態報告・閉鎖のいずれでも。
// issue #83)。ペイロードは持たず、購読側が `listWindowStates` で取り直す。
export function onWindowsChanged(callback: () => void): Promise<() => void> {
  const unlisten = listen("windows:changed", () => callback());
  return unlisten.then((fn) => fn);
}

// 設定(アクティブプロファイルの内容含む)が変わったことの通知。
// `update_settings`/プロファイル操作系コマンドの成功時に発火する
// (native.md §3.2。issue #72)。
export function onSettingsUpdated(callback: () => void): Promise<() => void> {
  const unlisten = listen("settings:updated", () => callback());
  return unlisten.then((fn) => fn);
}

// ビューアの CLAUDE.md / Rules / Skills / settings 系(以下 6 組)は、対象リポジトリを
// backend がプロファイルの `repository_path` から解決する(issue #269)。パスは
// 渡さない。`profileId` が `null` ならアクティブプロファイル。
export function getProjectClaudeMd(profileId: string | null): Promise<ClaudeMdDto> {
  return invoke<ClaudeMdDto>("get_project_claude_md", { profileId });
}

export function saveProjectClaudeMd(
  profileId: string | null,
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_project_claude_md", {
    profileId,
    content,
    expectedModifiedAtMs,
  });
}

export function listRules(profileId: string | null): Promise<RuleSummaryDto[]> {
  return invoke<RuleSummaryDto[]>("list_rules", { profileId });
}

export function getRule(profileId: string | null, fileName: string): Promise<RuleDto> {
  return invoke<RuleDto>("get_rule", { profileId, fileName });
}

export function listSkills(profileId: string | null): Promise<SkillSummaryDto[]> {
  return invoke<SkillSummaryDto[]>("list_skills", { profileId });
}

export function getSkill(profileId: string | null, name: string): Promise<SkillDto> {
  return invoke<SkillDto>("get_skill", { profileId, name });
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

// `~/.claude/CLAUDE.md`(ユーザーレベル)。対象パスはRust側で固定解決する。
export function getUserClaudeMd(): Promise<ClaudeMdDto> {
  return invoke<ClaudeMdDto>("get_user_claude_md");
}

export function saveUserClaudeMd(
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_user_claude_md", { content, expectedModifiedAtMs });
}

// `~/.claude` 配下の `path`(`~/.claude` からの相対パス。区切りは `/`、
// ルートは空文字列)直下を一覧する。子を開くときは各エントリの `path` を
// そのまま渡す。
export function listClaudeDir(
  path: string,
  offset: number,
  limit: number,
): Promise<ClaudeDirPageDto> {
  return invoke<ClaudeDirPageDto>("list_claude_dir", { path, offset, limit });
}

export function getProjectSettingsFile(
  profileId: string | null,
  which: ProjectSettingsFileDto,
): Promise<ClaudeSettingsDto> {
  return invoke<ClaudeSettingsDto>("get_project_settings_file", { profileId, which });
}

export function saveProjectSettingsFile(
  profileId: string | null,
  which: ProjectSettingsFileDto,
  content: string,
  expectedModifiedAtMs: number | null,
): Promise<void> {
  return invoke<void>("save_project_settings_file", {
    profileId,
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

export function listGithubProjectItems(
  cursor: string | null,
  profileId?: string | null,
): Promise<ProjectItemsPageDto> {
  return invoke<ProjectItemsPageDto>("list_github_project_items", {
    cursor,
    profileId: profileId ?? null,
  });
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
