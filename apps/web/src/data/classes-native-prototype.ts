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
 * - `session_line/`(旧 `classes-session-line.ts`。図は削除済み)と違い、
 *   tag 付き enum のバリアント分岐(依存関係)は無い(該当する型が無いため)。
 *
 * 【対象・ファイル対応】native.md §1 の「1型(クラス)= 1ファイル」(issue #184、
 * PR #185)により、domain クレートは各型が型名 snake_case のファイルに分かれて
 * いる(例: `Settings` → `settings.rs`)。`lib.rs` は `mod` 宣言と `pub use` のみ。
 * 本図の39クラスのうち、`ProjectItemKind` は `ProjectItem` と同じ `project_item.rs`
 * に、`ClaudeDirEntryKind` は `ClaudeDirEntry` と同じ `claude_dir_entry.rs` に、
 * `GitRepositoryLedger` は `GitLedger` と同じ `git_ledger.rs` に、`ObservedWorktree`
 * は `ObservedGitState` と同じ `observed_git_state.rs` に、`MessageStatus` は
 * `Message` と同じ `message.rs` に、`ImageMediaType`・
 * `ImageAttachmentError` は `ImageAttachment` と同じ `image_attachment.rs` に同居する
 * (native.md 曰く「その型専用の小さな補助enum」だが、補助structも同じ扱いにしている。
 * なお `ImageMediaType` は `ImageAttachment` と `MessageImage` の両方から使われるため、
 * 「専用」には厳密には当たらない。図は実物のファイル対応どおりに描いた)。ほかの32
 * クラスはそれぞれ単独のファイル(型名 snake_case)。掲載対象は `classes-domain.ts`
 * に掲載済みの Pc・User・Profile と、`session_line/`(33型。かつては
 * `classes-session-line.ts` で描いていたが、不要になったため図ごと削除した)を
 * 除いたもの。
 *
 * 【GitBranch・GitWorktree への参照】`GitRepositoryLedger.branches`/`worktrees` は
 * `classes-domain.ts` のオブジェクトモデル側のクラス(`GitBranch`・`GitWorktree`)を
 * 指す。図の離れた位置にあり線を引くと長く伸びるため、`AppState.settings` 等と
 * 同じ方針で線は引かない(属性の型名だけで分かるようにする)。
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
 *
 * 【Profile】ユーザー指示により `classes-domain.ts` へ `Profile` を追加したため、
 * このプロトタイプ側からは削除した(Pc・User と同じ扱い)。`Settings.profiles`
 * は `Profile` 型そのものを指すが、図の離れた位置にあるため線は引かない
 * (`GitRepositoryLedger.branches`/`worktrees` と同じ方針)。`GithubProject`・
 * `GithubProjectSummary` はまだ `Profile` の実装をそのまま写したこの図側に残す
 * (`Profile.github_project` からも同じ方針で線を引かない)。
 *
 * 【ScannedLine】`session_line/scanned_line.rs`(issue #302・#308)。`session_line/`
 * の33型は図から外しているが、`ScannedLine` は実装済みの domain の型で、走査
 * (.jsonl 全行の読み取り)が実際に使うため、この図に1つだけ載せる(「session_line
 * 群の近く」に置く先は無いので、独立した節にした)。
 * - フィールド `line: SessionLine` は private。宣言をそのまま写す方針なので属性として
 *   描き、可視性は `-` で表す。`SessionLine` は図に無いので線は引かない。
 * - メソッド(`parse` と、`SessionLine` から値を取り出すだけの `session_id`・`cwd`・
 *   `git_branch`・`slug`・`custom_title`・`ai_title`・`mode`・`last_prompt`・`message`・
 *   `user_message_text` 等)は描かない。この図はフィールドを写す図で(メソッドを載せるのは
 *   オブジェクトモデルと port(infra の図)だけ)、これらは `extract_*` と同じ値を返す
 *   だけの薄い取り出し口であり、型の形を決めるのは private な `line` 1つのため。
 *   一覧は説明(description)に書いた。
 *
 * 【Phase 1 の型(実行中セッション・権限・途中経過)】#391 で domain クレートに実装された
 * 11型(`RunningSession` など。`running_session.rs`・`permission_*.rs`・`progress_event.rs`・
 * `process_*.rs`)は、この図には描かず、`classes-domain.ts` に載せている(#388 の設計と
 * 同じ名前で、`mergeDiagrams` はクラス名の重複を許さないため。Pc・User・Profile と同じ
 * 扱い)。設計と実装の差は、`classes-domain.ts` の冒頭【Phase 1: 実装との差】と各クラスの
 * 説明に書いた。app・infra・tauri 側の型は `classes-infra.ts`・`classes-tauri.ts` にある。
 *
 * 【ParsedSession】`parsed_session.rs`(issue #208・#214・#217)。`User::load_sessions`
 * (オブジェクトモデル側。`classes-domain.ts`)への入力で、`GitLedger` の
 * `ObservedGitState` と同じ「ただの運搬型」。`ScannedLine` と同じ節に置く
 * (走査からセッション組み立てまでの一連の型のため)。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import {
  attr,
  defineDiagram,
  label,
  type ClassDef,
  type ClassFilePaths,
  type ClassLayers,
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
      // 組み立て元の会話チェーン行の uuid(issue #313)。元の jsonl 行を引き当てる
      // ためのキー。行に uuid が無ければ None。
      attr("uuid", "Option<String>"),
      // この行に含まれる表示可能な画像の枚数(issue #349)。画像本体は持たない
      // (必要なときだけ MessageImage として取り出す)。
      attr("image_count", "usize"),
      // 送信の失敗に関する見分け(issue #364)。行から取り出した直後はエラー行だけが
      // Error(それ以外は Normal)。質問との対応は mark_failed_questions が付ける。
      attr("status", "MessageStatus"),
    ],
    position: { x: 2450, y: 150 },
    filePath: "apps/native/crates/domain/src/message.rs",
  },
  {
    name: { physical: "MessageStatus", logical: "MessageStatus", description: "送信の失敗に関する、メッセージの見分け(message.rs に同居。Message 専用の補助 enum)。会話ファイルは書き換えず、表示のための印だけを付ける。Normal: 通常のメッセージ / FailedQuestion: 答えのない質問(直後が送信失敗のエラー行の user メッセージ) / ErrorForQuestion: 答えのない質問の直後のエラー行(次に送信するとまとめて答える) / Error: 返答の途中で失敗したエラー行。issue #364" },
    stereotype: "enumeration",
    attributes: ["Normal", "FailedQuestion", "ErrorForQuestion", "Error"].map(label),
    // Message の右下に置く(Message の右辺 → MessageStatus の左辺)。線のラベル(status)が
    // 箱に隠れないよう間を空け、GithubProjectSummary(右上)とも離す。
    position: { x: 2850, y: 340 },
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
    name: { physical: "SessionSummary", logical: "SessionSummary", description: "セッション一覧(ビューア左ペイン)表示用の1件分。1件 = 1セッション(セッションID = 会話ファイル)で、フォークや圧縮で別のIDのファイルに分かれた会話は別のセッションとして並ぶ。issue #33 / #104 / #369" },
    attributes: [
      attr("id", "String"),
      attr("title", "String"),
      attr("modified_at_ms", "u64"),
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
      // domain::Profile(classes-domain.ts に昇格済み)そのもの。図の離れた位置に
      // あるため線は引かない(冒頭コメントの方針を参照)。
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
      attr("camera", "Option<Camera>"), // v2 で追加(issue #268)
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
  {
    name: { physical: "Camera", logical: "Camera", description: "ハブのグラフの視点(パン・ズーム)。d3-zoom の transform に対応する(screen = world * k + (x, y))。HubLayout.camera として hub-layout.json に保存する。issue #268" },
    attributes: [attr("x", "f64"), attr("y", "f64"), attr("k", "f64")],
    // HubLayout の斜め下(HubTuning の右)に置く。
    position: { x: 2450, y: 1950 },
    filePath: "apps/native/crates/domain/src/camera.rs",
  },
  {
    name: { physical: "HubTuning", logical: "HubTuning", description: "ハブのグラフ(force シミュレーション)の調整値の永続化(hub-tuning.json)。ノード位置(hub-layout.json)とは関心が違うため別ファイル。issue #246・#249" },
    attributes: [
      attr("version", "u32"),
      attr("link_distance", "f64"),
      attr("link_strength", "Option<f64>"), // None = d3-force の既定のまま
      attr("charge_strength", "f64"),
      attr("collide_radius", "f64"),
    ],
    // HubLayout の真下に置く。他クラスへの参照は無いので線は無い。
    position: { x: 2100, y: 1950 },
    filePath: "apps/native/crates/domain/src/hub_tuning.rs",
  },
  {
    name: { physical: "ViewerTabs", logical: "ViewerTabs", description: "ビューアで開いているセッションタブの並び(プロファイルごとに別ファイル viewer-tabs/<プロファイルID>.json)。settings.json には入れない(見た目の状態のため)。選択中のタブは保存しない(URL で持つ)。スキーマ version は 2(#369 でタブのキーを series_key から session_id に改めた。v1 からのマイグレーションは infra にある)。issue #353 / #369" },
    attributes: [
      attr("version", "u32"),
      attr("tabs", "Vec<ViewerTab>"),
    ],
    // HubTuning の真下に置く(ViewerTab は右隣)。
    position: { x: 2100, y: 2250 },
    filePath: "apps/native/crates/domain/src/viewer_tabs.rs",
  },
  {
    name: { physical: "ViewerTab", logical: "ViewerTab", description: "ビューアのセッションタブ1件。どのセッションのタブかを特定するキー(project, session_id)だけを持つ。1つのタブ = 1セッション(セッションID = 会話ファイル)で、フォークや圧縮で別のIDのファイルに分かれた会話は別のセッションなので別のタブになる(#353 で入れたフォーク系列の鍵 series_key は #369 で廃止)。issue #353 / #369" },
    attributes: [
      attr("project", "String"), // プロジェクトフォルダ名(~/.claude/projects/ 直下)
      attr("session_id", "String"), // セッションID(会話ファイル名の拡張子を除いたもの)
    ],
    position: { x: 2450, y: 2250 },
    filePath: "apps/native/crates/domain/src/viewer_tab.rs",
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
  // ============ Git台帳・観測(第3弾) ============
  {
    name: { physical: "GitLedger", logical: "GitLedger", description: "登録済み全リポジトリの GitBranch/GitWorktree 台帳(issue #193)。settings.json・hub-layout.json とは別ファイル(git-ledger.json)に保存する。キーはリポジトリの個体指定子(GitRepository.repository_path の文字列表現)" },
    attributes: [
      attr("version", "u32"),
      attr("repositories", "HashMap<String, GitRepositoryLedger>"),
    ],
    position: { x: 4100, y: -150 },
    filePath: "apps/native/crates/domain/src/git_ledger.rs",
    // 名前と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "GitRepositoryLedger", logical: "GitRepositoryLedger", description: "1リポジトリ分の台帳(issue #193)。クラス図上の型ではなく、GitLedger が抱える小さな入れ物(GitRepository 本体は settings から都度組み立てるため永続化しない)" },
    attributes: [
      // GitBranch・GitWorktree は classes-domain.ts のオブジェクトモデル側の
      // クラス(図の離れた位置)。冒頭コメントの基準どおり線は引かない。
      attr("branches", "Vec<GitBranch>"),
      attr("worktrees", "Vec<GitWorktree>"),
    ],
    position: { x: 4700, y: -150 },
    filePath: "apps/native/crates/domain/src/git_ledger.rs",
    size: { w: 220, h: 0 },
  },
  {
    name: { physical: "ObservedGitState", logical: "ObservedGitState", description: "1リポジトリ分の観測結果(issue #193)。GitStateSource port(app層)の戻り値として使う、reconcile_branches・reconcile_worktrees への入力データ" },
    attributes: [
      attr("branch_names", "Vec<String>"),
      attr("worktrees", "Vec<ObservedWorktree>"),
    ],
    position: { x: 4100, y: 150 },
    filePath: "apps/native/crates/domain/src/observed_git_state.rs",
    size: { w: 250, h: 0 },
  },
  {
    name: { physical: "ObservedWorktree", logical: "ObservedWorktree", description: "1つの worktree について、git コマンドから観測した生の状態(issue #193)。GitWorktree(台帳のレコード)そのものではない(ID・作成/削除時刻を持たない)" },
    attributes: [
      attr("folder_path", "PathBuf"),
      attr("git_file_path", "PathBuf"),
      attr("checked_out_branch_name", "Option<String>"),
    ],
    position: { x: 4500, y: 150 },
    filePath: "apps/native/crates/domain/src/observed_git_state.rs",
    size: { w: 300, h: 0 },
  },
  // ============ 画像添付(issue #349) ============
  {
    name: { physical: "ImageAttachmentError", logical: "ImageAttachmentError", description: "画像添付の検証エラー(image_attachment.rs)。定数 MAX_IMAGES_PER_MESSAGE = 5(1メッセージの最大枚数)・MAX_IMAGE_BASE64_LEN = 5,000,000(base64 の最大長)は図に描かない。issue #349" },
    stereotype: "enumeration",
    attributes: [
      "Empty",
      "InvalidBase64",
      "UnsupportedFormat",
      "TooLarge { base64_len: usize, max: usize }",
      "TooMany { count: usize, max: usize }",
    ].map(label),
    position: { x: 3650, y: 150 },
    filePath: "apps/native/crates/domain/src/image_attachment.rs",
    // データを持つバリアントの表記が長いので広げる(LogLine の size の説明を参照)。
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "ImageAttachment", logical: "ImageAttachment", description: "送信時に添付する画像1枚(検証済み)。issue #349" },
    attributes: [
      attr("media_type", "ImageMediaType"),
      attr("data_base64", "String"),
    ],
    position: { x: 3650, y: 450 },
    filePath: "apps/native/crates/domain/src/image_attachment.rs",
  },
  {
    name: { physical: "ImageMediaType", logical: "ImageMediaType", description: "対応する画像形式(PNG / JPEG / GIF / WebP)。ImageAttachment と MessageImage の両方から使われる(image_attachment.rs に同居)。issue #349" },
    stereotype: "enumeration",
    attributes: ["Png", "Jpeg", "Gif", "Webp"].map(label),
    // ImageAttachment(上)と MessageImage(下)の間に置く。
    position: { x: 3650, y: 750 },
    filePath: "apps/native/crates/domain/src/image_attachment.rs",
  },
  {
    name: { physical: "MessageImage", logical: "MessageImage", description: "会話ログの1行(user 行)に含まれる画像1枚。ビューアが「画像 n 枚」を押したときに、その行の画像だけをオンデマンドで取り出すために使う(メッセージ一覧には画像本体を載せない)。issue #349" },
    attributes: [
      attr("media_type", "ImageMediaType"),
      attr("data_base64", "String"),
    ],
    position: { x: 3650, y: 1050 },
    filePath: "apps/native/crates/domain/src/message_image.rs",
  },
  // ============ 走査(.jsonl の読み取り・組み立て) ============
  {
    name: { physical: "ScannedLine", logical: "ScannedLine", description: "走査(.jsonl 全行の読み取り)用の、1行分の型付きビュー。SessionLine を1回だけ構築し、session_id / cwd / git_branch / custom_title / ai_title / mode / slug / last_prompt / timestamp / message などをメソッドで直接返す(抽出結果は extract_* と一致)。フィールドは private で、メソッド(parse と値の取り出し)は図に描かない(冒頭の【ScannedLine】を参照)。issue #302" },
    attributes: [
      // private なので `- ` で描く。SessionLine(session_line/ の型)は図に載せていないため線は引かない。
      { ...attr("line", "SessionLine"), visibility: "private" },
    ],
    position: { x: 4100, y: 450 },
    filePath: "apps/native/crates/domain/src/session_line/scanned_line.rs",
    // jsonl の1行(wire 形式の SessionLine)を、走査が読みやすい形に見せる変換の型。
    layer: "adapter",
  },
  {
    name: { physical: "ParsedSession", logical: "ParsedSession", description: "User::load_sessions(オブジェクトモデル側)への入力。Session/SessionFile を組み立てるための、ただの運搬型(GitLedger の ObservedGitState と同じ設計)。issue #208・#214・#217" },
    attributes: [
      attr("session_id", "String"),
      attr("custom_title", "Option<String>"),
      attr("ai_title", "Option<String>"),
      attr("mode", "Option<String>"),
      attr("slug", "Option<String>"),
      attr("last_prompt", "Option<String>"),
      attr("conversation_file_path", "PathBuf"),
      attr("subagent_file_paths", "Vec<PathBuf>"),
      attr("modified_at_ms", "u64"),
      attr("cwd", "Option<String>"),
      attr("git_branch", "Option<String>"),
    ],
    position: { x: 4450, y: 450 },
    filePath: "apps/native/crates/domain/src/parsed_session.rs",
    // 名前と型の列が重なるので広げる(LogLine の size の説明を参照)。
    size: { w: 280, h: 0 },
  },
];

// 既定はアプリケーションのビジネスルール(ユースケースの入出力・アプリ固有の状態)。
// それ以外のものだけ layer を書く。
const { classes, rel, filePaths, layers } = defineDiagram(DEFS, {
  layerOf: () => "application",
});

const RELATIONSHIPS = [
  // セッション閲覧(プロトタイプ)
  rel("composition", "Project", "AgentKind", "agent", "left", "right"),
  rel("composition", "Conversation", "AgentKind", "agent", "top", "bottom"),
  rel("association", "Conversation", "Message", "messages", "right", "left"),
  rel("composition", "Message", "Role", "role", "bottom", "top"),
  rel("composition", "Message", "MessageStatus", "status", "right", "left"),
  // 設定・プロファイル(Profile は classes-domain.ts に昇格済み。Settings.profiles の
  // コメントを参照)
  // GitHub連携(Projects v2)
  rel("association", "ProjectItemsPage", "ProjectItem", "items", "right", "left"),
  rel("composition", "ProjectItem", "ProjectItemKind", "kind", "bottom", "top"),
  rel("association", "ProjectItemsPage", "ProjectStatusOption", "status_options", "bottom", "top"),
  // ウィンドウ・ハブ
  rel("association", "WindowState", "WindowTab", "tabs", "right", "left"),
  rel("association", "HubLayout", "NodePosition", "positions", "right", "left"),
  rel("association", "HubLayout", "Camera", "camera", "bottom", "top"),
  rel("association", "ViewerTabs", "ViewerTab", "tabs", "right", "left"),
  // 画像添付
  rel("composition", "ImageAttachment", "ImageMediaType", "media_type", "bottom", "top"),
  rel("composition", "MessageImage", "ImageMediaType", "media_type", "top", "bottom"),
  // /claude 画面(Explorer)
  rel("association", "ClaudeDirPage", "ClaudeDirEntry", "entries", "right", "left"),
  rel("composition", "ClaudeDirEntry", "ClaudeDirEntryKind", "kind", "bottom", "top"),
  // Git台帳・観測(第3弾)
  rel("association", "GitLedger", "GitRepositoryLedger", "repositories", "right", "left"),
  rel("association", "ObservedGitState", "ObservedWorktree", "worktrees", "right", "left"),
];

export const NATIVE_PROTOTYPE_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};

export const NATIVE_PROTOTYPE_CLASS_FILE_PATHS: ClassFilePaths = filePaths;
export const NATIVE_PROTOTYPE_CLASS_LAYERS: ClassLayers = layers;
