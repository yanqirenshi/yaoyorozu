/**
 * apps/native の domain クレート(`crates/domain/src/`)に実装済みの、
 * まだオブジェクトモデル(`classes-domain.ts`)へ置き換えられていない型
 * (プロトタイプ期の型)のクラス図。
 *
 * 【目的】`classes-domain.ts` は TM を元にした設計側の図で、まだ実装されて
 * いない型も含む。こちらは逆に、domain クレートに現に実装されている型を、
 * コードと1対1で対応する形でそのまま写した図("as-is" のスナップショット)。
 * フィールド・型は Rust のソースをそのまま書き写し、意味づけの解釈は加えない。
 *
 * 【書き方】
 * - フィールドは Rust の宣言順・型をそのまま `attr()` に写す。
 * - フィールドの型が図中の別のクラス(enum を含む)を指すときだけ関係線を引く。
 *   - 必須(`Option` でない)・単数(`Vec`/`HashMap` でない)の struct/enum
 *     フィールド → コンポジション(その型を値として持つ。ラベルはフィールド名)。
 *   - `Option<T>`、`Vec<T>`、`HashMap<K, T>` の struct/enum フィールド
 *     → 関連(ラベルはフィールド名)。
 *   - `String`・`PathBuf`・`Value`・プリミティブ型のフィールド(`*_id: String`
 *     のような、意味的には他の型を指すが Rust の型としては単なる文字列の
 *     フィールドを含む)は関係線を引かない。コードにそのまま対応させるため、
 *     型注釈からは読み取れない関係(IDによる参照など)を図だけの判断で
 *     描き足さない。
 * - `session_line/`(`classes-session-line.ts`)と違い、tag 付き enum の
 *   バリアント分岐(依存関係)は無い(該当する型が無いため)。
 *
 * 【対象・ファイル対応】native.md §1 の「1型(クラス)= 1ファイル」(issue #184、
 * PR #185)により、domain クレートは各型が型名 snake_case のファイルに分かれて
 * いる(例: `Profile` → `profile.rs`)。`lib.rs` は `mod` 宣言と `pub use` のみ。
 * 本図の25クラスのうち、`ProjectItemKind` は `ProjectItem` と同じ `project_item.rs`
 * に、`ClaudeDirEntryKind` は `ClaudeDirEntry` と同じ `claude_dir_entry.rs` に
 * 同居する(native.md 曰く「その型専用の小さな補助enum」)。ほかの23クラスは
 * それぞれ単独のファイル(型名 snake_case)。掲載対象は `classes-domain.ts` に
 * 掲載済みの Pc・User と、`session_line/`(`classes-session-line.ts`)の33型を
 * 除いたもの。
 *
 * 【Conversation(旧 Session)】オブジェクトモデル実装 第4弾(issue #197、
 * PR #199)で、クラス図のオブジェクトモデル側の `Session`(セッションリソース。
 * session_id/custom_title/ai_title/mode/slug/last_prompt)が `session.rs` に
 * 実装され、`User` にコンポジションで所有されるようになった(`User.sessions`)。
 * これに伴い、このプロトタイプ側の型(id/messages/agent。ビューアに表示する
 * 会話内容そのものの入れ物)は名前がぶつからないよう `Conversation` に改名
 * された(`conversation.rs`)。以前はここを `SessionPrototype` という表記で
 * 描いていたが、実装側の改名で本来の型名のまま描けるようになったため、
 * この図でも `Conversation` に改めた。第5〜6弾(SessionFile/LogLine)の実装後、
 * ビューアがそちらのモデルへ移行すれば、この型と `Message` は退役する見込み。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import {
  attr,
  defineDiagram,
  label,
  type ClassDef,
  type ClassFilePaths,
} from "./classDiagram";

const DEFS: ClassDef[] = [
  // ============ セッション閲覧(プロトタイプ) ============
  {
    name: { physical: "AgentKind", logical: "AgentKind", description: "会話を生成しているエージェントの種類。将来 Gemini/Codex 等を追加予定(値は当面 ClaudeCode のみ)" },
    stereotype: "enumeration",
    attributes: ["ClaudeCode"].map(label),
    position: { x: 2100, y: -150 },
    filePath: "apps/native/crates/domain/src/agent_kind.rs",
  },
  {
    name: { physical: "Project", logical: "Project", description: "プロジェクト(フォルダ)一覧の1件" },
    attributes: [
      attr("name", "String"),
      attr("updated_at_ms", "u64"),
      attr("agent", "AgentKind"),
    ],
    position: { x: 2450, y: -150 },
    filePath: "apps/native/crates/domain/src/project.rs",
  },
  {
    name: { physical: "Conversation", logical: "Conversation", description: "ビューアに表示する会話内容(メッセージ列)の入れ物(.jsonl 1ファイル分)。旧 Session(名前の重なりは冒頭コメントを参照)" },
    attributes: [
      attr("id", "String"),
      attr("messages", "Vec<Message>"),
      attr("agent", "AgentKind"),
    ],
    position: { x: 2100, y: 150 },
    filePath: "apps/native/crates/domain/src/conversation.rs",
  },
  {
    name: { physical: "Message", logical: "Message", description: "1件の会話メッセージ" },
    attributes: [
      attr("role", "Role"),
      attr("text", "String"),
      attr("timestamp", "String"),
    ],
    position: { x: 2450, y: 150 },
    filePath: "apps/native/crates/domain/src/message.rs",
  },
  {
    name: { physical: "Role", logical: "Role", description: "メッセージの発言者種別" },
    stereotype: "enumeration",
    attributes: ["User", "Assistant"].map(label),
    position: { x: 2450, y: 450 },
    filePath: "apps/native/crates/domain/src/role.rs",
  },
  {
    name: { physical: "SessionSummary", logical: "SessionSummary", description: "セッション一覧(ビューア左ペイン)表示用の1件分。issue #33 / #104" },
    attributes: [
      attr("id", "String"),
      attr("title", "String"),
      attr("modified_at_ms", "u64"),
      attr("is_latest", "bool"),
      attr("cwd", "Option<String>"),
      attr("git_branch", "Option<String>"),
    ],
    position: { x: 2100, y: 450 },
    filePath: "apps/native/crates/domain/src/session_summary.rs",
  },
  // ============ 設定・プロファイル ============
  {
    name: { physical: "Settings", logical: "Settings", description: "アプリの設定。issue #72" },
    attributes: [
      attr("version", "u32"),
      attr("profiles", "Vec<Profile>"),
      attr("active_profile_id", "String"),
      attr("claude_projects_dir", "Option<PathBuf>"),
    ],
    position: { x: 2950, y: -150 },
    filePath: "apps/native/crates/domain/src/settings.rs",
    // 名前と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 240, h: 0 },
  },
  {
    name: { physical: "Profile", logical: "Profile", description: "対象リポジトリ・GitHubプロジェクト・対象フォルダの組。issue #72" },
    attributes: [
      attr("id", "String"),
      attr("name", "String"),
      attr("repository_path", "Option<PathBuf>"),
      attr("github_project", "Option<GithubProject>"),
      attr("selected_project_folders", "Vec<String>"),
    ],
    position: { x: 3300, y: -150 },
    filePath: "apps/native/crates/domain/src/profile.rs",
    // 名前と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 250, h: 0 },
  },
  {
    name: { physical: "GithubProject", logical: "GithubProject", description: "永続化される GitHub プロジェクトの参照(owner + number)" },
    attributes: [attr("owner", "String"), attr("number", "u32")],
    position: { x: 3300, y: 150 },
    filePath: "apps/native/crates/domain/src/github_project.rs",
  },
  {
    name: { physical: "GithubProjectSummary", logical: "GithubProjectSummary", description: "GitHub Projects(v2)の一覧表示用サマリ。GithubProject とは別の読み取り専用の値" },
    attributes: [
      attr("number", "u32"),
      attr("title", "String"),
      attr("closed", "bool"),
    ],
    position: { x: 2950, y: 150 },
    filePath: "apps/native/crates/domain/src/github_project_summary.rs",
  },
  // ============ GitHub連携(Projects v2) ============
  {
    name: { physical: "ProjectItemsPage", logical: "ProjectItemsPage", description: "GitHub Projects(v2)アイテム一覧の1ページ分。issue #50" },
    attributes: [
      attr("project_id", "String"),
      attr("status_field_id", "Option<String>"),
      attr("items", "Vec<ProjectItem>"),
      attr("next_cursor", "Option<String>"),
      attr("status_options", "Vec<ProjectStatusOption>"),
    ],
    position: { x: 2100, y: 750 },
    filePath: "apps/native/crates/domain/src/project_items_page.rs",
    // 名前と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 270, h: 0 },
  },
  {
    name: { physical: "ProjectItem", logical: "ProjectItem", description: "GitHub Projects(v2)の1アイテム。issue #34 / #50" },
    attributes: [
      attr("id", "String"),
      attr("title", "String"),
      attr("kind", "ProjectItemKind"),
      attr("repository", "Option<String>"),
      attr("number", "Option<u32>"),
      attr("assignees", "Vec<String>"),
      attr("status", "Option<String>"),
      attr("url", "Option<String>"),
    ],
    position: { x: 2450, y: 750 },
    filePath: "apps/native/crates/domain/src/project_item.rs",
  },
  {
    name: { physical: "ProjectStatusOption", logical: "ProjectStatusOption", description: "GitHub Projects(v2)のStatusフィールドの選択肢。issue #50" },
    attributes: [attr("id", "String"), attr("name", "String")],
    position: { x: 2100, y: 1050 },
    filePath: "apps/native/crates/domain/src/project_status_option.rs",
  },
  {
    name: { physical: "ProjectItemKind", logical: "ProjectItemKind", description: "GitHub Projects(v2)アイテムの種別。issue #34" },
    stereotype: "enumeration",
    attributes: ["Issue", "PullRequest", "DraftIssue"].map(label),
    position: { x: 2450, y: 1050 },
    filePath: "apps/native/crates/domain/src/project_item.rs",
  },
  // ============ ファイル編集 ============
  {
    name: { physical: "ClaudeMdFile", logical: "ClaudeMdFile", description: "リポジトリ直下(または作業ディレクトリ直下)の CLAUDE.md の内容。issue #27" },
    attributes: [attr("content", "String"), attr("modified_at_ms", "u64")],
    position: { x: 2950, y: 750 },
    filePath: "apps/native/crates/domain/src/claude_md_file.rs",
  },
  {
    name: { physical: "ClaudeSettingsFile", logical: "ClaudeSettingsFile", description: "~/.claude/settings.json の内容。issue #53" },
    attributes: [attr("content", "String"), attr("modified_at_ms", "u64")],
    position: { x: 3300, y: 750 },
    filePath: "apps/native/crates/domain/src/claude_settings_file.rs",
  },
  // ============ Rules / Skills ============
  {
    name: { physical: "RuleSummary", logical: "RuleSummary", description: ".claude/rules/ 配下のルールファイル1件分のサマリ。issue #61" },
    attributes: [attr("file_name", "String"), attr("modified_at_ms", "u64")],
    position: { x: 2950, y: 1050 },
    filePath: "apps/native/crates/domain/src/rule_summary.rs",
  },
  {
    name: { physical: "SkillSummary", logical: "SkillSummary", description: ".claude/skills/<name>/SKILL.md 1件分のサマリ。issue #65" },
    attributes: [attr("name", "String"), attr("modified_at_ms", "u64")],
    position: { x: 3300, y: 1050 },
    filePath: "apps/native/crates/domain/src/skill_summary.rs",
  },
  // ============ ウィンドウ・ハブ ============
  {
    name: { physical: "WindowState", logical: "WindowState", description: "1つのウィンドウの表示状態(ハブ化 その1)。issue #83" },
    attributes: [
      attr("label", "String"),
      attr("tabs", "Vec<WindowTab>"),
      attr("active_tab_index", "usize"),
    ],
    position: { x: 2100, y: 1350 },
    filePath: "apps/native/crates/domain/src/window_state.rs",
  },
  {
    name: { physical: "WindowTab", logical: "WindowTab", description: "ウィンドウ内の1タブの表示状態。永続化しない(ランタイム状態)。issue #83" },
    attributes: [
      attr("profile_id", "String"),
      attr("session_id", "Option<String>"),
      attr("session_title", "Option<String>"),
    ],
    position: { x: 2450, y: 1350 },
    filePath: "apps/native/crates/domain/src/window_tab.rs",
  },
  {
    name: { physical: "HubLayout", logical: "HubLayout", description: "ハブのグラフのノード位置の永続化(hub-layout.json)。issue #121" },
    attributes: [
      attr("version", "u32"),
      attr("positions", "HashMap<String, NodePosition>"),
    ],
    position: { x: 2100, y: 1650 },
    filePath: "apps/native/crates/domain/src/hub_layout.rs",
    // 名前と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 270, h: 0 },
  },
  {
    name: { physical: "NodePosition", logical: "NodePosition", description: "ハブのグラフ上でユーザーがドラッグ固定したノード1件分の座標。issue #121" },
    attributes: [attr("x", "f64"), attr("y", "f64")],
    position: { x: 2450, y: 1650 },
    filePath: "apps/native/crates/domain/src/node_position.rs",
  },
  // ============ /claude 画面(Explorer) ============
  {
    name: { physical: "ClaudeDirPage", logical: "ClaudeDirPage", description: "~/.claude 配下のディレクトリ一覧の1ページ分(Explorerタブ)" },
    attributes: [attr("entries", "Vec<ClaudeDirEntry>"), attr("total", "usize")],
    position: { x: 2950, y: 1350 },
    filePath: "apps/native/crates/domain/src/claude_dir_page.rs",
  },
  {
    name: { physical: "ClaudeDirEntry", logical: "ClaudeDirEntry", description: "~/.claude 配下のエントリ1件分(Explorerタブの1行)" },
    attributes: [
      attr("name", "String"),
      attr("path", "String"),
      attr("kind", "ClaudeDirEntryKind"),
      attr("size_bytes", "Option<u64>"),
      attr("modified_at_ms", "u64"),
    ],
    position: { x: 3300, y: 1350 },
    filePath: "apps/native/crates/domain/src/claude_dir_entry.rs",
  },
  {
    name: { physical: "ClaudeDirEntryKind", logical: "ClaudeDirEntryKind", description: "~/.claude 配下のエントリの種別" },
    stereotype: "enumeration",
    attributes: ["Directory", "File", "Symlink"].map(label),
    position: { x: 3300, y: 1650 },
    filePath: "apps/native/crates/domain/src/claude_dir_entry.rs",
  },
];

const { classes, rel, filePaths } = defineDiagram(DEFS);

const RELATIONSHIPS = [
  // セッション閲覧(プロトタイプ)
  rel("composition", "Project", "AgentKind", "agent", "left", "right"),
  rel("composition", "Conversation", "AgentKind", "agent", "top", "bottom"),
  rel("association", "Conversation", "Message", "messages", "right", "left"),
  rel("composition", "Message", "Role", "role", "bottom", "top"),
  // 設定・プロファイル
  rel("association", "Settings", "Profile", "profiles", "right", "left"),
  rel("association", "Profile", "GithubProject", "github_project", "bottom", "top"),
  // GitHub連携(Projects v2)
  rel("association", "ProjectItemsPage", "ProjectItem", "items", "right", "left"),
  rel("composition", "ProjectItem", "ProjectItemKind", "kind", "bottom", "top"),
  rel("association", "ProjectItemsPage", "ProjectStatusOption", "status_options", "bottom", "top"),
  // ウィンドウ・ハブ
  rel("association", "WindowState", "WindowTab", "tabs", "right", "left"),
  rel("association", "HubLayout", "NodePosition", "positions", "right", "left"),
  // /claude 画面(Explorer)
  rel("association", "ClaudeDirPage", "ClaudeDirEntry", "entries", "right", "left"),
  rel("composition", "ClaudeDirEntry", "ClaudeDirEntryKind", "kind", "bottom", "top"),
];

export const NATIVE_PROTOTYPE_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};

export const NATIVE_PROTOTYPE_CLASS_FILE_PATHS: ClassFilePaths = filePaths;
