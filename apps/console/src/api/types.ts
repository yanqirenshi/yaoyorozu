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
