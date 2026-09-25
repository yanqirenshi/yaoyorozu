/**
 * apps/native の infra クレート(`crates/infra/src/`)に実装済みの型と、
 * それが実現する app クレートの port(trait、`crates/app/src/lib.rs`)の
 * クラス図。`classes-native-prototype.ts`(domain クレートのプロトタイプ期の型)
 * と同じ「実装の as-is スナップショット」の書き方を踏襲する。
 *
 * 【目的】infra は「ports & adapters」の adapter 側にあたり、各型は app の
 * port(trait)を1つ実装する(SessionWatcher を除く。後述)。port をインター
 * フェースとして図に載せ、実現(realization)の線で結ぶことで、どの実装が
 * どの port を満たしているかを図から読めるようにする。
 *
 * 【書き方】
 * - infra の struct はフィールドをそのまま `attr()` に写す(書き方は
 *   `classes-native-prototype.ts` と同じ基準)。フィールドの型に他クラスへの
 *   参照は無い(String・PathBuf・外部ライブラリの型のみ)ため、コンポジション・
 *   関連の線は引かない。
 * - app の port(trait)は `stereotype: "interface"` にし、メソッドを
 *   `method()` で写す。引数は `&self` を除く Rust の宣言どおり、戻り値型も
 *   宣言どおり(`domain::` の有無も含め、トレイト定義の実物と一致させる)。
 * - 実現(realization)の線は「実装 → port」の向き(三角が port 側に付く。
 *   継承と同じ記法で、線だけ破線になる)。ラベルは付けない。
 * - `impl <Trait> for <型>` を実際に読んで対応を確認した(型名からの推測は
 *   しない)。1型につき実装する port はちょうど1つで、1対1に対応する。
 *
 * 【SessionWatcher】trait を実装する構造体ではなく、`session_source.rs` の
 * `pub type SessionWatcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;`
 * という型エイリアス(`FileSystemRepository::watch_projects` の戻り値)。
 * 実現の線は引かず、`stereotype: "type alias"` として `FileSystemRepository`
 * の隣に置く。
 *
 * 【対象・ファイル対応】infra クレートは domain と違い、まだ1型=1ファイルに
 * 揃っている(型名 snake_case のファイル。例外: `FileClaudeDirStore` は
 * `claude_dir_store.rs`、`SessionWatcher`/`FileSystemRepository` は
 * `session_source.rs` に同居(`SessionFileRef`・`SessionFsChange` も同じ)、`ClaudeCliProcess`・
 * `ExitSignal` は `ClaudeCliProcessLauncher` と同じ `claude_cli_process.rs` に同居)。
 * infra の型 29個(port を実装するもの23 + port を実装しない補助の型6: `SessionWatcher`・
 * `SessionFileRef`・`SessionFsChange`・`GithubAuthLog`・`ExitSignal`・`PendingSwitches`)と、
 * app の port 24個を載せた(1回きり送信の `AgentGateway`・`ClaudeCliAgent` は #392 で撤去。
 * `ViewerTabsStore`・`FileViewerTabsStore` は #420、`GitWorktreeManager`・`SystemGitWorktreeManager` は
 * #441(Phase 3。PR #440)で追加)。
 *
 * 【app の port の入出力の型(issue #420)】方針: app の非 port の型は、port のシグネチャ(引数・
 * 戻り値・エラー)に出てくるものだけを載せる(層はアプリケーションのビジネスルール)。
 * 載せたもの: `AppError`(ほぼすべての port のエラー)・`FileFingerprint`・`SessionContent`
 * (`SessionSource`)・`LoadedSettings`(`SettingsStore`)・`ProjectSettingsFile`
 * (`ProjectSettingsStore`)・`DeviceAuthorization`・`PollResult`・`GithubViewer`(`GithubGateway`)。
 * Phase 3(worktree の用意。PR #440)の `worktree.rs` の型 `WorktreeSpec`・`WorktreeEntry`・
 * `MergeOutcome`・`PreparedWorktree`・`ResolvedWorktree`・`WorktreeIndex` は、port
 * (`GitWorktreeManager`)と起動要求の入出力なので載せた。`cli_version.rs`(`MIN_PEER_MESSAGING_VERSION`
 * と版の判定の関数)は型を持たず、定数と関数だけなので描かない。
 * これに加えて、tauri 層の `AppState` が持つ `CachedMessages`・`RescanQueue`・`WindowRegistry`
 * (tauri 図から参照される型)も載せた。
 * **載せないもの(理由)**:
 * - ユースケースの戻り値のための型: `OpenedSession`・`ReloadedSession`・`SessionDisplayHint`・
 *   `ReconcileGitLedgerResult`・`BuildUserSessionsResult`・`ViewerCheckOutcome`(関数の結果であって、
 *   port の入出力でも状態でもない。関数は図に描かない)。
 * - 型エイリアス `NowMs`(= u64)。
 * - infra の private な型: `DeviceCodeResponse`(GitHub の応答の読み取り用)・`LedgerEntry`・
 *   `ProcessProbe`(実行中セッションの台帳の読み取り・生存確認)・`SessionCwdSelector`・
 *   `CachedSessionSummary`(セッション走査の内部)・`LegacySettingsRaw`・`SettingsV4Raw`・
 *   `SettingsV5Raw`(設定ファイルの旧版の読み取り = マイグレーション用)・`ViewerTabsV1`・
 *   `ViewerTabV1`(タブの旧版の読み取り用)・`GitOutput`(git コマンドの出力の入れ物。
 *   `git_worktree_manager.rs` の内部)。wire / ファイル形式の写し(serde)で、外から見える
 *   構造ではない。`ExitSignal` は複数の型が共有するため例外として載せている。
 * - domain クレートの `session_line/`(34型。JSONL 行の読み取り用。`classes-native-prototype.ts` の
 *   説明を参照)と、`LogLineBase`(`LogLine` の共通属性を Rust では埋め込み struct にしたもの。
 *   `classes-domain.ts` の `LogLine` の属性として描いている)・`LogLineConversionError`
 *   (JSONL 行 → `LogLine` の変換関数のエラー)。
 *
 * 【実行中セッション(Phase 1。issue #391)】`RunningSessionSource`(#361 のガード。
 * `exclude_pids` が加わった)・`RunningSessionLauncher`・`RunningProcess`・
 * `RunningSessionEventSink` の4 port と、その実装を載せた。`ExitSignal`(private)は
 * `ClaudeCliProcess` が共有する終了の合図で、port を実装しない補助の型。port の入出力の
 * app の型(`StartRunningSession`・`RunningPermissionMode`・`StartedRunningSession`・
 * `RunningSessionEvent`・`PermissionDecision`・`DetectedRunning`・`RunningEvidence`。Phase 2 の
 * 分は下の【Phase 2】)は、
 * app の非 port の型は基本的に載せない方針だが、port のシグネチャに出てくるので例外として
 * 載せた(層はアプリケーションのビジネスルール)。`RunningSessionEventSink` の実装
 * (`ChannelSink`)は tauri 層(`classes-tauri.ts`)で、実現の線は引かない。
 * `claude_stream_json.rs`(起動引数・標準入出力の JSON 行・wire → domain の写し)は、型
 * (struct / enum)を持たず関数だけ(wire は `serde_json::Value` から取れるものだけを取り出す。
 * 未知の type / subtype と必須項目の欠けた行は捨てる)なので、クラスとしては描かない。
 *
 * 【実行中セッション(Phase 2。issue #407。PR #413)】複数の実行中セッション・新規作成・
 * モデル / 権限モードの切り替え・画面ごとの購読を足した。`StartRunningSession` は struct から
 * enum(Resume / New)になり、画面から来る値だけの `ResumeRunningSession` /
 * `CreateRunningSession` が加わった(起動のユースケースは `resume_running_session` /
 * `create_running_session` に分かれた。関数なので図には描かない)。切り替え(`RunningSessionSwitch`)は
 * port(`RunningProcess`)の `set_model` / `set_permission_mode` で、infra の `PendingSwitches`
 * が要求と応答を対応づける。出来事に `Configured` / `SwitchApplied`、途中経過に宛先を付ける包み
 * (`RunningSessionRef` / `AddressedProgress` / `AddressedRunningSessionEvent`)、ハブ用の
 * 一覧項目 `RunningSessionSummary`(`summarize` で作る)も app の型。定数(`MAX_RUNNING_SESSIONS`
 * = 8 / `MAX_KEPT_EXITED_SESSIONS` = 10)は型ではないので描かない。
 * Phase 3(worktree の用意・セッション間メッセージ対応。issue #437。PR #440)で、起動要求に
 * `worktree_id`(Resume / New の値)と、画面から来る値だけの `ResumeRunningSession` /
 * `CreateRunningSession` に用意済みの worktree(`ResolvedWorktree`)が加わり、worktree を用意する
 * port `GitWorktreeManager`(実装 `SystemGitWorktreeManager`。`git worktree add` / `git fetch` /
 * `git merge`。用意のユースケース `prepare_worktree` は関数なので描かない)、`RunningSessionLauncher`
 * の `cli_version`(起動する claude の版)、`RunningSessionSource` の `taken_names`(台帳の名前。
 * 表示名の一意化 `unique_session_name` は関数)、`RunningSessionSummary` の版の項目、`AppError` の
 * `WorktreeSyncFailed` が加わった。起動時の `--settings`(`PEER_SETTINGS`。セッション間メッセージ
 * の受信を受け入れる)は定数なので描かない。
 * ビューア(issue #409。PR #418)で、CLI が `initialize` の応答で報告する選べるモデル
 * `AvailableModel` と、出来事 `ModelsListed` が加わった(状態は動かさない)。
 *
 * 【GitLedgerStore・GitStateSource への参照】メソッドの戻り値・引数に出てくる
 * `domain::GitLedger`・`domain::ObservedGitState` は、`classes-native-prototype.ts`
 * に載っているクラス(`GitLedger`・`ObservedGitState`)だが、別の図の離れた
 * 位置にあるため、ほかの `domain::` 参照と同じ方針で線は引かない。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import {
  attr,
  defineDiagram,
  label,
  method,
  type ClassDef,
  type ClassFilePaths,
  type ClassLayers,
} from "./classDiagram";

const DEFS: ClassDef[] = [
  // ============ セッション閲覧 ============
  {
    name: { physical: "SessionSource", logical: "SessionSource", description: "プロジェクト・セッションの読み取り(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("list_projects", [], "Result<Vec<Project>, AppError>"),
      method("session", ["project: &str", "session_id: &str"], "Result<Session, AppError>"),
      method("latest_session_id", ["project: &str"], "Result<String, AppError>"),
      method("latest_session_cwd", ["project: &str"], "Result<PathBuf, AppError>"),
      method("list_sessions", ["project: &str"], "Result<Vec<SessionSummary>, AppError>"),
    ],
    position: { x: 2100, y: 2050 },
    filePath: "apps/native/crates/app/src/lib.rs",
    // メソッド名・引数が長く、戻り値型の列と重なるので広げる。
    size: { w: 410, h: 0 },
  },
  {
    name: { physical: "FileSystemRepository", logical: "FileSystemRepository", description: "~/.claude/projects/ 配下の .jsonl を読む SessionSource 実装(session_source.rs)" },
    attributes: [attr("projects_dir", "PathBuf")],
    position: { x: 2100, y: 2400 },
    filePath: "apps/native/crates/infra/src/session_source.rs",
  },
  {
    name: { physical: "SessionWatcher", logical: "SessionWatcher", description: "watch_projects の戻り値の型エイリアス(実装ではない。冒頭コメントを参照)" },
    stereotype: "type alias",
    attributes: [],
    position: { x: 2750, y: 2400 },
    filePath: "apps/native/crates/infra/src/session_source.rs",
    // ファイル監視ライブラリ(notify)の型そのもの。
    layer: "framework",
  },
  // ============ 設定・プロファイル ============
  {
    name: { physical: "SettingsStore", logical: "SettingsStore", description: "アプリ設定の永続化(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("load", [], "Result<LoadedSettings, AppError>"),
      method("save", ["settings: &Settings"], "Result<(), AppError>"),
    ],
    position: { x: 3400, y: 2050 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 280, h: 0 },
  },
  {
    name: { physical: "FileSettingsStore", logical: "FileSettingsStore", description: "Settings をJSONファイルとして永続化。アトミック書き込み・破損時退避(settings_store.rs)" },
    attributes: [attr("path", "PathBuf")],
    position: { x: 3400, y: 2400 },
    filePath: "apps/native/crates/infra/src/settings_store.rs",
  },
  // ============ ファイル編集 ============
  {
    name: { physical: "ClaudeMdStore", logical: "ClaudeMdStore", description: "CLAUDE.md の読み書き(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("read", ["repo_dir: &Path"], "Result<Option<ClaudeMdFile>, AppError>"),
      method("write", ["repo_dir: &Path", "content: &str"], "Result<(), AppError>"),
    ],
    position: { x: 4050, y: 2050 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 380, h: 0 },
  },
  {
    name: { physical: "FileClaudeMdStore", logical: "FileClaudeMdStore", description: "<repo_dir>/CLAUDE.md を読み書き(claude_md_store.rs)" },
    attributes: [],
    position: { x: 4050, y: 2400 },
    filePath: "apps/native/crates/infra/src/claude_md_store.rs",
  },
  {
    name: { physical: "ClaudeSettingsStore", logical: "ClaudeSettingsStore", description: "~/.claude/settings.json の読み書き(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("read", [], "Result<Option<ClaudeSettingsFile>, AppError>"),
      method("write", ["content: &str"], "Result<(), AppError>"),
    ],
    position: { x: 4700, y: 2050 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "FileClaudeSettingsStore", logical: "FileClaudeSettingsStore", description: "~/.claude/settings.json を読み書き(claude_settings_store.rs)" },
    attributes: [],
    position: { x: 4700, y: 2400 },
    filePath: "apps/native/crates/infra/src/claude_settings_store.rs",
  },
  // ============ Rules / Skills / プロジェクト設定 ============
  {
    name: { physical: "RulesStore", logical: "RulesStore", description: ".claude/rules/*.md の読み取り専用アクセス(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("list", ["repo_dir: &Path"], "Result<Vec<RuleSummary>, AppError>"),
      method("read", ["repo_dir: &Path", "file_name: &str"], "Result<String, AppError>"),
    ],
    position: { x: 2100, y: 2800 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 380, h: 0 },
  },
  {
    name: { physical: "FileRulesStore", logical: "FileRulesStore", description: "<repo_dir>/.claude/rules/*.md を一覧・読み取り(rules_store.rs)" },
    attributes: [],
    position: { x: 2100, y: 3150 },
    filePath: "apps/native/crates/infra/src/rules_store.rs",
  },
  {
    name: { physical: "SkillsStore", logical: "SkillsStore", description: ".claude/skills/<name>/SKILL.md の読み取り専用アクセス(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("list", ["repo_dir: &Path"], "Result<Vec<SkillSummary>, AppError>"),
      method("read", ["repo_dir: &Path", "name: &str"], "Result<String, AppError>"),
    ],
    position: { x: 2750, y: 2800 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 360, h: 0 },
  },
  {
    name: { physical: "FileSkillsStore", logical: "FileSkillsStore", description: "<repo_dir>/.claude/skills/<name>/SKILL.md を一覧・読み取り(skills_store.rs)" },
    attributes: [],
    position: { x: 2750, y: 3150 },
    filePath: "apps/native/crates/infra/src/skills_store.rs",
  },
  {
    name: { physical: "ProjectSettingsStore", logical: "ProjectSettingsStore", description: "<repo_dir>/.claude/settings(.local).json の読み書き(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("read", ["repo_dir: &Path", "which: ProjectSettingsFile"], "Result<Option<ClaudeSettingsFile>, AppError>"),
      method("write", ["repo_dir: &Path", "which: ProjectSettingsFile", "content: &str"], "Result<(), AppError>"),
    ],
    position: { x: 3400, y: 2800 },
    filePath: "apps/native/crates/app/src/lib.rs",
    // 引数(which: ProjectSettingsFile)が長いので広げる。
    size: { w: 560, h: 0 },
  },
  {
    name: { physical: "FileProjectSettingsStore", logical: "FileProjectSettingsStore", description: "<repo_dir>/.claude/settings(.local).json を読み書き(project_settings_store.rs)" },
    attributes: [],
    position: { x: 3400, y: 3150 },
    filePath: "apps/native/crates/infra/src/project_settings_store.rs",
  },
  {
    name: { physical: "HubLayoutStore", logical: "HubLayoutStore", description: "ハブグラフのノード位置の永続化(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("load", [], "Result<HubLayout, AppError>"),
      method("save", ["layout: &HubLayout"], "Result<(), AppError>"),
    ],
    position: { x: 4050, y: 2800 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "FileHubLayoutStore", logical: "FileHubLayoutStore", description: "HubLayout をJSONファイルとして永続化(hub_layout_store.rs)" },
    attributes: [attr("path", "PathBuf")],
    position: { x: 4050, y: 3150 },
    filePath: "apps/native/crates/infra/src/hub_layout_store.rs",
  },
  {
    name: { physical: "HubTuningStore", logical: "HubTuningStore", description: "ハブグラフの force シミュレーション調整値(domain::HubTuning)の永続化(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("load", [], "Result<domain::HubTuning, AppError>"),
      method("save", ["tuning: &domain::HubTuning"], "Result<(), AppError>"),
    ],
    position: { x: 4400, y: 2800 },
    filePath: "apps/native/crates/app/src/lib.rs",
    // save の引数が長く、戻り値型の列と重なるので広げる(GitLedgerStore と同じ理由)。
    size: { w: 430, h: 0 },
  },
  {
    name: { physical: "FileHubTuningStore", logical: "FileHubTuningStore", description: "HubTuning をJSONファイルとして永続化。FileHubLayoutStore と同じ実装パターン(hub_tuning_store.rs)" },
    attributes: [attr("path", "PathBuf")],
    position: { x: 4400, y: 3150 },
    filePath: "apps/native/crates/infra/src/hub_tuning_store.rs",
  },
  // ============ 実行環境・GitHub連携・エージェント ============
  {
    name: { physical: "ExecutionEnvironmentSource", logical: "ExecutionEnvironmentSource", description: "実行環境(PC・ログインユーザー)の取得(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [method("current_pc", [], "Result<domain::Pc, AppError>")],
    position: { x: 2100, y: 3550 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "WindowsExecutionEnvironmentSource", logical: "WindowsExecutionEnvironmentSource", description: "Windows実行環境から Pc/User を組み立てる(execution_environment_source.rs)" },
    attributes: [],
    position: { x: 2100, y: 3900 },
    filePath: "apps/native/crates/infra/src/execution_environment_source.rs",
    // クラス名が長く型の列(無いが箱の最小幅)と名前がはみ出さないよう広げる。
    size: { w: 320, h: 0 },
  },
  {
    name: { physical: "GithubGateway", logical: "GithubGateway", description: "GitHub OAuth(デバイスフロー)+ Projects(v2) 取得(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("start_device_flow", [], "Result<DeviceAuthorization, AppError>"),
      method("poll_for_token", ["device_code: &str"], "Result<PollResult, AppError>"),
      method("fetch_viewer", ["token: &str"], "Result<GithubViewer, AppError>"),
      method("list_projects", ["token: &str"], "Result<Vec<domain::GithubProjectSummary>, AppError>"),
      method("list_project_items", ["token: &str", "owner: &str", "number: u32", "cursor: Option<&str>"], "Result<domain::ProjectItemsPage, AppError>"),
      method("update_item_status", ["token: &str", "project_id: &str", "item_id: &str", "field_id: &str", "option_id: Option<&str>"], "Result<(), AppError>"),
    ],
    position: { x: 2750, y: 3550 },
    filePath: "apps/native/crates/app/src/lib.rs",
    // メソッド数が多く、引数・戻り値型がどちらも長いので大きく広げる。
    size: { w: 720, h: 0 },
  },
  {
    name: { physical: "GithubApiClient", logical: "GithubApiClient", description: "GitHub OAuth(デバイスフロー)+ GraphQL(Projects v2) を叩く GithubGateway 実装(github_api_client.rs)" },
    attributes: [attr("client_id", "String"), attr("http", "Client")],
    position: { x: 2750, y: 4100 },
    filePath: "apps/native/crates/infra/src/github_api_client.rs",
    size: { w: 250, h: 0 },
  },
  {
    name: { physical: "TokenStore", logical: "TokenStore", description: "GitHubアクセストークンの保管(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("save", ["token: &str"], "Result<(), AppError>"),
      method("load", [], "Result<Option<String>, AppError>"),
      method("delete", [], "Result<(), AppError>"),
    ],
    position: { x: 3550, y: 3550 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 280, h: 0 },
  },
  {
    name: { physical: "KeyringTokenStore", logical: "KeyringTokenStore", description: "GitHubアクセストークンをOSキーチェーンに保管(keyring_token_store.rs)" },
    attributes: [attr("service", "String"), attr("username", "String")],
    position: { x: 3550, y: 3900 },
    filePath: "apps/native/crates/infra/src/keyring_token_store.rs",
  },
  // ============ レイアウト保存・ローカルAPI・Git・Explorer ============
  {
    name: { physical: "LayoutStore", logical: "LayoutStore", description: "図のレイアウトJSONへの汎用アトミック書き込み(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [method("save", ["path: &Path", "content: &serde_json::Value"], "Result<(), AppError>")],
    position: { x: 2100, y: 4300 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "FileLayoutStore", logical: "FileLayoutStore", description: "レイアウトJSONへの汎用アトミック書き込み。保存のみ(layout_store.rs)" },
    attributes: [],
    position: { x: 2100, y: 4650 },
    filePath: "apps/native/crates/infra/src/layout_store.rs",
  },
  {
    name: { physical: "LocalApiTokenStore", logical: "LocalApiTokenStore", description: "ローカルAPIサーバの認証トークンの永続化(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [method("save", ["token: &str"], "Result<(), AppError>")],
    position: { x: 2750, y: 4300 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 280, h: 0 },
  },
  {
    name: { physical: "FileLocalApiTokenStore", logical: "FileLocalApiTokenStore", description: "ローカルAPIトークンを app_data_dir/local-api-token へ保存(local_api_token_store.rs)" },
    attributes: [attr("path", "PathBuf")],
    position: { x: 2750, y: 4650 },
    filePath: "apps/native/crates/infra/src/local_api_token_store.rs",
    size: { w: 280, h: 0 },
  },
  {
    name: { physical: "GitWorktreeLister", logical: "GitWorktreeLister", description: "指定リポジトリに属する git worktree の一覧(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [method("list_worktree_paths", ["repo_root: &Path"], "Result<Vec<PathBuf>, AppError>")],
    position: { x: 3550, y: 4300 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 430, h: 0 },
  },
  {
    name: { physical: "SystemGitWorktreeLister", logical: "SystemGitWorktreeLister", description: "git worktree list --porcelain を実行(git_worktree_lister.rs)" },
    attributes: [],
    position: { x: 3550, y: 4650 },
    filePath: "apps/native/crates/infra/src/git_worktree_lister.rs",
    size: { w: 260, h: 0 },
  },
  {
    name: { physical: "ClaudeDirStore", logical: "ClaudeDirStore", description: "~/.claude 配下のエントリ一覧(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [method("list", ["relative_path: &str"], "Result<Vec<ClaudeDirEntry>, AppError>")],
    position: { x: 4300, y: 4300 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 380, h: 0 },
  },
  {
    name: { physical: "FileClaudeDirStore", logical: "FileClaudeDirStore", description: "~/.claude 配下のディレクトリを一覧(読み取り専用。claude_dir_store.rs)" },
    attributes: [attr("root", "PathBuf")],
    position: { x: 4300, y: 4650 },
    filePath: "apps/native/crates/infra/src/claude_dir_store.rs",
  },
  // ============ Git台帳・観測(第3弾) ============
  {
    name: { physical: "GitLedgerStore", logical: "GitLedgerStore", description: "GitBranch/GitWorktree台帳(domain::GitLedger)の永続化(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [
      method("load", [], "Result<domain::GitLedger, AppError>"),
      method("save", ["ledger: &domain::GitLedger"], "Result<(), AppError>"),
    ],
    position: { x: 5150, y: 2050 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 350, h: 0 },
  },
  {
    name: { physical: "FileGitLedgerStore", logical: "FileGitLedgerStore", description: "GitLedger をJSONファイルとして永続化。FileHubLayoutStore と同じ実装パターン(git_ledger_store.rs)" },
    attributes: [attr("path", "PathBuf")],
    position: { x: 5150, y: 2400 },
    filePath: "apps/native/crates/infra/src/git_ledger_store.rs",
  },
  {
    name: { physical: "GitStateSource", logical: "GitStateSource", description: "リポジトリの現在状態(ブランチ名一覧・worktree一覧)の観測(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [method("observe", ["repo_root: &Path"], "Result<domain::ObservedGitState, AppError>")],
    position: { x: 5600, y: 2050 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 450, h: 0 },
  },
  {
    name: { physical: "SystemGitStateSource", logical: "SystemGitStateSource", description: "git コマンドを実行してリポジトリの現在状態を観測する(git_state_source.rs)" },
    attributes: [],
    position: { x: 5600, y: 2400 },
    filePath: "apps/native/crates/infra/src/git_state_source.rs",
  },
  // ============ セッションタブ・診断ログ・ファイル監視の変更(issue #420) ============
  {
    name: { physical: "SessionFileRef", logical: "SessionFileRef", description: "走査キュー(セッション一覧の逐次読み込み)の対象1件。列挙時点ではファイルの中身を読まず、パスとメタデータだけで組み立てる軽量な参照(session_source.rs。pub)。FileSystemRepository の enumerate_session_file_refs / session_file_ref の戻り値。session_id はファイル名(<セッションID>.jsonl)から取り、中身の sessionId とは照合しない(中身は走査 parse_session_file が正)" },
    attributes: [
      attr("project", "String"), // プロジェクトフォルダ名(projects_dir 直下)
      attr("file_path", "PathBuf"), // 会話ファイルの絶対パス
      attr("session_id", "String"), // ファイル名由来のセッションID
      attr("modified_at_ms", "u64"), // ファイルの最終更新時刻(キューの実行優先度に使う)
    ],
    position: { x: 2100, y: 2570 },
    filePath: "apps/native/crates/infra/src/session_source.rs",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "SessionFsChange", logical: "SessionFsChange", description: "ファイル監視(FileSystemRepository の watch_projects)が通知する1プロジェクト分の変更(session_source.rs。pub)。project はビューアの session:changed 用。conversation_files は変更のあった会話ファイルの絶対パスで、サブエージェントのファイルの変更は持ち主の会話ファイルとして数える(issue #311。ハブの差分再走査用)。会話ファイルに結びつかない変更は含まない" },
    attributes: [
      attr("project", "String"),
      attr("conversation_files", "Vec<PathBuf>"),
    ],
    position: { x: 2500, y: 2570 },
    filePath: "apps/native/crates/infra/src/session_source.rs",
    size: { w: 360, h: 0 },
  },
  {
    name: { physical: "ViewerTabsStore", logical: "ViewerTabsStore", description: "ビューアのセッションタブの並び(domain::ViewerTabs。issue #353)の永続化(port)。プロファイルごとに別ファイルへ保存する。app::lib.rs。ファイルが無い・壊れている場合の load は空(ViewerTabs::default())" },
    stereotype: "interface",
    methods: [
      method("load", ["profile_id: &str"], "Result<ViewerTabs, AppError>"),
      method("save", ["profile_id: &str", "tabs: &ViewerTabs"], "Result<(), AppError>"),
    ],
    position: { x: 4950, y: 2800 },
    filePath: "apps/native/crates/app/src/lib.rs",
    // save の引数が長く、戻り値型の列と重なるので広げる(HubTuningStore と同じ理由)。
    size: { w: 480, h: 0 },
  },
  {
    name: { physical: "FileViewerTabsStore", logical: "FileViewerTabsStore", description: "ViewerTabs をプロファイルごとの JSON ファイル(<dir>/<プロファイルID>.json)として永続化(viewer_tabs_store.rs。issue #353)。FileHubTuningStore と同じ流儀: アトミック書き込み・破損時は *.corrupt.<timestamp> へ退避して空で始める。v1(キーが series_key)のファイルは v2(キーが session_id。#369)へ移行して読む(ViewerTabsV1・ViewerTabV1 はそのための private な読み取り用の型で、図には描かない)。プロファイルIDは app 層で検証済みの前提" },
    attributes: [attr("dir", "PathBuf")],
    position: { x: 4950, y: 3150 },
    filePath: "apps/native/crates/infra/src/viewer_tabs_store.rs",
  },
  {
    name: { physical: "GithubAuthLog", logical: "GithubAuthLog", description: "GitHub 認証まわりの診断ログ(github_auth_log.rs。issue #261)。いつ・どの操作で・どのインスタンスがトークンを無効と判断/削除したかの証拠を、app_data_dir 配下の追記式ファイル(1行1イベント。ローカル専用)に残す。トークン全文・Authorization ヘッダは書かない(識別は token_fingerprint の先頭・末尾数文字のみ)。ベストエフォート(書き込みに失敗してもアプリの動作を妨げない)。port を実装しない補助の型で、tauri 層が record を呼ぶ。1MB を超えたら <name>.1 へ退避する" },
    attributes: [
      attr("path", "PathBuf"),
      // 複数インスタンス(dev / リリース / worktree 検証)がキーチェーンを共有するため、各行に含める。
      attr("instance", "String"),
    ],
    position: { x: 4100, y: 3550 },
    filePath: "apps/native/crates/infra/src/github_auth_log.rs",
  },
  // ============ app の port の入出力の型(issue #420) ============
  // port のシグネチャに出てくる app の型(層はアプリケーションのビジネスルール)。線は、この図の中で
  // 型が別の型を持つところだけ引く(Message・LogLine・Settings は別の図の離れた位置にあるため引かない)。
  {
    name: { physical: "AppError", logical: "AppError", description: "app の port・ユースケースが返すエラー(app::lib.rs。ほぼすべての port の Result のエラー型。thiserror。表示は中身の文字列そのまま)。NotFound / Io / InvalidInput / SessionBusy(送信先が他のプロセスで実行中。issue #345)/ CliNotFound / CliFailed / Timeout / CwdMissing / GithubUnauthenticated / GithubAuthExpired(認証のタイムアウト・拒否・トークンの確定的な失効 401。#54)/ GithubApiFailed / ClaudeMdConflict / GithubScopeInsufficient(#50)/ FileConflict(汎用の保存競合。#53)/ WorktreeSyncFailed(起動前の worktree の最新化 git fetch + git merge origin/main で競合などにより取り込めなかった。取り込みは取り消してあり、起動は止める。#437)。多くの port に出てくるので、各 port への線は引かない" },
    stereotype: "enumeration",
    attributes: [
      "NotFound(String)",
      "Io(String)",
      "InvalidInput(String)",
      "SessionBusy(String)",
      "CliNotFound(String)",
      "CliFailed(String)",
      "Timeout(String)",
      "CwdMissing(String)",
      "GithubUnauthenticated(String)",
      "GithubAuthExpired(String)",
      "GithubApiFailed(String)",
      "ClaudeMdConflict(String)",
      "GithubScopeInsufficient(String)",
      "FileConflict(String)",
      "WorktreeSyncFailed(String)",
    ].map(label),
    position: { x: 7700, y: 4400 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 320, h: 0 },
  },
  {
    name: { physical: "FileFingerprint", logical: "FileFingerprint", description: "会話ファイルの状態の目印(更新時刻 + サイズ。app::lib.rs。issue #350)。解析済みの結果を使い回してよいかの判定に使う" },
    attributes: [
      attr("modified_nanos", "u128"),
      attr("len", "u64"),
    ],
    position: { x: 8100, y: 4400 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "SessionContent", logical: "SessionContent", description: "会話ファイルを1回読んで得た内容(SessionSource::read_session の戻り値。app::lib.rs。issue #350)。messages は表示用のメッセージで記録順(古い順)。Message・LogLine は classes-native-prototype.ts / classes-domain.ts の離れた位置にあるため線は引かない" },
    attributes: [
      attr("fingerprint", "FileFingerprint"),
      attr("messages", "Vec<Message>"), // 記録順(古い順)
      attr("lines", "Vec<LogLine>"),
    ],
    position: { x: 8100, y: 4650 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "CachedMessages", logical: "CachedMessages", description: "解析済みメッセージのキャッシュ(ファイルごと。app::lib.rs。issue #350)。tauri 層の AppState.loaded_messages が持つ(classes-tauri.ts)。ページ送りのたびに巨大な会話ファイルを読み直さないための保存先" },
    attributes: [
      attr("fingerprint", "FileFingerprint"),
      attr("messages", "Arc<Vec<Message>>"), // 新しい順に並べ済み(表示のたびに並べ替え・複製をしない)
    ],
    position: { x: 8650, y: 4650 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 380, h: 0 },
  },
  {
    name: { physical: "LoadedSettings", logical: "LoadedSettings", description: "起動時に読み込んだ設定(SettingsStore::load の戻り値。app::lib.rs)。ファイルが存在しない場合と破損していた場合を区別しない(どちらもデフォルト値へフォールバックする)が、破損からの復旧があったかどうかは tauri 層が app:warning を出すか判断するために保持する" },
    attributes: [
      attr("settings", "Settings"),
      attr("recovered_from_corruption", "bool"),
    ],
    position: { x: 8100, y: 5000 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 420, h: 0 },
  },
  {
    name: { physical: "ProjectSettingsFile", logical: "ProjectSettingsFile", description: "プロジェクトの .claude/ 配下にある2種類の設定ファイル(ProjectSettingsStore の引数。app::lib.rs。issue #70)。フロントからファイル名を自由入力させず、この enum で選ばせてパスを固定する(native.md §4)。tauri の ProjectSettingsFileDto から変換される" },
    stereotype: "enumeration",
    attributes: ["Settings", "SettingsLocal"].map(label),
    position: { x: 8650, y: 4400 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "RescanQueue", logical: "RescanQueue", description: "セッション再走査の待ち行列(app::lib.rs)。書き込み中の jsonl は頻繁に更新されるため、変更のたびに走査すると暴れる。ワーカーは常に高々1つ(動いていなければ起動し、1回の処理が終わるたびに最短間隔だけ待ってから、溜まった変更をまとめて取り出す)。同じファイルの変更は集合で1件に畳まれる。フィールドは private(操作は push 等のメソッド経由)。tauri 層の AppState.session_rescan が持つ" },
    attributes: [
      { ...attr("pending", "BTreeSet<PathBuf>"), visibility: "private" },
      { ...attr("worker_running", "bool"), visibility: "private" },
    ],
    position: { x: 8650, y: 5000 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 420, h: 0 },
  },
  {
    name: { physical: "WindowRegistry", logical: "WindowRegistry", description: "ウィンドウレジストリの型エイリアス(app::lib.rs。ハブ化 その1。issue #83)。std::collections::HashMap<String, domain::WindowState>。設定ファイルには保存しないランタイム状態(tauri 層の AppState.window_states)で、キーはウィンドウのラベル" },
    stereotype: "type alias",
    attributes: [],
    position: { x: 8100, y: 5300 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
  },
  {
    name: { physical: "DeviceAuthorization", logical: "DeviceAuthorization", description: "デバイスフロー開始時に GitHub から返る値(GithubGateway::start_device_flow の戻り値。app::lib.rs)" },
    attributes: [
      attr("device_code", "String"),
      attr("user_code", "String"),
      attr("verification_uri", "String"),
      attr("interval_secs", "u64"),
      attr("expires_in_secs", "u64"),
    ],
    position: { x: 9200, y: 4400 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "PollResult", logical: "PollResult", description: "トークンポーリング1回の結果(GithubGateway::poll_for_token の戻り値。app::lib.rs)。Pending: ユーザーがまだ認可していない(interval_secs 待って再試行)/ SlowDown: ポーリング間隔が短すぎた(間隔を広げて再試行)/ Token: 認可完了" },
    stereotype: "enumeration",
    attributes: ["Pending", "SlowDown", "Token(String)"].map(label),
    position: { x: 9200, y: 4800 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "GithubViewer", logical: "GithubViewer", description: "ログイン中の GitHub ユーザー(GithubGateway::fetch_viewer の戻り値。app::lib.rs)" },
    attributes: [attr("login", "String")],
    position: { x: 9200, y: 5100 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 300, h: 0 },
  },
  // ============ worktree の用意(Phase 3。issue #437。PR #440) ============
  {
    name: { physical: "GitWorktreeManager", logical: "GitWorktreeManager", description: "worktree の作成・最新化の port(app/src/worktree.rs。issue #437。Send + Sync)。実装は infra(SystemGitWorktreeManager。git コマンドの実行)。app が「このリポジトリの、このブランチの worktree」を用意して、そこを cwd に claude を起動する。git worktree add / git fetch / git merge は I/O なので port の責務で、app には「どこに作るか・どの順で行うか・失敗したらどうするか」の規則(ユースケース prepare_worktree。関数なので描かない)だけを置く。WorktreeEntry・MergeOutcome はこの図の離れた位置にあるため線は引かない" },
    stereotype: "interface",
    methods: [
      // repo の worktree の一覧(リポジトリ本体を含む。先頭が本体)
      method("list", ["repo: &Path"], "Result<Vec<WorktreeEntry>, AppError>"),
      method("branch_exists", ["repo: &Path", "branch: &str"], "Result<bool, AppError>"),
      // create_from があれば、そのリビジョンからブランチ branch を新しく作ってチェックアウトする
      // (git worktree add -b <branch> <path> <create_from>)。無ければ既存のブランチをチェックアウトする。
      method("add_worktree", ["repo: &Path", "path: &Path", "branch: &str", "create_from: Option<&str>"], "Result<(), AppError>"),
      // git fetch origin(dir は worktree)
      method("fetch_origin", ["dir: &Path"], "Result<(), AppError>"),
      // git merge <rev>(dir は worktree)。競合などで取り込めなければ MergeOutcome::Conflict
      method("merge", ["dir: &Path", "rev: &str"], "Result<MergeOutcome, AppError>"),
      // 途中の merge を取り消す(git merge --abort)。merge が進行中でなくても呼んでよい
      method("abort_merge", ["dir: &Path"], "()"),
    ],
    position: { x: 4900, y: 4300 },
    filePath: "apps/native/crates/app/src/worktree.rs",
    // add_worktree の引数が長く、戻り値型の列と重なるので広げる(GitLedgerStore と同じ理由)。
    size: { w: 1000, h: 0 },
  },
  {
    name: { physical: "SystemGitWorktreeManager", logical: "SystemGitWorktreeManager", description: "git コマンドで worktree を作成・最新化する GitWorktreeManager 実装(git_worktree_manager.rs。issue #437)。フィールドを持たない(ユニット構造体)。ネットワークを使う git fetch には待ち時間の上限(120秒)がある。Windows ではコンソール窓を出さない(CREATE_NO_WINDOW)" },
    attributes: [],
    position: { x: 4900, y: 4650 },
    filePath: "apps/native/crates/infra/src/git_worktree_manager.rs",
  },
  {
    name: { physical: "WorktreeSpec", logical: "WorktreeSpec", description: "どの worktree で起動するかの指定(app/src/worktree.rs。画面から来る値。パスは含まない。issue #437)。パスはフロントから受け取らず app が決める(native.md §4)。tauri の WorktreeSpecDto から変換される。Main: リポジトリ本体で起動する(1つ目の worktree。worktree は作らない)/ Existing: 既存の worktree(台帳の GitWorktree.worktree_id)/ Branch: このブランチの worktree で起動する(あればそれを使い、無ければ app が用意する。ブランチも無ければ origin/main から作る)" },
    stereotype: "enumeration",
    attributes: [
      "Main",
      "Existing { worktree_id: String }",
      "Branch { branch_name: String }",
    ].map(label),
    position: { x: 9000, y: 3350 },
    filePath: "apps/native/crates/app/src/worktree.rs",
    layer: "application",
    size: { w: 460, h: 0 },
  },
  {
    name: { physical: "ResolvedWorktree", logical: "ResolvedWorktree", description: "起動に使える形で用意した worktree に、台帳の ID を添えたもの(app/src/worktree.rs。issue #437)。prepare_worktree のあと、新しい worktree を Git 台帳へ反映してから WorktreeIndex::id_of で引く。起動要求(ResumeRunningSession / CreateRunningSession)が持つ。path が cwd になる。リポジトリ本体は予約 ID main-worktree、リポジトリの worktree のどれでもない場所は outside-repository" },
    attributes: [
      attr("path", "PathBuf"),
      attr("worktree_id", "String"),
    ],
    position: { x: 9600, y: 3350 },
    filePath: "apps/native/crates/app/src/worktree.rs",
    layer: "application",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "WorktreeIndex", logical: "WorktreeIndex", description: "台帳から作る、パス → worktree_id の対応(リポジトリ1つぶん。app/src/worktree.rs。issue #437)。再開のように会話ファイルの cwd で起動するとき、その cwd がどの worktree かを記録するために使う。フィールドは private(操作はメソッド経由)。from_ledger は GitLedger の repository_path のリポジトリの、削除されていない worktree から作る。id_of はリポジトリ本体なら MAIN_WORKTREE_ID、台帳の worktree ならその ID、どれでもなければ OUTSIDE_WORKTREE_ID。path_of は台帳の worktree_id の worktree のパス(本体の予約 ID は本体のパス)。knows は path が台帳の worktree(本体を除く)として引けるか。GitLedger は classes-native-prototype.ts の離れた位置にあるため線は引かない" },
    attributes: [
      { ...attr("repository_path", "PathBuf"), visibility: "private" },
      { ...attr("entries", "Vec<(PathBuf, String)>"), visibility: "private" }, // (worktree のフォルダパス, worktree_id)
    ],
    methods: [
      method("from_ledger", ["ledger: &GitLedger", "repository_path: &Path"], "Self"),
      method("id_of", ["path: &Path"], "String"),
      method("path_of", ["worktree_id: &str"], "Option<PathBuf>"),
      method("knows", ["path: &Path"], "bool"),
    ],
    position: { x: 10100, y: 3350 },
    filePath: "apps/native/crates/app/src/worktree.rs",
    layer: "application",
    size: { w: 620, h: 0 },
  },
  {
    name: { physical: "PreparedWorktree", logical: "PreparedWorktree", description: "用意した worktree(起動の cwd になる。app/src/worktree.rs。issue #437)。prepare_worktree の戻り値。path は worktree の絶対パス、branch_name はチェックアウト中のブランチ名(分かれば)、is_main はリポジトリ本体か、created はこのとき新しく作ったか、synced は起動前の最新化(fetch + merge)を行ったか" },
    attributes: [
      attr("path", "PathBuf"),
      attr("branch_name", "Option<String>"),
      attr("is_main", "bool"),
      attr("created", "bool"),
      attr("synced", "bool"),
    ],
    position: { x: 9000, y: 3700 },
    filePath: "apps/native/crates/app/src/worktree.rs",
    layer: "application",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "WorktreeEntry", logical: "WorktreeEntry", description: "git worktree list の1件(リポジトリ本体を含む。app/src/worktree.rs。issue #437)。GitWorktreeManager::list の要素。branch_name は detached HEAD なら None、is_main はリポジトリ本体の作業ツリーか(git worktree list の先頭)" },
    attributes: [
      attr("path", "PathBuf"),
      attr("branch_name", "Option<String>"),
      attr("is_main", "bool"),
    ],
    position: { x: 9500, y: 3700 },
    filePath: "apps/native/crates/app/src/worktree.rs",
    layer: "application",
    size: { w: 340, h: 0 },
  },
  {
    name: { physical: "MergeOutcome", logical: "MergeOutcome", description: "git merge の結果(GitWorktreeManager::merge の戻り値。app/src/worktree.rs。issue #437)。UpToDate: すでに最新 / Merged: 取り込んだ / Conflict: 競合・その他の理由で取り込めなかった(呼び出し側が abort_merge して、AppError::WorktreeSyncFailed で起動を止める)" },
    stereotype: "enumeration",
    attributes: ["UpToDate", "Merged", "Conflict { detail: String }"].map(label),
    position: { x: 9900, y: 3700 },
    filePath: "apps/native/crates/app/src/worktree.rs",
    layer: "application",
    size: { w: 360, h: 0 },
  },
  // ============ 実行中セッション(Phase 1。issue #391) ============
  // 実行中の検知(#361 のガード)。#391 で find_running に除外する PID(exclude_pids)が加わった。
  {
    name: { physical: "RunningSessionSource", logical: "RunningSessionSource", description: "実行中セッションの検出(port)。app::lib.rs。~/.claude/sessions/<PID>.json の読み取りとプロセス生存確認は infra に閉じ込める。app が起動した claude(RunningSessionByApp)も同じ台帳を書くので、exclude_pids で自分の PID を除外して、外部で実行中かを調べる(issue #345・#391)" },
    stereotype: "interface",
    methods: [
      method("find_running", ["session_id: &str", "exclude_pids: &[u32]"], "Result<Option<DetectedRunning>, AppError>"),
      // 台帳にある実行中セッションの名前(name。--name / Desktop のタブ名。#437)。セッション間メッセージは
      // 名前で宛先を指定するので、起動する CLI の名前をこれと重ならないようにするために使う
      // (終了済みの台帳の名前も含みうる)。
      method("taken_names", [], "Result<Vec<String>, AppError>"),
    ],
    position: { x: 6300, y: 2050 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 640, h: 0 },
  },
  {
    name: { physical: "FileRunningSessionSource", logical: "FileRunningSessionSource", description: "~/.claude/sessions/ の台帳を読み、PID の生存で実行中かを判定する RunningSessionSource 実装(running_session_source.rs)。読めない・分からないときは実行中とみなす側に倒す。台帳を読む型(LedgerEntry。private)は図に描かない" },
    attributes: [attr("sessions_dir", "PathBuf")],
    position: { x: 6300, y: 2400 },
    filePath: "apps/native/crates/infra/src/running_session_source.rs",
  },
  {
    name: { physical: "RunningSessionLauncher", logical: "RunningSessionLauncher", description: "子プロセス(claude)を起動する(port)。app/src/running_session.rs。起動後の出来事は sink へ流す" },
    stereotype: "interface",
    methods: [
      // 起動する claude の版(claude --version の出力。読めなければ None。起動は止めない。#437)
      method("cli_version", [], "Option<String>"),
      method("start", ["request: &StartRunningSession", "sink: Arc<dyn RunningSessionEventSink>"], "Result<Arc<dyn RunningProcess>, AppError>"),
    ],
    position: { x: 6300, y: 2900 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    size: { w: 1000, h: 0 },
  },
  {
    name: { physical: "ClaudeCliProcessLauncher", logical: "ClaudeCliProcessLauncher", description: "claude を起動する RunningSessionLauncher の実装(claude_cli_process.rs)。spawn は Stdio::piped()(Windows は CREATE_NO_WINDOW)。起動引数・標準入出力の JSON 行(wire 形式)を組み立てる・読む関数は claude_stream_json.rs にあり、CLI の wire 形式は infra に閉じ込める(domain に置かない)。leading_args はテストで実行ファイルを差し替えるため" },
    attributes: [
      attr("program", "String"), // private
      attr("leading_args", "Vec<String>"), // private。program の直後に置く引数(テスト用)
    ],
    position: { x: 6300, y: 3250 },
    filePath: "apps/native/crates/infra/src/claude_cli_process.rs",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "RunningProcess", logical: "RunningProcess", description: "起動済みの子プロセス(port)。app/src/running_session.rs。標準入力への書き込み(user メッセージ・権限の応答・中断)と、停止" },
    stereotype: "interface",
    methods: [
      method("pid", [], "u32"),
      method("pid_domain", [], "String"),
      method("send_user_message", ["text: &str", "images: &[ImageAttachment]"], "Result<(), AppError>"),
      method("respond_permission", ["response: &PermissionResponse"], "Result<(), AppError>"),
      method("interrupt", [], "Result<(), AppError>"),
      // 起動中の切り替え(#407)。CLI へ渡す要求の ID は infra が付ける。受け入れられたかは、応答が
      // 出来事 SwitchApplied として届く(ここでは現在値を変えない)。
      method("set_model", ["model: &str"], "Result<(), AppError>"),
      method("set_permission_mode", ["mode: RunningPermissionMode"], "Result<(), AppError>"),
      // 標準入力を閉じて終了を待つ(約1秒)。応答が無ければ強制終了する。終了済みなら何もしない。
      method("stop", [], "()"),
    ],
    position: { x: 6300, y: 3750 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    size: { w: 760, h: 0 },
  },
  {
    name: { physical: "ClaudeCliProcess", logical: "ClaudeCliProcess", description: "起動済みの claude 子プロセス(RunningProcess の実装。claude_cli_process.rs。private)。書き込みは行の途中で混ざらないよう stdin のロックの中で1行ずつ。stop は stdin を閉じて最大3秒待ち、応答が無ければプロセスツリーごと強制終了する(Windows: taskkill /T /F → Child::kill)。Drop でも止める" },
    attributes: [
      attr("pid", "u32"),
      attr("stdin", "Mutex<Option<ChildStdin>>"), // stop で閉じる(None)
      attr("child", "Arc<Mutex<Child>>"),
      attr("exit", "Arc<ExitSignal>"), // 共有される(線 exit は関連)
      attr("next_request", "AtomicU64"), // 中断・切り替えの要求の request_id の連番
      // 送った切り替えの要求(応答が成功なら SwitchApplied にする。読み取りスレッドと共有。#407)
      attr("pending", "Arc<PendingSwitches>"),
    ],
    position: { x: 6300, y: 4200 },
    filePath: "apps/native/crates/infra/src/claude_cli_process.rs",
    size: { w: 380, h: 0 },
  },
  {
    name: { physical: "ExitSignal", logical: "ExitSignal", description: "プロセスの終了を待つための合図(claude_cli_process.rs。private)。読み取りスレッドが終了を見届けて立てる" },
    attributes: [
      attr("exited", "Mutex<bool>"),
      attr("changed", "Condvar"),
    ],
    position: { x: 6950, y: 4200 },
    filePath: "apps/native/crates/infra/src/claude_cli_process.rs",
    size: { w: 260, h: 0 },
  },
  {
    name: { physical: "RunningSessionEventSink", logical: "RunningSessionEventSink", description: "実行中セッションからの出来事の受け口(port)。app/src/running_session.rs。実装は tauri 層(ChannelSink。classes-tauri.ts)で、別の図の離れた位置にあるため、ほかの port の実装と違い実現の線は引かない。読み取りスレッドから呼ばれるので、呼び出しは順序どおりに届く前提で、ブロックしないこと(Send + Sync)" },
    stereotype: "interface",
    methods: [method("emit", ["event: RunningSessionEvent"], "()")],
    position: { x: 6300, y: 4650 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    size: { w: 420, h: 0 },
  },
  // app クレートの型(port の入出力)。app の非 port の型は基本的にこの図に載せていないが、
  // 上の port のシグネチャに出てくるものはここに載せた(層はアプリケーションのビジネスルール)。
  {
    name: { physical: "StartRunningSession", logical: "StartRunningSession", description: "起動の要求(app/src/running_session.rs)。値は app が解決済みで、フロントから受け取ったパスは含まない(cwd は会話ファイル・プロファイルから求める。native.md §4)。再開と新規で持つ値が違う(新規は ID を app が決め、既存の会話ファイルから cwd を求められない)ので、平らな型に Option を並べずバリアントで表す(Phase 1 は struct。#407 で enum に)。Resume: 既存の会話を --resume で開く / New: 新しい会話を --session-id で始める(ID は app が UUID v4 で決める。cwd はリポジトリ)。repository_path はプロファイルのリポジトリ(RunningSessionByApp.repository_path の元)、name は表示名(--name。任意)" },
    stereotype: "enumeration",
    attributes: [
      // worktree_id は起動する worktree の ID(記録用。#437)。cwd は用意した worktree のパス。
      "Resume { session_id: String, cwd: PathBuf, mode: RunningPermissionMode, repository_path: PathBuf, worktree_id: String, name: Option<String> }",
      "New { session_id: String, cwd: PathBuf, mode: RunningPermissionMode, repository_path: PathBuf, worktree_id: String, name: Option<String> }",
    ].map(label),
    methods: [
      // どちらのバリアントにも同じ名前で取り出せる(値はバリアントごとに持つ)。
      method("session_id", [], "&str"),
      method("cwd", [], "&Path"),
      method("mode", [], "RunningPermissionMode"),
      method("repository_path", [], "&Path"),
      method("worktree_id", [], "&str"),
      method("name", [], "Option<&str>"),
      method("is_new", [], "bool"),
    ],
    position: { x: 7700, y: 1450 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 1250, h: 0 },
  },
  {
    name: { physical: "RunningPermissionMode", logical: "RunningPermissionMode", description: "画面で選べる権限モード(app/src/running_session.rs)。Plan(計画だけ)/ Default(すべてのツール使用が権限の問い合わせとして届く)/ AcceptEdits(編集は問い合わせない)/ Auto(#407 で AcceptEdits と Auto が加わった)。CLI の版で名前が変わる(2.1.280 では default が manual に改名)ので、as_cli_value(CLI へ渡す値)と、その逆写像 from_cli_value(manual も Default に対応づける。画面が扱わない値 = bypassPermissions / dontAsk などは None で、画面は文字列のまま出す)を持つ。domain の RunningSessionByApp.current_permission_mode は文字列で、対応づけは app の責務" },
    stereotype: "enumeration",
    attributes: ["Plan", "Default", "AcceptEdits", "Auto"].map(label),
    methods: [
      method("as_cli_value", [], "&'static str"),
      method("from_cli_value", ["value: &str"], "Option<Self>"),
    ],
    position: { x: 7700, y: 2050 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "StartedRunningSession", logical: "StartedRunningSession", description: "resume_running_session / create_running_session の結果(app/src/running_session.rs。Phase 1 の start_running_session は #407 で2つに分かれた)。session は domain::RunningSessionByApp(classes-domain.ts)、process は RunningProcess(この図の port)で、いずれも離れた位置にあるため線は引かない" },
    attributes: [
      attr("session", "domain::RunningSessionByApp"),
      attr("process", "Arc<dyn RunningProcess>"),
    ],
    position: { x: 9000, y: 2050 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "RunningSessionEvent", logical: "RunningSessionEvent", description: "実行中セッション(子プロセス)からの出来事(app/src/running_session.rs)。infra の読み取りスレッドが、CLI の wire 形式を domain の型に写したうえで RunningSessionEventSink へ流す。子プロセスごとの受け口は宛先(pid)を起動後にしか知らないので宛先を持たず、tauri の処理タスクが宛先を付ける(AddressedRunningSessionEvent)。apply_running_session_event(純粋な規則)が状態へ反映する: Initialized → Initialized / Configured → 現在のモデル・権限モードを反映(値のあるものだけ)/ SwitchApplied → 受け入れられた切り替えを現在値へ反映 / Progress(TurnFinished) → TurnFinished / Progress(それ以外) → 状態は動かさない / ModelsListed → 状態は動かさない(tauri が slot に保持して画面へ知らせる) / PermissionRequested → 答え待ちに足して PermissionAsked / PermissionCancelled → 答え待ちから外す / Exited → 答え待ちを捨てて Exited(Configured と SwitchApplied は #407、ModelsListed は #409 で加わった)" },
    stereotype: "enumeration",
    attributes: [
      "Initialized",
      // 選べるモデルの一覧(#409。PR #418)。AvailableModel はこの図の、離れた位置。
      "ModelsListed(Vec<AvailableModel>)",
      "Configured { model: Option<String>, permission_mode: Option<String> }",
      "SwitchApplied(RunningSessionSwitch)",
      "Progress(domain::ProgressEvent)",
      "PermissionRequested(domain::PermissionRequest)",
      "PermissionCancelled { request_id: String }",
      "Exited { exit_code: Option<i32>, stderr_tail: String }",
    ].map(label),
    position: { x: 7700, y: 3350 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 620, h: 0 },
  },
  {
    name: { physical: "PermissionDecision", logical: "PermissionDecision", description: "画面から受け取る、権限の問い合わせへの答え(app/src/running_session.rs)。取り消し(Cancelled)は CLI 側が決めるもので画面からは選べない。拒否メッセージを省略したときは「ユーザーが拒否しました」がそのままモデルへの tool_result になる" },
    stereotype: "enumeration",
    attributes: [
      "Allow { updated_input: Option<serde_json::Value>, updated_permissions: Option<serde_json::Value> }",
      "Deny { message: Option<String> }",
    ].map(label),
    position: { x: 7700, y: 3800 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 700, h: 0 },
  },
  {
    name: { physical: "DetectedRunning", logical: "DetectedRunning", description: "送信先が外部で実行中とみなされた根拠(app::lib.rs。issue #345)。エラーメッセージに含め、誤って止められたときにユーザーが原因(台帳ファイル・PID)を見つけて自分で解消できるようにする。#391 で `RunningSession` から改名した(domain に、クラス図の実行中セッション domain::RunningSession が入ったため)" },
    attributes: [
      attr("ledger_path", "PathBuf"), // 根拠になった台帳(~/.claude/sessions/<PID>.json)のパス
      attr("pid", "u32"),
      attr("evidence", "RunningEvidence"),
    ],
    position: { x: 9000, y: 2400 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "RunningEvidence", logical: "RunningEvidence", description: "DetectedRunning の根拠の強さ(app::lib.rs)。SessionMatched: 台帳の sessionId が送信先と一致し、そのプロセスが生きている / LedgerUnreadable: 台帳から sessionId を取り出せず照合できないが、そのプロセスが生きているため、安全側で実行中とみなした" },
    stereotype: "enumeration",
    attributes: ["SessionMatched", "LedgerUnreadable"].map(label),
    position: { x: 9000, y: 2750 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 300, h: 0 },
  },
  // ---- Phase 2(複数セッション・モード切替・新規作成。issue #407) ----
  {
    name: { physical: "AvailableModel", logical: "AvailableModel", description: "画面で選べるモデル1つ(app/src/running_session.rs。issue #409。PR #418)。CLI が initialize の応答の response.models で報告する値だけを読む(欠けた項目・形の違う要素は捨てる。account などほかの項目は読まない)。set_model は CLI がモデル名を検証しないので、画面はこの一覧から選ばせる。value が set_model に渡す名前、display_name が表示名、description は説明(無いこともある)。RunningSessionEvent の ModelsListed で届く" },
    attributes: [
      attr("value", "String"),
      attr("display_name", "String"),
      attr("description", "Option<String>"),
    ],
    position: { x: 8500, y: 3350 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "RunningSessionSwitch", logical: "RunningSessionSwitch", description: "起動中に切り替える設定(app/src/running_session.rs。issue #407)。CLI の set_model / set_permission_mode(PoC #382 レポート §6.2)に対応する。CLI へ渡す要求の ID は infra が付けるので、ここには無い。Model の名前は CLI が検証しない(存在しない名前も成功で返る)ので、app は文字種・長さだけを検証する" },
    stereotype: "enumeration",
    attributes: ["Model(String)", "PermissionMode(RunningPermissionMode)"].map(label),
    position: { x: 7700, y: 2500 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 520, h: 0 },
  },
  {
    name: { physical: "ResumeRunningSession", logical: "ResumeRunningSession", description: "再開する会話の指定(app/src/running_session.rs。フロントから来る値だけ。cwd は app が会話ファイルから求める。issue #407)。resume_running_session の入力" },
    attributes: [
      attr("project", "String"), // 会話ファイルのあるプロジェクトフォルダ名
      attr("session_id", "String"),
      attr("mode", "RunningPermissionMode"),
      attr("repository_path", "Option<PathBuf>"), // 未設定なら会話の cwd をリポジトリとみなす
      attr("name", "Option<String>"), // 表示名(--name)。任意
      // 指定された worktree(用意済み。#437)。あればそこが cwd(その worktree のプロジェクトフォルダに
      // 会話ファイルがあること)。無ければ従来どおり、会話ファイルに記録された cwd で起動する。
      // ResolvedWorktree・WorktreeIndex はこの図の離れた位置にあるため線は引かない。
      attr("worktree", "Option<ResolvedWorktree>"),
      // 台帳から作った worktree の対応(worktree が無いとき、会話の cwd がどの worktree かを記録するため)
      attr("worktree_index", "WorktreeIndex"),
    ],
    position: { x: 8300, y: 2050 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 480, h: 0 },
  },
  {
    name: { physical: "CreateRunningSession", logical: "CreateRunningSession", description: "新規作成する会話の指定(app/src/running_session.rs。issue #407)。create_running_session の入力。新しい会話の ID は app が決める(new_session_id = UUID v4 を --session-id に渡す)。repository_path が新規の cwd になる(パスはフロントから受け取らない。native.md §4)" },
    attributes: [
      attr("repository_path", "PathBuf"),
      attr("mode", "RunningPermissionMode"),
      attr("name", "Option<String>"), // 表示名(--name)。任意
      // 起動する worktree(用意済み。#437)。そのパスが cwd になる(リポジトリ本体で起動するときは、
      // 本体のパスと予約 ID)。ResolvedWorktree はこの図の離れた位置にあるため線は引かない。
      attr("worktree", "ResolvedWorktree"),
    ],
    position: { x: 8300, y: 2450 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 480, h: 0 },
  },
  {
    name: { physical: "RunningSessionRef", logical: "RunningSessionRef", description: "実行中セッション(app が起動した子プロセス)1つの宛先(app/src/running_session_summary.rs。issue #407)。個体指定子は pid_domain + pid + started_at(pid は OS が使い回すので単独では個体を指定できない。domain の RunningSession と同じ)。画面はこれを持ち回って、送信・応答・購読の対象を指定する" },
    attributes: [
      attr("pid_domain", "String"),
      attr("pid", "u32"),
      attr("started_at", "u64"),
    ],
    methods: [
      method("of", ["session: &domain::RunningSessionByApp"], "Self"),
      method("matches", ["session: &domain::RunningSessionByApp"], "bool"),
    ],
    position: { x: 9700, y: 2050 },
    filePath: "apps/native/crates/app/src/running_session_summary.rs",
    layer: "application",
    size: { w: 500, h: 0 },
  },
  {
    name: { physical: "AddressedProgress", logical: "AddressedProgress", description: "宛先を付けた途中経過(app/src/running_session_summary.rs。issue #407)。domain の ProgressEvent は CLI にも複数セッションにも依存しない中立の型のまま変えず、宛先(RunningSessionRef)を付けた包みをここに置く(#404 の申し送り (d))。Channel(画面ごとの購読)で流す。event は domain::ProgressEvent(classes-domain.ts。別の図の離れた位置にあるため線は引かない)" },
    attributes: [
      attr("target", "RunningSessionRef"),
      attr("event", "domain::ProgressEvent"),
    ],
    position: { x: 10400, y: 2050 },
    filePath: "apps/native/crates/app/src/running_session_summary.rs",
    layer: "application",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "AddressedRunningSessionEvent", logical: "AddressedRunningSessionEvent", description: "宛先を付けた、実行中セッションからの出来事(app/src/running_session_summary.rs。issue #407)。子プロセスごとの受け口は宛先を知らない(pid は起動してから分かる)ので、tauri 層の処理タスクが宛先を付けて状態へ反映する。as_progress は、画面へ流す途中経過(Progress)なら宛先付きで取り出す。event は RunningSessionEvent(この図の、離れた位置)" },
    attributes: [
      attr("target", "RunningSessionRef"),
      attr("event", "RunningSessionEvent"),
    ],
    methods: [method("as_progress", [], "Option<AddressedProgress>")],
    position: { x: 10400, y: 2450 },
    filePath: "apps/native/crates/app/src/running_session_summary.rs",
    layer: "application",
    size: { w: 480, h: 0 },
  },
  {
    name: { physical: "RunningSessionSummary", logical: "RunningSessionSummary", description: "ハブなどが並べる、実行中セッション1つの一覧項目(app/src/running_session_summary.rs。読み取り専用。issue #407)。domain::RunningSessionByApp からの純粋な変換 summarize で作る。答え待ちの問い合わせの中身は持たない(数だけ。中身は get_running_session で取る)。name は #404 の申し送りへの追加: 新規作成の直後は会話ファイルが無く会話タイトルがまだ無いので、一覧は起動時に付けた表示名(--name)を名前に使える。process_state は domain::ProcessState(classes-domain.ts。線は引かない)" },
    attributes: [
      attr("target", "RunningSessionRef"),
      attr("session_id", "String"),
      attr("repository_path", "PathBuf"),
      attr("process_state", "domain::ProcessState"),
      attr("pending_permission_count", "usize"),
      attr("current_model", "Option<String>"),
      attr("current_permission_mode", "Option<String>"),
      attr("cwd", "Option<PathBuf>"),
      // 起動した claude の版(claude --version の出力)と、セッション間メッセージに使える版か
      // (None は版が分からない。使えない版なら状態バー・一覧に警告を出す。起動は止めない。#437)
      attr("cli_version", "Option<String>"),
      attr("peer_messaging", "Option<bool>"),
      attr("name", "Option<String>"),
    ],
    position: { x: 9700, y: 2850 },
    filePath: "apps/native/crates/app/src/running_session_summary.rs",
    layer: "application",
    size: { w: 480, h: 0 },
  },
  {
    name: { physical: "PendingSwitches", logical: "PendingSwitches", description: "送った切り替え(set_model / set_permission_mode)の要求と応答の対応づけ(claude_stream_json.rs。pub(crate)。タプル構造体。issue #407)。CLI の control_response は何を切り替えたかを持たないので、受け入れられたときに何を切り替えたかを引く。要求 ID は infra が付ける(app の型には無い)。書き込みスレッドと読み取りスレッドで共有する。キーは request_id" },
    attributes: [attr("0", "Mutex<HashMap<String, RunningSessionSwitch>>")],
    position: { x: 6950, y: 4550 },
    filePath: "apps/native/crates/infra/src/claude_stream_json.rs",
    size: { w: 560, h: 0 },
  },
];

// port(interface)は app クレートが定義するのでアプリケーションのビジネスルール、
// それを実装する型はインターフェイスアダプター。それ以外のものだけ layer を書く。
const { classes, rel, filePaths, layers } = defineDiagram(DEFS, {
  layerOf: (def) => (def.stereotype === "interface" ? "application" : "adapter"),
});

const RELATIONSHIPS = [
  rel("realization", "FileSystemRepository", "SessionSource", undefined, "top", "bottom"),
  rel("realization", "FileSettingsStore", "SettingsStore", undefined, "top", "bottom"),
  rel("realization", "FileClaudeMdStore", "ClaudeMdStore", undefined, "top", "bottom"),
  rel("realization", "FileClaudeSettingsStore", "ClaudeSettingsStore", undefined, "top", "bottom"),
  rel("realization", "FileRulesStore", "RulesStore", undefined, "top", "bottom"),
  rel("realization", "FileSkillsStore", "SkillsStore", undefined, "top", "bottom"),
  rel("realization", "FileProjectSettingsStore", "ProjectSettingsStore", undefined, "top", "bottom"),
  rel("realization", "FileHubLayoutStore", "HubLayoutStore", undefined, "top", "bottom"),
  rel("realization", "FileHubTuningStore", "HubTuningStore", undefined, "top", "bottom"),
  rel("realization", "FileViewerTabsStore", "ViewerTabsStore", undefined, "top", "bottom"),
  rel("realization", "SystemGitWorktreeManager", "GitWorktreeManager", undefined, "top", "bottom"),
  rel("realization", "WindowsExecutionEnvironmentSource", "ExecutionEnvironmentSource", undefined, "top", "bottom"),
  rel("realization", "GithubApiClient", "GithubGateway", undefined, "top", "bottom"),
  rel("realization", "KeyringTokenStore", "TokenStore", undefined, "top", "bottom"),
  rel("realization", "FileLayoutStore", "LayoutStore", undefined, "top", "bottom"),
  rel("realization", "FileLocalApiTokenStore", "LocalApiTokenStore", undefined, "top", "bottom"),
  rel("realization", "SystemGitWorktreeLister", "GitWorktreeLister", undefined, "top", "bottom"),
  rel("realization", "FileClaudeDirStore", "ClaudeDirStore", undefined, "top", "bottom"),
  // Git台帳・観測(第3弾)
  rel("realization", "FileGitLedgerStore", "GitLedgerStore", undefined, "top", "bottom"),
  rel("realization", "SystemGitStateSource", "GitStateSource", undefined, "top", "bottom"),
  // app の入出力の型(issue #420)。持つ側 → 型(holder → 型の向き)。
  rel("composition", "SessionContent", "FileFingerprint", "fingerprint", "top", "bottom"),
  rel("composition", "CachedMessages", "FileFingerprint", "fingerprint", "top", "right"),
  // 実行中セッション(Phase 1)
  rel("realization", "FileRunningSessionSource", "RunningSessionSource", undefined, "top", "bottom"),
  rel("realization", "ClaudeCliProcessLauncher", "RunningSessionLauncher", undefined, "top", "bottom"),
  rel("realization", "ClaudeCliProcess", "RunningProcess", undefined, "top", "bottom"),
  // exit は Arc で共有される(所有ではないので関連)。
  rel("association", "ClaudeCliProcess", "ExitSignal", "exit", "right", "left"),
  // 値として持つ enum なので、コンポジション(この図の書き方どおり、持つ側 → enum)。
  rel("composition", "ResumeRunningSession", "RunningPermissionMode", "mode", "left", "right"),
  rel("composition", "CreateRunningSession", "RunningPermissionMode", "mode", "left", 290),
  rel("association", "AddressedProgress", "RunningSessionRef", "target", "left", "right"),
  rel("association", "AddressedRunningSessionEvent", "RunningSessionRef", "target", "left", 290),
  rel("association", "RunningSessionSummary", "RunningSessionRef", "target", "top", "bottom"),
  rel("association", "ClaudeCliProcess", "PendingSwitches", "pending", 300, "left"),
  rel("composition", "DetectedRunning", "RunningEvidence", "evidence", "bottom", "top"),
];

export const INFRA_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};

export const INFRA_CLASS_FILE_PATHS: ClassFilePaths = filePaths;
export const INFRA_CLASS_LAYERS: ClassLayers = layers;
