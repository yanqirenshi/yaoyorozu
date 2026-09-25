export type AgentKindDto = "claude-code";


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
  // 送信の失敗に関する見分け(issue #364)。会話ファイルは書き換えず、表示だけで分かるようにする。
  //  - failed_question: 答えのない質問(直後が送信失敗のエラー行)
  //  - error_for_question: 送信失敗のエラー行(直前が答えのない質問)
  //  - error: 送信失敗のエラー行(直前に AI の返答がある=返答の途中で失敗)
  status: MessageStatusDto;
};

export type MessageStatusDto = "normal" | "failed_question" | "error_for_question" | "error";

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

// セッション一覧(ビューア左ペイン)の1件分。1件 = 1セッション(セッション ID =
// 会話ファイル。issue #369)。フォークや圧縮で分かれたファイルも別のセッションとして並ぶ。
export type SessionSummaryDto = {
  id: string;
  title: string;
  modified_at: number;
  // ハブのグラフ階層(issue #104)。JSONLに記録が無ければ `null`。
  cwd: string | null;
  git_branch: string | null;
};

// ビューアのセッションタブ1件(issue #353)。キーは「フォルダ + セッション ID」(issue #369)。
export type ViewerTabDto = {
  project: string;
  session_id: string;
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

// ============ 実行中セッション(issue #391。Phase 1「1セッションを app から対話する」) ============

// 画面で選べる権限モード(issue #392 の plan / default に、#407 で accept_edits / auto を足した)。
export type RunningPermissionModeDto = "plan" | "default" | "accept_edits" | "auto";

// 実行中セッション1つの宛先(app::RunningSessionRef の写し。issue #407)。pid は OS が使い回すので、
// pid_domain + pid + started_at の3つで1つの個体を指す。画面が持ち回って、送信・応答・購読・
// 切り替えの対象を指定する。
export type RunningSessionRefDto = {
  pid_domain: string;
  pid: number;
  started_at: number;
};

// 起動の要求。再開(既存の会話を --resume)と新規(新しい会話。ID は backend が決める)で値が違う。
// パス(cwd・リポジトリ)は渡さない(backend が会話ファイル・プロファイルから解決する)。
export type StartRunningSessionDto =
  | {
      kind: "resume";
      project: string;
      session_id: string;
      mode: RunningPermissionModeDto;
      name: string | null;
    }
  | { kind: "new"; mode: RunningPermissionModeDto; name: string | null };

// 起動中に切り替える設定(set_model / set_permission_mode)。
export type RunningSessionSwitchDto =
  | { kind: "model"; model: string }
  | { kind: "permission_mode"; mode: RunningPermissionModeDto };

// 宛先付きの途中経過(画面ごとの購読で流れてくる)。
export type AddressedProgressDto = {
  target: RunningSessionRefDto;
  event: ProgressEventDto;
};

// 途中経過(Channel で流れてくる)。kind で区別する。
export type ProgressEventDto =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_started"; tool_use_id: string; tool_name: string }
  | { kind: "tool_result_arrived"; tool_use_id: string; is_error: boolean }
  | { kind: "turn_finished"; succeeded: boolean }
  | { kind: "sent_line_confirmed"; uuid: string };

export type ProcessStateDto =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "exited";

// 権限の問い合わせの種別(tool_name から導出)。
//  - tool_use: 通常のツール使用の許可
//  - ask_user_question: 選択肢の質問(許可・拒否ではなく、選択を updated_input に入れて返す)
//  - exit_plan_mode: 計画の承認
export type PermissionRequestKindDto = "tool_use" | "ask_user_question" | "exit_plan_mode";

// 権限の提案(「今後も許可」に使える更新)。許可の応答で、選んだものをそのまま
// updated_permissions に入れて返す。
export type PermissionSuggestionDto = {
  suggestion_type: string;
  suggestion_destination: string;
  suggestion_content: unknown;
};

// 答え待ちの権限の問い合わせ。tool_input はツールごとに形が違うので JSON のまま。
export type PermissionRequestDto = {
  request_id: string;
  tool_name: string;
  display_name: string | null;
  description: string | null;
  tool_use_id: string;
  tool_input: unknown;
  blocked_path: string | null;
  requested_at: number;
  request_kind: PermissionRequestKindDto;
  suggestions: PermissionSuggestionDto[];
};

// app が起動した実行中セッションの現在の状態。
export type RunningSessionDto = {
  target: RunningSessionRefDto;
  // 会話ファイルのあるプロジェクトフォルダ名。再開のときだけ(新規は会話ファイルができるまで null)。
  project: string | null;
  session_id: string;
  repository_path: string;
  cwd: string | null;
  // 起動時に付けた表示名(--name)。
  name: string | null;
  process_state: ProcessStateDto;
  process_state_at: number;
  // いまのモデル(system/init か set_model の結果。最初のターンまでは null)。
  current_model: string | null;
  // いまの権限モード。CLI が返す値のまま(default / manual など、版で名前が変わる)。
  current_permission_mode: string | null;
  // 選べるモデル(CLI の initialize の応答。起動の直後は空)。set_model は名前を検証しないので、
  // 画面はここから選ばせる。
  available_models: AvailableModelDto[];
  permission_requests: PermissionRequestDto[];
};

// 選べるモデル(value を set_model に渡す)。
export type AvailableModelDto = {
  value: string;
  display_name: string;
  description: string | null;
};

// 実行中セッションの一覧の1項目(ハブなどが並べる。答え待ちの問い合わせは数だけ)。
export type RunningSessionSummaryDto = {
  target: RunningSessionRefDto;
  session_id: string;
  repository_path: string;
  process_state: ProcessStateDto;
  pending_permission_count: number;
  current_model: string | null;
  current_permission_mode: string | null;
  cwd: string | null;
  name: string | null;
};

// running-session:changed のペイロード(宛先付き。軽量。データ本体は getRunningSession /
// listRunningSessions で取り直す)。
export type RunningSessionChangedEvent = {
  target: RunningSessionRefDto;
  session_id: string;
  process_state: ProcessStateDto;
  pending_permission_count: number;
  // 終了したときだけ、終了コード(不明なら null)。終了以外は null。
  exit_code: number | null;
};

// 権限の問い合わせへの答えの種別。取り消し(CLI 側が決める)は選べない。
export type PermissionBehaviorDto = "allow" | "deny";
