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
  // 元の jsonl 行の uuid(「データ」表示用。issue #313)。行に無ければ null。
  uuid: string | null;
  // この行に含まれる画像の枚数(issue #349)。画像本体は載せず、押されたときに
  // getSessionLineImages で取る。
  image_count: number;
};

// getSessionLineImages の1枚分(issue #349)。data は base64(data: プレフィックス無し)。
export type MessageImageDto = {
  media_type: string;
  data: string;
};

// 表示中の会話(issue #197でRust側`Session`→`Conversation`に改名したのに
// 合わせて、こちらの型名も追従)。
export type ConversationDto = {
  session_id: string;
  messages: MessageDto[];
  agent: AgentKindDto;
};

// セッション一覧(ビューア左ペイン)の1件分。`listSessions` はフォーク系列
// (issue #345)ごとに最新ファイルだけへ畳んだ結果を返すため、ここに並ぶのは
// 常に各系列の先頭(送信対象にできるセッション)。
export type SessionSummaryDto = {
  id: string;
  title: string;
  modified_at: number;
  // ハブのグラフ階層(issue #104)。JSONLに記録が無ければ `null`。
  cwd: string | null;
  git_branch: string | null;
  // フォーク系列の鍵(issue #345)。ビューアのセッションタブが「フォークしても同じ
  // 会話を指す」キーに使う(issue #353)。null のときは id 自身が系列の鍵。
  root_uuid: string | null;
};

// ビューアのセッションタブ1件(issue #353)。キーは「フォルダ + 系列の鍵」。
export type ViewerTabDto = {
  project: string;
  series_key: string;
};

export type AppErrorDto = {
  code: string;
  message: string;
};

export type SessionChangedEvent = {
  project: string;
  agent: AgentKindDto;
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

// ハブグラフのノード1件分の座標(issue #121)。`saveHubLayout` の引数にも
// `getHubLayout` の戻り値にも使う。
export type NodePositionDto = {
  x: number;
  y: number;
};

// ハブグラフの force シミュレーションの調整値(issue #249)。`getHubTuning` の
// 戻り値にも `saveHubTuning` の引数にも使う。`link_strength` の `null` は
// d3-force の既定(次数依存)のまま(画面の「既定」表示)。
export type HubTuningDto = {
  link_distance: number;
  link_strength: number | null;
  charge_strength: number;
  collide_radius: number;
};

// ハブグラフの視点(パン・ズーム。issue #268)。d3-zoom の transform
// (`screen = world * k + (x, y)`)。`saveHubLayout` の引数にも `getHubLayout` の
// 戻り値にも使う。
export type CameraDto = {
  x: number;
  y: number;
  k: number;
};

// `getHubLayout` の戻り値。キーはノードの安定ID(positionKey)。`camera` は保存された
// 視点(`null` はまだ動かしていない)。
export type HubLayoutDto = {
  positions: Record<string, NodePositionDto>;
  camera: CameraDto | null;
};

// `GitRepository.branches` の1件分(オブジェクトモデル実装 第3弾。
// issue #193)。削除済みはRust側(`GitRepositoryDto`への変換)で除外済み。
export type GitBranchDto = {
  branch_id: string;
  branch_name: string;
  description: string;
  created_at_time: number;
};

// `GitRepository.worktrees` の1件分(issue #193)。`checked_out_branch`は
// `GitBranchDto.branch_id`(未解決・detachedなら`null`)。
export type GitWorktreeDto = {
  worktree_id: string;
  worktree_name: string;
  description: string;
  worktree_folder_path: string;
  worktree_git_file_path: string;
  created_at_time: number;
  checked_out_branch: string | null;
};

// `getPc` の1ユーザー分(オブジェクトモデル実装 第1弾。issue #182)。
// `getPc` の1ユーザーが所有するリポジトリ1件分(オブジェクトモデル実装
// 第2弾。issue #189)。`branches`/`worktrees` は第3弾(issue #193)で追加。
export type GitRepositoryDto = {
  repository_path: string;
  repository_name: string;
  description: string;
  branches: GitBranchDto[];
  worktrees: GitWorktreeDto[];
};

// `Session.conversation_files`/`subagent_files` の1件分(オブジェクトモデル
// 実装 第5弾。issue #208)。`lines_loaded`/`line_count` は `LogLine` が
// 遅延読み込みであることの可視化用(未読み込みの間は常に `false`/`0`)。
export type SessionFileDto = {
  file_path: string;
  lines_loaded: boolean;
  line_count: number;
};

// `User.sessions` の1件分(オブジェクトモデル実装 第4弾。issue #197)。
// メッセージ本文は持たない(そちらは `ConversationDto`)。属性はセッションの
// jsonlから導出したモデル値そのもの。`conversation_files`/`subagent_files`は
// 第5弾(issue #208)で追加。`conversation_files`は issue #217 で単数
// (`conversation_file`)から1..*(配列)に変更した(セッション途中で
// worktreeへ移動すると、同じsession_idのjsonlが元のプロジェクトフォルダと
// worktree側の両方にできるため)。
// `cwd`/`git_branch`(issue #224)はハブのグラフ(セッション→ブランチの線)
// 表示用の表示補助データ。`domain::Session`の属性ではない(TMの決定:
// cwd/git_branchはLogLineの属性)ため、Rust側の`get_pc`が`ParsedSession`
// から差し込む(`data_loaded`と同じ「Fromでは埋めずcommand側で設定する」
// パターン)。
export type SessionDto = {
  session_id: string;
  custom_title: string | null;
  ai_title: string | null;
  mode: string | null;
  slug: string | null;
  last_prompt: string | null;
  conversation_files: SessionFileDto[];
  subagent_files: SessionFileDto[];
  cwd: string | null;
  git_branch: string | null;
};

export type UserDto = {
  user_id: string;
  user_name: string;
  home_directory: string;
  repositories: GitRepositoryDto[];
  sessions: SessionDto[];
};

// `getPc` の戻り値。`data_loaded`(issue #218)は`AppState.git_ledger`/
// `user_sessions`の読み込みが完了しているかどうか。`pc:data_loaded`
// イベントはマウント中のハブにしか届かないため、マウント時にこの値を
// 問い合わせることで、イベントの発火を聞き逃した場合でも正しい状態が
// 分かるようにする。
export type PcDto = {
  system_uuid: string;
  pc_name: string;
  description: string;
  users: UserDto[];
  data_loaded: boolean;
};

// `~/.claude` 配下のエントリ種別(/claude のExplorerタブ)。リンクは辿らない。
export type ClaudeDirEntryKindDto = "directory" | "file" | "symlink";

// `listClaudeDir` の1件分。`path` は `~/.claude` からの相対パス(区切りは `/`)。
// `size_bytes` はファイルのみ(ディレクトリ・リンクは `null`)。
export type ClaudeDirEntryDto = {
  name: string;
  path: string;
  kind: ClaudeDirEntryKindDto;
  size_bytes: number | null;
  modified_at_ms: number;
};

// `listClaudeDir` の戻り値。`total` はページング前の件数。
export type ClaudeDirPageDto = {
  entries: ClaudeDirEntryDto[];
  total: number;
};
