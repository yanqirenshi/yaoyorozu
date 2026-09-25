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
 * `session_source.rs` に同居、`ClaudeCliProcess`・`ExitSignal` は `ClaudeCliProcessLauncher` と
 * 同じ `claude_cli_process.rs` に同居)。全24型(実装23 + SessionWatcher)と、
 * app の port 23個を載せた。
 *
 * 【実行中セッション(Phase 1。issue #391)】`RunningSessionSource`(#361 のガード。
 * `exclude_pids` が加わった)・`RunningSessionLauncher`・`RunningProcess`・
 * `RunningSessionEventSink` の4 port と、その実装を載せた。`ExitSignal`(private)は
 * `ClaudeCliProcess` が共有する終了の合図で、port を実装しない補助の型。port の入出力の
 * app の型(`StartRunningSession`・`RunningPermissionMode`・`StartedRunningSession`・
 * `RunningSessionEvent`・`PermissionDecision`・`DetectedRunning`・`RunningEvidence`)は、
 * app の非 port の型は基本的に載せない方針だが、port のシグネチャに出てくるので例外として
 * 載せた(層はアプリケーションのビジネスルール)。`RunningSessionEventSink` の実装
 * (`ChannelSink`)は tauri 層(`classes-tauri.ts`)で、実現の線は引かない。
 * `claude_stream_json.rs`(起動引数・標準入出力の JSON 行・wire → domain の写し)は、型
 * (struct / enum)を持たず関数だけ(wire は `serde_json::Value` から取れるものだけを取り出す。
 * 未知の type / subtype と必須項目の欠けた行は捨てる)なので、クラスとしては描かない。
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
  {
    name: { physical: "AgentGateway", logical: "AgentGateway", description: "エージェントへのメッセージ送信(port)。app::lib.rs" },
    stereotype: "interface",
    methods: [method("send", ["req: SendRequest"], "Result<(), AppError>")],
    position: { x: 4150, y: 3550 },
    filePath: "apps/native/crates/app/src/lib.rs",
    size: { w: 280, h: 0 },
  },
  {
    name: { physical: "ClaudeCliAgent", logical: "ClaudeCliAgent", description: "claude CLI を headless(--print)で起動する AgentGateway 実装(claude_cli_agent.rs)" },
    attributes: [],
    position: { x: 4150, y: 3900 },
    filePath: "apps/native/crates/infra/src/claude_cli_agent.rs",
    size: { w: 260, h: 0 },
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
  // ============ 実行中セッション(Phase 1。issue #391) ============
  // 実行中の検知(#361 のガード)。#391 で find_running に除外する PID(exclude_pids)が加わった。
  {
    name: { physical: "RunningSessionSource", logical: "RunningSessionSource", description: "実行中セッションの検出(port)。app::lib.rs。~/.claude/sessions/<PID>.json の読み取りとプロセス生存確認は infra に閉じ込める。app が起動した claude(RunningSessionByApp)も同じ台帳を書くので、exclude_pids で自分の PID を除外して、外部で実行中かを調べる(issue #345・#391)" },
    stereotype: "interface",
    methods: [method("find_running", ["session_id: &str", "exclude_pids: &[u32]"], "Result<Option<DetectedRunning>, AppError>")],
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
    methods: [method("start", ["request: &StartRunningSession", "sink: Arc<dyn RunningSessionEventSink>"], "Result<Arc<dyn RunningProcess>, AppError>")],
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
      // 標準入力を閉じて終了を待つ(約1秒)。応答が無ければ強制終了する。終了済みなら何もしない。
      method("stop", [], "()"),
    ],
    position: { x: 6300, y: 3750 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    size: { w: 700, h: 0 },
  },
  {
    name: { physical: "ClaudeCliProcess", logical: "ClaudeCliProcess", description: "起動済みの claude 子プロセス(RunningProcess の実装。claude_cli_process.rs。private)。書き込みは行の途中で混ざらないよう stdin のロックの中で1行ずつ。stop は stdin を閉じて最大3秒待ち、応答が無ければプロセスツリーごと強制終了する(Windows: taskkill /T /F → Child::kill)。Drop でも止める" },
    attributes: [
      attr("pid", "u32"),
      attr("stdin", "Mutex<Option<ChildStdin>>"), // stop で閉じる(None)
      attr("child", "Arc<Mutex<Child>>"),
      attr("exit", "Arc<ExitSignal>"), // 共有される(線 exit は関連)
      attr("next_request", "AtomicU64"), // 中断の要求の request_id の連番
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
    name: { physical: "StartRunningSession", logical: "StartRunningSession", description: "起動の要求(app/src/running_session.rs)。値は app が解決済みで、フロントから受け取ったパスは含まない(cwd は会話ファイルから求める。native.md §4)" },
    attributes: [
      attr("session_id", "String"),
      attr("cwd", "PathBuf"),
      attr("mode", "RunningPermissionMode"),
    ],
    position: { x: 7700, y: 2050 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 320, h: 0 },
  },
  {
    name: { physical: "RunningPermissionMode", logical: "RunningPermissionMode", description: "Phase 1 で選べる権限モード。plan(計画だけ)と default(すべてのツール使用が権限の問い合わせとして届く)。auto など他のモードは Phase 2。CLI 2.1.280 では default が manual に改名されているが、判定には使わず CLI へそのまま渡す(as_cli_value)" },
    stereotype: "enumeration",
    attributes: ["Plan", "Default"].map(label),
    methods: [method("as_cli_value", [], "&'static str")],
    position: { x: 7700, y: 2400 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 300, h: 0 },
  },
  {
    name: { physical: "StartedRunningSession", logical: "StartedRunningSession", description: "start_running_session の結果(app/src/running_session.rs)。session は domain::RunningSessionByApp(classes-domain.ts)、process は RunningProcess(この図の port)で、いずれも離れた位置にあるため線は引かない" },
    attributes: [
      attr("session", "domain::RunningSessionByApp"),
      attr("process", "Arc<dyn RunningProcess>"),
    ],
    position: { x: 8250, y: 2050 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "RunningSessionEvent", logical: "RunningSessionEvent", description: "実行中セッション(子プロセス)からの出来事(app/src/running_session.rs)。infra の読み取りスレッドが、CLI の wire 形式を domain の型に写したうえで RunningSessionEventSink へ流す。apply_running_session_event(純粋な規則)が状態へ反映する: Initialized → Initialized / Progress(TurnFinished) → TurnFinished / Progress(それ以外) → 状態は動かさない / PermissionRequested → 答え待ちに足して PermissionAsked / PermissionCancelled → 答え待ちから外す / Exited → 答え待ちを捨てて Exited" },
    stereotype: "enumeration",
    attributes: [
      "Initialized",
      "Progress(domain::ProgressEvent)",
      "PermissionRequested(domain::PermissionRequest)",
      "PermissionCancelled { request_id: String }",
      "Exited { exit_code: Option<i32>, stderr_tail: String }",
    ].map(label),
    position: { x: 7700, y: 3350 },
    filePath: "apps/native/crates/app/src/running_session.rs",
    layer: "application",
    size: { w: 560, h: 0 },
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
    position: { x: 8250, y: 2400 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 400, h: 0 },
  },
  {
    name: { physical: "RunningEvidence", logical: "RunningEvidence", description: "DetectedRunning の根拠の強さ(app::lib.rs)。SessionMatched: 台帳の sessionId が送信先と一致し、そのプロセスが生きている / LedgerUnreadable: 台帳から sessionId を取り出せず照合できないが、そのプロセスが生きているため、安全側で実行中とみなした" },
    stereotype: "enumeration",
    attributes: ["SessionMatched", "LedgerUnreadable"].map(label),
    position: { x: 8250, y: 2750 },
    filePath: "apps/native/crates/app/src/lib.rs",
    layer: "application",
    size: { w: 300, h: 0 },
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
  rel("realization", "WindowsExecutionEnvironmentSource", "ExecutionEnvironmentSource", undefined, "top", "bottom"),
  rel("realization", "GithubApiClient", "GithubGateway", undefined, "top", "bottom"),
  rel("realization", "KeyringTokenStore", "TokenStore", undefined, "top", "bottom"),
  rel("realization", "ClaudeCliAgent", "AgentGateway", undefined, "top", "bottom"),
  rel("realization", "FileLayoutStore", "LayoutStore", undefined, "top", "bottom"),
  rel("realization", "FileLocalApiTokenStore", "LocalApiTokenStore", undefined, "top", "bottom"),
  rel("realization", "SystemGitWorktreeLister", "GitWorktreeLister", undefined, "top", "bottom"),
  rel("realization", "FileClaudeDirStore", "ClaudeDirStore", undefined, "top", "bottom"),
  // Git台帳・観測(第3弾)
  rel("realization", "FileGitLedgerStore", "GitLedgerStore", undefined, "top", "bottom"),
  rel("realization", "SystemGitStateSource", "GitStateSource", undefined, "top", "bottom"),
  // 実行中セッション(Phase 1)
  rel("realization", "FileRunningSessionSource", "RunningSessionSource", undefined, "top", "bottom"),
  rel("realization", "ClaudeCliProcessLauncher", "RunningSessionLauncher", undefined, "top", "bottom"),
  rel("realization", "ClaudeCliProcess", "RunningProcess", undefined, "top", "bottom"),
  // exit は Arc で共有される(所有ではないので関連)。
  rel("association", "ClaudeCliProcess", "ExitSignal", "exit", "right", "left"),
  // 値として持つ enum なので、コンポジション(線は「部分 → 全体」の向き)。
  rel("composition", "RunningPermissionMode", "StartRunningSession", "mode", "top", "bottom"),
  rel("composition", "RunningEvidence", "DetectedRunning", "evidence", "top", "bottom"),
];

export const INFRA_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};

export const INFRA_CLASS_FILE_PATHS: ClassFilePaths = filePaths;
export const INFRA_CLASS_LAYERS: ClassLayers = layers;
