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
  // 表示しているプロファイルの設定の版(そのプロファイルの欄が実際に変わるときだけ増える番号。この構成だけの項目)。
  // `updateSettings` に渡す。別のプロファイルの保存・切替・作成・削除・改名では進まない。
  revision: number;
  // 全体の欄(`claude_projects_dir`・`restore_running_sessions`)の版。これも `updateSettings` に渡す。
  global_revision: number;
};

/** 確認用の `ping` イベントのペイロード(段階 1 のみ)。 */
export type PingEvent = {
  n: number;
};

// 設定の保存(`update_settings`)の入力。対象は指定したプロファイル(必須)の 3 項目 +
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
  // サーバの控えの id(あれば。閉じるとき `dismissPendingWarning` に渡す)。
  id?: number;
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

// `~/.claude/CLAUDE.md`・設定ファイルの内容。`content` が null ならファイルが無い。
// `modified_at_ms` は保存時に `expectedModifiedAtMs` として送り返し、アプリ外での変更との競合を検出する。
export type ClaudeMdDto = {
  content: string | null;
  modified_at_ms: number | null;
};

export type ClaudeSettingsDto = {
  content: string | null;
  modified_at_ms: number | null;
};

// `~/.claude` 配下のエントリ種別(/claude の Explorer タブ)。リンクは辿らない。
export type ClaudeDirEntryKindDto = "directory" | "file" | "symlink";

// `listClaudeDir` の 1 件分。`path` は `~/.claude` からの相対パス(区切りは `/`)。
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

// ---- 段階 2 C: ビューア(閲覧と編集)。apps/native/react/src/api/types.ts から写した ----

// プロジェクトの `.claude/` 配下にある設定ファイルの選択(issue #70)。
export type ProjectSettingsFileDto = "settings" | "settings_local";

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
  // セッション間メッセージ(CLI の SendMessage)の見分け(issue #437)。会話ファイルは書き換えず、
  // 表示だけで分かるようにする。
  //  - peer_received: 他のセッションから届いた(text は封筒を剥いだ本文。peer_name は送り元)
  //  - peer_sent: 他のセッションへ送った(text は送った文。peer_name は宛先)
  //  - peer_send_result: 送信の結果(text は結果の説明。peer_success は成否)
  kind: MessageKindDto;
  peer_name: string | null;
  peer_success: boolean | null;
};

export type MessageKindDto = "normal" | "peer_received" | "peer_sent" | "peer_send_result";

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
  // 会話に付いている表示名(なければ null。title は先頭のメッセージなどへ落ちる)。
  // 再開の表示名の初期値に使う(issue #445)。
  custom_title: string | null;
  modified_at: number;
  // ハブのグラフ階層(issue #104)。JSONLに記録が無ければ `null`。
  cwd: string | null;
  git_branch: string | null;
  // アーカイブ済みか(issue #494)。会話ファイルは消さず、一覧から隠してプロセスを止める印。
  archived: boolean;
};


