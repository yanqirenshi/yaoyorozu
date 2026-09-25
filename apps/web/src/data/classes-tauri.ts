/**
 * apps/native の tauri クレート(`crates/tauri/src/`。ディレクトリ名は `tauri` だが
 * 実体はアプリの薄い境界層)に実装済みの型のクラス図。`classes-native-prototype.ts`・
 * `classes-infra.ts` と同じ「実装の as-is スナップショット」の書き方を踏襲する。
 *
 * 【対象】
 * - `dto.rs`: フロント(React)へ渡す DTO(実行中セッション分を含む)。native.md §3.1 により、
 *   command の戻り値は必ず DTO で、`domain`/`app` の型に `Serialize` を付けて
 *   直接返さない(型注釈のとおり、DTO は `domain`/`app` の型と1対1で対応する
 *   ことが多いが、フィールドを絞る・別名にする等の違いがある)。
 * - `state.rs`: `AppState`(アプリの唯一の真実、native.md §2)・`LoadResult`。
 *   実行中セッション(issue #391)の `RunningSessionSlot`(`AppState.running_session` に入る)も同じファイル。
 * - `local_api.rs`: ローカルAPIサーバ(native.md §7)のハンドラが使う3型。
 *   `pub` が付いていない(モジュール内だけで使う)。
 * - `running_session.rs`: 実行中セッションの command 群(関数なので図には描かない)と、
 *   `RunningSessionEventSink` の実装 `ChannelSink`(private)。
 *
 * 【書き方】`classes-native-prototype.ts` と同じ基準。
 * - フィールドの型がこの図の中の別のクラス(enum を含む)を指すときだけ関係線を
 *   引く(必須・単数 → コンポジション、`Option`/`Vec`/`HashMap` → 関連)。
 * - `AppState.settings`(`domain::Settings`)・`AppState.pc`(`domain::Pc`)・
 *   `AppState.user_sessions`(`Vec<domain::ParsedSession>`)は、それぞれ
 *   `classes-native-prototype.ts`・`classes-domain.ts` に載っている実在の
 *   クラスだが、別の図の離れた位置にあり線を引くと図をまたいで長く伸びるため、
 *   線は引かない(属性の型名にそのまま `domain::` を残して分かるようにする)。
 *   `AppState.window_states`(`app::WindowRegistry`)・`AppState.git_ledger`
 *   (`domain::GitLedger`)は、この図にも他の図にも無い型なので、同様に線を
 *   引かない。
 * - `From<domain::X>`/`From<app::X>` の実装(DTOへの変換)がある型は、対応する
 *   クラスをコメントに書いた(`classes-native-prototype.ts`・`classes-infra.ts`
 *   に同名 + `Dto` を外した名前で載っている)。線では結ばない(変換であって
 *   フィールドの型ではないため。冒頭の書き方の基準を参照)。
 * - `SessionDto` は issue #197(第4弾)で入れ替わっている。旧 `SessionDto`
 *   (会話内容 = id/messages/agent)は `ConversationDto` に改名され
 *   (`domain::Conversation` から変換)、`SessionDto` という名前はクラス図の
 *   `Session`(session_id/custom_title/ai_title/mode/slug/last_prompt。
 *   `domain::Session` から変換)に付け替わった。この図でも同じ名前の入れ替え
 *   を反映している。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import {
  attr,
  defineDiagram,
  label,
  type ClassDef,
  type ClassLayers,
} from "./classDiagram";

const DEFS: ClassDef[] = [
  // ============ セッション閲覧 ============
  {
    name: { physical: "AgentKindDto", logical: "AgentKindDto", description: "エージェントの種類。domain::AgentKind から変換(From)" },
    stereotype: "enumeration",
    attributes: ["ClaudeCode"].map(label),
    position: { x: 2500, y: 5200 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ProjectDto", logical: "ProjectDto", description: "domain::Project から変換(From)" },
    attributes: [
      attr("name", "String"),
      attr("updated_at", "u64"),
      attr("agent", "AgentKindDto"),
    ],
    position: { x: 2100, y: 5550 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "RoleDto", logical: "RoleDto", description: "domain::Role から変換(From)" },
    stereotype: "enumeration",
    attributes: ["User", "Assistant"].map(label),
    position: { x: 3300, y: 5900 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "MessageDto", logical: "MessageDto", description: "domain::Message から変換(From)" },
    attributes: [
      attr("role", "RoleDto"),
      attr("text", "String"),
      attr("timestamp", "String"),
    ],
    position: { x: 2900, y: 5900 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ConversationDto", logical: "ConversationDto", description: "表示中の会話。domain::Conversation(issue #197で改名。旧 domain::Session)から変換(From)。session_id は送信直前の一致検証に使う" },
    attributes: [
      attr("session_id", "String"),
      attr("messages", "Vec<MessageDto>"),
      attr("agent", "AgentKindDto"),
    ],
    position: { x: 2900, y: 5550 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "SessionSummaryDto", logical: "SessionSummaryDto", description: "セッション一覧(ビューア左ペイン)の1件分。domain::SessionSummary から変換(From)" },
    attributes: [
      attr("id", "String"),
      attr("title", "String"),
      attr("modified_at", "u64"),
      attr("cwd", "Option<String>"),
      attr("git_branch", "Option<String>"),
    ],
    position: { x: 2100, y: 5900 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "SessionChangedEventDto", logical: "SessionChangedEventDto", description: "session:changed イベントのペイロード。変更のあったプロジェクト名のみ通知し、本体はフロントが取り直す" },
    attributes: [
      attr("project", "String"),
      attr("agent", "AgentKindDto"),
    ],
    position: { x: 3300, y: 5550 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ 送信・設定ファイル種別 ============
  {
    name: { physical: "AgentModeDto", logical: "AgentModeDto", description: "送信時のツール実行権限モード。フロント→Rust なので Deserialize。app::AgentMode へ変換(From)" },
    stereotype: "enumeration",
    attributes: ["Chat", "Read"].map(label),
    position: { x: 2100, y: 6350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ProjectSettingsFileDto", logical: "ProjectSettingsFileDto", description: "プロジェクトの .claude/ 配下の設定ファイルの選択。app::ProjectSettingsFile へ変換(From)" },
    stereotype: "enumeration",
    attributes: ["Settings", "SettingsLocal"].map(label),
    position: { x: 2500, y: 6350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "AppWarningDto", logical: "AppWarningDto", description: "app:warning イベントのペイロード。送信前チェックと実行の間に別セッションが割り込んだ可能性を通知する" },
    attributes: [
      attr("project", "String"),
      attr("expected_session_id", "String"),
      attr("actual_session_id", "String"),
    ],
    position: { x: 2900, y: 6350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ 設定・プロファイル ============
  {
    name: { physical: "GithubProjectDto", logical: "GithubProjectDto", description: "domain::GithubProject と相互変換(From 両方向)" },
    attributes: [attr("owner", "String"), attr("number", "u32")],
    position: { x: 2100, y: 6750 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ProfileSummaryDto", logical: "ProfileSummaryDto", description: "プロファイル一覧に出す最小限の情報" },
    attributes: [attr("id", "String"), attr("name", "String")],
    position: { x: 2500, y: 7100 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "SettingsDto", logical: "SettingsDto", description: "get_settings の戻り値。アクティブプロファイルの内容をフラットに展開する" },
    attributes: [
      attr("active_profile_id", "String"),
      attr("profiles", "Vec<ProfileSummaryDto>"),
      attr("repository_path", "Option<String>"),
      attr("github_project", "Option<GithubProjectDto>"),
      attr("selected_project_folders", "Vec<String>"),
      attr("claude_projects_dir", "Option<String>"),
      attr("effective_projects_dir", "String"),
    ],
    position: { x: 2100, y: 7100 },
    filePath: "apps/native/tauri/src/dto.rs",
    // 名前と型の列が重なるので広げる(classes-native-prototype.ts の size の説明を参照)。
    size: { w: 280, h: 0 },
  },
  {
    name: { physical: "SettingsInputDto", logical: "SettingsInputDto", description: "update_settings の引数。version・プロファイルの新規作成等は別コマンドで扱う" },
    attributes: [
      attr("repository_path", "Option<String>"),
      attr("github_project", "Option<GithubProjectDto>"),
      attr("selected_project_folders", "Vec<String>"),
      attr("claude_projects_dir", "Option<String>"),
    ],
    position: { x: 2900, y: 6750 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 260, h: 0 },
  },
  // ============ ファイル編集・Rules/Skills ============
  {
    name: { physical: "ClaudeMdDto", logical: "ClaudeMdDto", description: "get_project_claude_md/get_user_claude_md の戻り値。Option<domain::ClaudeMdFile> から変換(From)" },
    attributes: [attr("content", "Option<String>"), attr("modified_at_ms", "Option<u64>")],
    position: { x: 2100, y: 7500 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ClaudeSettingsDto", logical: "ClaudeSettingsDto", description: "get_claude_settings_file の戻り値。Option<domain::ClaudeSettingsFile> から変換(From)" },
    attributes: [attr("content", "Option<String>"), attr("modified_at_ms", "Option<u64>")],
    position: { x: 2500, y: 7500 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "RuleSummaryDto", logical: "RuleSummaryDto", description: "list_rules の1件分。domain::RuleSummary から変換(From)" },
    attributes: [attr("file_name", "String"), attr("modified_at_ms", "u64")],
    position: { x: 2900, y: 7500 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "RuleDto", logical: "RuleDto", description: "get_rule の戻り値" },
    attributes: [attr("content", "String")],
    position: { x: 3300, y: 7500 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "SkillSummaryDto", logical: "SkillSummaryDto", description: "list_skills の1件分。domain::SkillSummary から変換(From)" },
    attributes: [attr("name", "String"), attr("modified_at_ms", "u64")],
    position: { x: 2100, y: 7850 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "SkillDto", logical: "SkillDto", description: "get_skill の戻り値" },
    attributes: [attr("content", "String")],
    position: { x: 2500, y: 7850 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "SettingsCorruptedEventDto", logical: "SettingsCorruptedEventDto", description: "settings:corrupted イベントのペイロード。設定ファイルの破損からの復旧を通知する" },
    attributes: [attr("message", "String")],
    position: { x: 2900, y: 7850 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ GitHub連携 ============
  {
    name: { physical: "DeviceCodeDto", logical: "DeviceCodeDto", description: "github_login_start の戻り値。トークンは含めない(native.md §4)。app::DeviceAuthorization から変換(From)" },
    attributes: [attr("user_code", "String"), attr("verification_uri", "String")],
    position: { x: 2100, y: 8250 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "GithubAuthStatusDto", logical: "GithubAuthStatusDto", description: "get_github_auth_status の戻り値" },
    attributes: [attr("authenticated", "bool"), attr("login", "Option<String>")],
    position: { x: 2500, y: 8250 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "GithubProjectSummaryDto", logical: "GithubProjectSummaryDto", description: "GitHub Projects(v2) 一覧の1件分。domain::GithubProjectSummary から変換(From)" },
    attributes: [
      attr("number", "u32"),
      attr("title", "String"),
      attr("closed", "bool"),
    ],
    position: { x: 2900, y: 8250 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "GithubAuthenticatedEventDto", logical: "GithubAuthenticatedEventDto", description: "github:authenticated イベントのペイロード。ログイン名のみ(トークンは含めない)" },
    attributes: [attr("login", "String")],
    position: { x: 3300, y: 8250 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "GithubAuthFailedEventDto", logical: "GithubAuthFailedEventDto", description: "github:auth_failed イベントのペイロード。デバイスフローのタイムアウト・拒否・エラーを通知する" },
    attributes: [attr("message", "String")],
    position: { x: 3700, y: 8250 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ProjectItemsPageDto", logical: "ProjectItemsPageDto", description: "list_github_project_items の戻り値。domain::ProjectItemsPage から変換(From)" },
    attributes: [
      attr("project_id", "String"),
      attr("status_field_id", "Option<String>"),
      attr("items", "Vec<ProjectItemDto>"),
      attr("next_cursor", "Option<String>"),
      attr("status_options", "Vec<ProjectStatusOptionDto>"),
    ],
    position: { x: 2100, y: 8600 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "ProjectItemDto", logical: "ProjectItemDto", description: "GitHub Projects(v2) の1アイテム。domain::ProjectItem から変換(From)" },
    attributes: [
      attr("id", "String"),
      attr("title", "String"),
      attr("kind", "ProjectItemKindDto"),
      attr("repository", "Option<String>"),
      attr("number", "Option<u32>"),
      attr("assignees", "Vec<String>"),
      attr("status", "Option<String>"),
      attr("url", "Option<String>"),
    ],
    position: { x: 2500, y: 8600 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ProjectStatusOptionDto", logical: "ProjectStatusOptionDto", description: "Status フィールドの選択肢(かんばんのカラム定義)。domain::ProjectStatusOption から変換(From)" },
    attributes: [attr("id", "String"), attr("name", "String")],
    position: { x: 2100, y: 8950 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ProjectItemKindDto", logical: "ProjectItemKindDto", description: "GitHub Projects(v2) アイテムの種別。domain::ProjectItemKind から変換(From)" },
    stereotype: "enumeration",
    attributes: ["Issue", "PullRequest", "DraftIssue"].map(label),
    position: { x: 2500, y: 8950 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ エラー ============
  {
    name: { physical: "AppErrorDto", logical: "AppErrorDto", description: "command の戻り値のエラー。app::AppError から変換(From)。フロントは message ではなく code で分岐する(native.md §3.4)" },
    attributes: [attr("code", "String"), attr("message", "String")],
    position: { x: 2100, y: 9350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ ウィンドウ・ハブ ============
  {
    name: { physical: "WindowStateDto", logical: "WindowStateDto", description: "list_window_states の1件分。domain::WindowState から変換(From)" },
    attributes: [
      attr("label", "String"),
      attr("tabs", "Vec<WindowTabDto>"),
      attr("active_tab_index", "usize"),
    ],
    position: { x: 2500, y: 9350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "WindowTabDto", logical: "WindowTabDto", description: "ウィンドウ内の1タブの表示状態。domain::WindowTab と相互変換(From 両方向)" },
    attributes: [
      attr("profile_id", "String"),
      attr("session_id", "Option<String>"),
      attr("session_title", "Option<String>"),
    ],
    position: { x: 2900, y: 9350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "HubLayoutDto", logical: "HubLayoutDto", description: "get_hub_layout の戻り値。domain::HubLayout から変換(From)。version はフロントで使わないため含めない" },
    attributes: [attr("positions", "HashMap<String, NodePositionDto>")],
    position: { x: 3300, y: 9350 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "NodePositionDto", logical: "NodePositionDto", description: "ハブグラフのノード1件分の座標。domain::NodePosition と相互変換(From 両方向)" },
    attributes: [attr("x", "f64"), attr("y", "f64")],
    position: { x: 3700, y: 9350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ /claude 画面(Explorer) ============
  {
    name: { physical: "ClaudeDirPageDto", logical: "ClaudeDirPageDto", description: "list_claude_dir の戻り値。domain::ClaudeDirPage から変換(From)" },
    attributes: [attr("entries", "Vec<ClaudeDirEntryDto>"), attr("total", "usize")],
    position: { x: 2100, y: 9750 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 230, h: 0 },
  },
  {
    name: { physical: "ClaudeDirEntryDto", logical: "ClaudeDirEntryDto", description: "list_claude_dir の1件分。domain::ClaudeDirEntry から変換(From)" },
    attributes: [
      attr("name", "String"),
      attr("path", "String"),
      attr("kind", "ClaudeDirEntryKindDto"),
      attr("size_bytes", "Option<u64>"),
      attr("modified_at_ms", "u64"),
    ],
    position: { x: 2500, y: 9750 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "ClaudeDirEntryKindDto", logical: "ClaudeDirEntryKindDto", description: "~/.claude 配下のエントリ種別。domain::ClaudeDirEntryKind から変換(From)" },
    stereotype: "enumeration",
    attributes: ["Directory", "File", "Symlink"].map(label),
    position: { x: 2500, y: 10100 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ アプリ状態 ============
  {
    name: { physical: "AppState", logical: "AppState", description: "アプリの唯一の真実(SSoT)。tauri::State<tokio::sync::Mutex<AppState>> として管理する(native.md §2)" },
    attributes: [
      // domain::Settings(classes-native-prototype.ts の Settings)そのもの。線は引かない(冒頭コメントを参照)。
      attr("settings", "domain::Settings"),
      attr("save_path", "PathBuf"),
      attr("github_login", "Option<String>"),
      // app::WindowRegistry。この図にも他の図にも無い型なので線は引かない。
      attr("window_states", "app::WindowRegistry"),
      // domain::Pc(classes-domain.ts の Pc)そのもの。線は引かない(冒頭コメントを参照)。
      attr("pc", "domain::Pc"),
      // domain::GitLedger。この図にも他の図にも無い型なので線は引かない。
      attr("git_ledger", "domain::GitLedger"),
      attr("git_ledger_path", "PathBuf"),
      // 走査で読んだ、会話ファイル単位の結果(domain::ParsedSession。classes-native-prototype.ts)。
      // 以前は Vec<domain::Session> だったが、Session の組み立て(User::load_sessions)は
      // 呼び出しのたびに行い、ここには走査の結果を保持する形に変わっている。線は引かない。
      attr("user_sessions", "Vec<domain::ParsedSession>"),
      // 遅延読み込みした LogLine(セッションを開いたときに構築。issue #207)。
      attr("loaded_log_lines", "HashMap<PathBuf, Vec<domain::LogLine>>"),
      // 読み込んだメッセージのキャッシュ(app::CachedMessages。この図にも他の図にも無い型なので線は引かない)。
      attr("loaded_messages", "HashMap<PathBuf, app::CachedMessages>"),
      // app が起動した実行中セッション(issue #391)。終了しても、次に起動して置き換えるまで
      // 終了状態のまま残す(画面が終了を知るため)。ランタイム状態で保存しない。
      attr("running_session", "Option<RunningSessionSlot>"),
      // 起動している最中か(起動は数秒かかりうるため、その間にもう1つ起動されないようにする)。
      attr("running_session_starting", "bool"),
      // 実行中セッションの世代番号(起動のたびに増やす)。
      attr("running_session_generation", "u64"),
      attr("pc_data_loaded", "bool"),
      attr("session_scan_generation", "u64"),
      // app::RescanQueue(この図にも他の図にも無い型なので線は引かない)。
      attr("session_rescan", "app::RescanQueue"),
    ],
    position: { x: 2100, y: 10500 },
    filePath: "apps/native/tauri/src/state.rs",
    // Tauri の状態管理・ローカルAPIサーバの実行に属する(フレームワーク側)。
    layer: "framework",
    size: { w: 620, h: 0 },
  },
  {
    name: { physical: "LoadResult", logical: "LoadResult", description: "AppState::load の結果。設定ファイルの破損から復旧したかどうかを呼び出し側(run())が判定するのに使う" },
    attributes: [attr("recovered_from_corruption", "bool")],
    position: { x: 2900, y: 10500 },
    filePath: "apps/native/tauri/src/state.rs",
    // Tauri の状態管理・ローカルAPIサーバの実行に属する(フレームワーク側)。
    layer: "framework",
    size: { w: 220, h: 0 },
  },
  // ============ ローカルAPI ============
  {
    name: { physical: "LocalApiState", logical: "LocalApiState", description: "ローカルAPIサーバ(native.md §7)のハンドラが共有する状態。既存の tauri::State<Mutex<AppState>> を app_handle 経由で参照する" },
    attributes: [
      attr("app_handle", "tauri::AppHandle"),
      attr("token", "Arc<String>"),
      attr("version", "Arc<String>"),
    ],
    position: { x: 2100, y: 10900 },
    filePath: "apps/native/tauri/src/local_api.rs",
    // Tauri の状態管理・ローカルAPIサーバの実行に属する(フレームワーク側)。
    layer: "framework",
    size: { w: 220, h: 0 },
  },
  {
    name: { physical: "HealthResponseDto", logical: "HealthResponseDto", description: "GET /health の応答" },
    attributes: [attr("ok", "bool"), attr("version", "String")],
    position: { x: 2500, y: 10900 },
    filePath: "apps/native/tauri/src/local_api.rs",
  },
  {
    name: { physical: "SaveLayoutRequestDto", logical: "SaveLayoutRequestDto", description: "POST /layout/{diagram} のリクエストボディ" },
    attributes: [attr("repo_root", "String"), attr("overrides", "Value")],
    position: { x: 2900, y: 10900 },
    filePath: "apps/native/tauri/src/local_api.rs",
  },
  // ============ PC・ユーザー・Git・セッション(第1〜4弾) ============
  {
    name: { physical: "PcDto", logical: "PcDto", description: "get_pc の戻り値(オブジェクトモデル実装 第1弾。issue #182)。domain::Pc から変換(From)" },
    attributes: [
      attr("system_uuid", "String"),
      attr("pc_name", "String"),
      attr("description", "String"),
      attr("users", "Vec<UserDto>"),
    ],
    position: { x: 2100, y: 11300 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "UserDto", logical: "UserDto", description: "get_pc の1ユーザー分(オブジェクトモデル実装 第1弾。issue #182)。domain::User から変換(From)" },
    attributes: [
      attr("user_id", "String"),
      attr("user_name", "String"),
      attr("home_directory", "String"),
      attr("repositories", "Vec<GitRepositoryDto>"),
      attr("sessions", "Vec<SessionDto>"),
    ],
    position: { x: 2100, y: 11650 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 230, h: 0 },
  },
  {
    name: { physical: "SessionDto", logical: "SessionDto", description: "User.sessions の1件分(オブジェクトモデル実装 第4弾。issue #197)。domain::Session から変換(From)。旧 SessionDto(会話内容の入れ物)は issue #197 で ConversationDto に改名済み" },
    attributes: [
      attr("session_id", "String"),
      attr("custom_title", "Option<String>"),
      attr("ai_title", "Option<String>"),
      attr("mode", "Option<String>"),
      attr("slug", "Option<String>"),
      attr("last_prompt", "Option<String>"),
    ],
    position: { x: 2500, y: 11650 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  {
    name: { physical: "GitRepositoryDto", logical: "GitRepositoryDto", description: "get_pc の1ユーザーが所有するリポジトリ1件分(オブジェクトモデル実装 第2〜3弾。issue #189/#193)。domain::GitRepository から変換(From)。削除済みの branch/worktree は変換時に除外する" },
    attributes: [
      attr("repository_path", "String"),
      attr("repository_name", "String"),
      attr("description", "String"),
      attr("branches", "Vec<GitBranchDto>"),
      attr("worktrees", "Vec<GitWorktreeDto>"),
    ],
    position: { x: 2100, y: 12000 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 225, h: 0 },
  },
  {
    name: { physical: "GitWorktreeDto", logical: "GitWorktreeDto", description: "GitRepository.worktrees の1件分(issue #193)。domain::GitWorktree から変換(From)。checked_out_branch は GitBranch.branch_id(未解決・detached なら null)" },
    attributes: [
      attr("worktree_id", "String"),
      attr("worktree_name", "String"),
      attr("description", "String"),
      attr("worktree_folder_path", "String"),
      attr("worktree_git_file_path", "String"),
      attr("created_at_time", "u64"),
      attr("checked_out_branch", "Option<String>"),
    ],
    position: { x: 2500, y: 12000 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 260, h: 0 },
  },
  {
    name: { physical: "GitBranchDto", logical: "GitBranchDto", description: "GitRepository.branches の1件分(issue #193)。domain::GitBranch から変換(From)。このDTO自体は現存するブランチのみを表す(deleted_at_time を持たない)" },
    attributes: [
      attr("branch_id", "String"),
      attr("branch_name", "String"),
      attr("description", "String"),
      attr("created_at_time", "u64"),
    ],
    position: { x: 2100, y: 12350 },
    filePath: "apps/native/tauri/src/dto.rs",
  },
  // ============ 実行中セッション(Phase 1。issue #391) ============
  // command(start_running_session / get_running_session / send_to_running_session /
  // respond_permission / interrupt_running_session / stop_running_session。running_session.rs)は
  // 関数で、この図にはこれまでも描いていない(型だけを描く)。途中経過は Channel(ProgressEventDto)、
  // 状態変化・権限の問い合わせの到着/決着は軽量イベント `running-session:changed`
  // (RunningSessionChangedEventDto)+ get_running_session(RunningSessionDto)で取り直す。
  {
    name: { physical: "RunningSessionChangedEventDto", logical: "RunningSessionChangedEventDto", description: "running-session:changed イベントのペイロード(軽量な通知。本体は get_running_session で取り直す)" },
    attributes: [
      attr("session_id", "String"),
      attr("process_state", "ProcessStateDto"),
      attr("pending_permission_count", "usize"),
      attr("exit_code", "Option<i32>"),
    ],
    position: { x: 4300, y: 5200 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "ProcessStateDto", logical: "ProcessStateDto", description: "domain::ProcessState から変換(From)。serde は snake_case" },
    stereotype: "enumeration",
    attributes: ["Starting", "Idle", "Running", "AwaitingPermission", "Exited"].map(label),
    position: { x: 4800, y: 5200 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 240, h: 0 },
  },
  {
    name: { physical: "RunningSessionDto", logical: "RunningSessionDto", description: "get_running_session の戻り値。domain::RunningSessionByApp から変換(RunningSessionDto::from_session。project は呼び出し側が渡す)。base(RunningSession)の一部(session_id・pid・started_at・cwd)だけを平らに出す" },
    attributes: [
      attr("project", "String"),
      attr("session_id", "String"),
      attr("pid", "u32"),
      attr("started_at", "u64"),
      attr("cwd", "Option<String>"),
      attr("process_state", "ProcessStateDto"),
      attr("process_state_at", "u64"),
      attr("permission_requests", "Vec<PermissionRequestDto>"),
    ],
    position: { x: 5300, y: 5200 },
    filePath: "apps/native/tauri/src/dto.rs",
    // 名前と型の列が重なるので広げる(classes-native-prototype.ts の size の説明を参照)。
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "PermissionRequestKindDto", logical: "PermissionRequestKindDto", description: "domain::PermissionRequestKind から変換(From)。serde は snake_case" },
    stereotype: "enumeration",
    attributes: ["ToolUse", "AskUserQuestion", "ExitPlanMode"].map(label),
    position: { x: 4800, y: 5700 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 250, h: 0 },
  },
  {
    name: { physical: "PermissionRequestDto", logical: "PermissionRequestDto", description: "domain::PermissionRequest から変換(From)。blocked_path は文字列、request_kind は request_kind() の結果。tool_input は JSON のまま" },
    attributes: [
      attr("request_id", "String"),
      attr("tool_name", "String"),
      attr("display_name", "Option<String>"),
      attr("description", "Option<String>"),
      attr("tool_use_id", "String"),
      attr("tool_input", "serde_json::Value"),
      attr("blocked_path", "Option<String>"),
      attr("requested_at", "u64"),
      attr("request_kind", "PermissionRequestKindDto"),
      attr("suggestions", "Vec<PermissionSuggestionDto>"),
    ],
    position: { x: 5300, y: 5700 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 440, h: 0 },
  },
  {
    name: { physical: "PermissionSuggestionDto", logical: "PermissionSuggestionDto", description: "domain::PermissionSuggestion と相互変換(From 両方向。応答の updated_permissions に問い合わせの提案から選んで返す)" },
    attributes: [
      attr("suggestion_type", "String"),
      attr("suggestion_destination", "String"),
      attr("suggestion_content", "serde_json::Value"),
    ],
    position: { x: 5300, y: 6250 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 440, h: 0 },
  },
  {
    name: { physical: "RunningPermissionModeDto", logical: "RunningPermissionModeDto", description: "start_running_session の引数(フロント→Rust なので Deserialize)。app::RunningPermissionMode へ変換(From)。serde は snake_case" },
    stereotype: "enumeration",
    attributes: ["Plan", "Default"].map(label),
    position: { x: 4300, y: 6700 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 240, h: 0 },
  },
  {
    name: { physical: "PermissionBehaviorDto", logical: "PermissionBehaviorDto", description: "respond_permission の引数(フロント→Rust なので Deserialize)。app::PermissionDecision の組み立てに使う。取り消しは CLI 側が決めるもので、画面からは選べない" },
    stereotype: "enumeration",
    attributes: ["Allow", "Deny"].map(label),
    position: { x: 4650, y: 6700 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 240, h: 0 },
  },
  {
    name: { physical: "ProgressEventDto", logical: "ProgressEventDto", description: "途中経過の Channel のペイロード(順序どおりに届く)。domain::ProgressEvent から変換(From)。serde は tag = \"kind\"、snake_case" },
    stereotype: "enumeration",
    attributes: [
      "TextDelta { text: String }",
      "ToolStarted { tool_use_id: String, tool_name: String }",
      "ToolResultArrived { tool_use_id: String, is_error: bool }",
      "TurnFinished { succeeded: bool }",
      "SentLineConfirmed { uuid: String }",
    ].map(label),
    position: { x: 5000, y: 6700 },
    filePath: "apps/native/tauri/src/dto.rs",
    size: { w: 470, h: 0 },
  },
  {
    name: { physical: "RunningSessionSlot", logical: "RunningSessionSlot", description: "app が起動して持っている実行中セッション(state.rs。issue #391)。Phase 1 は同時に1つ。AppState.running_session に入る。session は domain::RunningSessionByApp、process は app::RunningProcess(どちらも別の図の離れた位置にあるため線は引かない)" },
    attributes: [
      attr("project", "String"), // 会話ファイルのあるプロジェクトフォルダ名
      // 何番目に起動したか。読み取りの出来事は起動した世代のものだけを反映する(次の起動の状態を、
      // 前のプロセスの遅れて届いた出来事で動かさない)。
      attr("generation", "u64"),
      attr("session", "domain::RunningSessionByApp"),
      attr("process", "Arc<dyn app::RunningProcess>"),
    ],
    position: { x: 4300, y: 7200 },
    filePath: "apps/native/tauri/src/state.rs",
    // Tauri の状態管理に属する(フレームワーク側)。
    layer: "framework",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "ChannelSink", logical: "ChannelSink", description: "RunningSessionEventSink の実装(running_session.rs。private)。読み取りスレッドから、順序を保ったまま tauri 層の処理タスクへ出来事を渡す受け口。受け側が終わっていれば捨てる。port(RunningSessionEventSink)は classes-infra.ts にあり、離れた位置にあるため実現の線は引かない" },
    attributes: [attr("0", "mpsc::UnboundedSender<RunningSessionEvent>")], // タプル構造体(第0フィールド)
    position: { x: 4850, y: 7200 },
    filePath: "apps/native/tauri/src/running_session.rs",
    size: { w: 460, h: 0 },
  },
];

// 既定はインターフェイスアダプター(DTO・コマンドの入出力)。Tauri 本体に属する状態などだけ
// layer を書く。
const { classes, rel, filePaths, layers } = defineDiagram(DEFS, {
  layerOf: () => "adapter",
});

const RELATIONSHIPS = [
  // セッション閲覧(AgentKindDto に3クラスから集まるので角度で分ける)
  rel("composition", "ProjectDto", "AgentKindDto", "agent", "top", 40),
  rel("composition", "ConversationDto", "AgentKindDto", "agent", "top", 355),
  rel("composition", "SessionChangedEventDto", "AgentKindDto", "agent", "top", 315),
  rel("association", "ConversationDto", "MessageDto", "messages", "bottom", "top"),
  rel("composition", "MessageDto", "RoleDto", "role", "right", "left"),
  // 設定・プロファイル(2x2 に並べ、3本とも縦横だけで結ぶ)
  rel("association", "SettingsDto", "GithubProjectDto", "github_project", "top", "bottom"),
  rel("association", "SettingsDto", "ProfileSummaryDto", "profiles", "right", "left"),
  rel("association", "SettingsInputDto", "GithubProjectDto", "github_project", "left", "right"),
  // GitHub連携(Projects v2)
  rel("composition", "ProjectItemDto", "ProjectItemKindDto", "kind", "bottom", "top"),
  rel("association", "ProjectItemsPageDto", "ProjectItemDto", "items", "right", "left"),
  rel("association", "ProjectItemsPageDto", "ProjectStatusOptionDto", "status_options", "bottom", "top"),
  // ウィンドウ・ハブ
  rel("association", "WindowStateDto", "WindowTabDto", "tabs", "right", "left"),
  rel("association", "HubLayoutDto", "NodePositionDto", "positions", "right", "left"),
  // /claude 画面(Explorer)
  rel("association", "ClaudeDirPageDto", "ClaudeDirEntryDto", "entries", "right", "left"),
  rel("composition", "ClaudeDirEntryDto", "ClaudeDirEntryKindDto", "kind", "bottom", "top"),
  // アプリ状態
  rel("composition", "LoadResult", "AppState", "state", "left", "right"),
  // PC・ユーザー・Git・セッション(第1〜4弾)
  rel("association", "PcDto", "UserDto", "users", "bottom", "top"),
  rel("association", "UserDto", "SessionDto", "sessions", "right", "left"),
  rel("association", "UserDto", "GitRepositoryDto", "repositories", "bottom", "top"),
  rel("association", "GitRepositoryDto", "GitWorktreeDto", "worktrees", "right", "left"),
  rel("association", "GitRepositoryDto", "GitBranchDto", "branches", "bottom", "top"),
  // 実行中セッション(Phase 1)。enum は値として持つのでコンポジション(線は「部分 → 全体」の向き)。
  rel("composition", "ProcessStateDto", "RunningSessionChangedEventDto", "process_state", "left", "right"),
  rel("composition", "ProcessStateDto", "RunningSessionDto", "process_state", "right", "left"),
  rel("association", "RunningSessionDto", "PermissionRequestDto", "permission_requests", "bottom", "top"),
  rel("composition", "PermissionRequestKindDto", "PermissionRequestDto", "request_kind", "right", "left"),
  rel("association", "PermissionRequestDto", "PermissionSuggestionDto", "suggestions", "bottom", "top"),
];

export const TAURI_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};

export const TAURI_CLASS_FILE_PATHS = filePaths;
export const TAURI_CLASS_LAYERS: ClassLayers = layers;