export type SessionChangedEvent = {
  project: string;
  agent: AgentKindDto;
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


// yyz/(issue #543)一式のうち1ファイルの状態(issue #547)。
export type YyzScaffoldFileStatusDto = {
  relative_path: string;
  exists: boolean;
};

// yyz/ 一式の状態。getYyzScaffoldStatus / createYyzScaffold のどちらの戻り値にも使う。
export type YyzScaffoldStatusDto = {
  files: YyzScaffoldFileStatusDto[];
  complete: boolean;
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

// 起動のときに選べるモデル(別名。issue #445)。自由入力にしない(CLI は --model の名前を検証しない)。
// 「既定」は指定なし(null / 省略 = --model を付けない = CLI の既定)。
export type StartModelDto = "fable" | "opus" | "sonnet" | "haiku";

// 起動の要求。再開(既存の会話を --resume)と新規(新しい会話。ID は backend が決める)で値が違う。
// パス(cwd・リポジトリ)は渡さない(backend が会話ファイル・プロファイルから解決する)。
export type StartRunningSessionDto =
  | {
      kind: "resume";
      project: string;
      session_id: string;
      mode: RunningPermissionModeDto;
      name: string | null;
      // 起動時のモデル。省略・null は CLI の既定(従来どおり)。issue #445。
      model?: StartModelDto | null;
      // 省略すると、会話ファイルに記録された cwd で開く(従来どおり)。issue #437。
      worktree?: WorktreeSpecDto | null;
      // 起動前の最新化(git fetch + git merge origin/main)。省略で行う。
      sync_origin_main?: boolean | null;
    }
  | {
      kind: "new";
      mode: RunningPermissionModeDto;
      name: string | null;
      // 起動時のモデル。省略・null は CLI の既定(従来どおり)。issue #445。
      model?: StartModelDto | null;
      // 省略すると、リポジトリ本体で始める。issue #437。
      worktree?: WorktreeSpecDto | null;
      sync_origin_main?: boolean | null;
    };

// どの worktree で起動するか(パスは渡さない。issue #437)。
//  - main: リポジトリ本体
//  - existing: 既存の worktree(台帳の worktree_id)
//  - branch: このブランチの worktree(無ければ backend が用意する。ブランチも無ければ origin/main から作る)
export type WorktreeSpecDto =
  | { kind: "main" }
  | { kind: "existing"; worktree_id: string }
  | { kind: "branch"; branch_name: string };

// 起動中に切り替える設定(set_model / set_permission_mode)。
export type RunningSessionSwitchDto =
  | { kind: "model"; model: string }
  | { kind: "permission_mode"; mode: RunningPermissionModeDto };

// 宛先付きの途中経過(画面ごとの購読で流れてくる)。
export type AddressedProgressDto = {
  target: RunningSessionRefDto;
  event: ProgressEventDto;
};

// 途中経過に付く、会話ごとの連番(1 から。取り直しの `progress_seq` と突き合わせる。`progressMerge.ts`)。
export type ProgressSeq = number;

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
  // 起動した worktree の ID(リポジトリ本体は main-worktree。issue #437)。
  worktree_id: string;
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
  // 起動した claude の版(claude --version の出力。読めなければ null。issue #437)。
  cli_version: string | null;
  // セッション間メッセージに使える版か(2.1.268 以上。null は版が分からない)。
  peer_messaging: boolean | null;
  // 使えない版のときの説明(状態バーに出す。使える・分からないときは null)。起動は止めない。
  peer_messaging_warning: string | null;
  permission_requests: PermissionRequestDto[];
  // この会話が送り出した途中経過の最後の番号(ここまでは、この応答の状態に反映済み)。
  progress_seq: number;
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
  // 起動した claude の版と、セッション間メッセージに使える版か(issue #437。ハブのインスペクタ用)。
  cli_version: string | null;
  peer_messaging: boolean | null;
  name: string | null;
  // 開始したが結果がまだ来ていないツール呼び出しの ID(issue #570)。サブエージェントの
  // SessionFileDto.tool_use_id と突き合わせて実行中かどうかを見分けるのに使う。
  running_tool_use_ids: string[];
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

// 上限に対する危険度(issue #613)。`limits[].severity` の写し。知らない値は unknown。
export type UsageSeverityDto = "normal" | "warning" | "critical" | "unknown";

// 1つの枠(5時間 / 7日 / モデル別)の使用率(issue #613)。金額は含まない(native.md §4)。
export type UsageLimitDto = {
  utilization_percent: number;
  // UTC epoch ms。ローカル時刻への変換は表示側(issue #613)。
  resets_at_ms: number | null;
  severity: UsageSeverityDto;
};

// モデル別の使用率(issue #613)。
export type ModelUsageDto = {
  display_name: string;
  limit: UsageLimitDto;
};

// Claude.ai の利用状況(issue #613)。読めなかった枠は null/空。
export type ClaudeUsageDto = {
  five_hour: UsageLimitDto | null;
  seven_day: UsageLimitDto | null;
  model_scoped: ModelUsageDto[];
};

// app が最後に取得した利用状況と、取得した時刻(issue #613)。CLI が1つも動いていない間は
// 更新されないため、`fetched_at_ms` を見て古さを示せる。getClaudeUsage の戻り値、および
// claude-usage:updated イベントのペイロードを兼ねる。
export type ClaudeUsageSnapshotDto = {
  usage: ClaudeUsageDto | null;
  fetched_at_ms: number | null;
};

// 画像の添付の上限(`getAttachmentLimits`。この構成だけの Query)。上限の数字は、サーバの 1 か所から取る。
export type AttachmentLimitsDto = {
  // 画像 1 枚の、元のバイト数の上限。
  max_image_bytes: number;
  // 1 回の送信に付けられる画像の枚数。
  max_images: number;
};
