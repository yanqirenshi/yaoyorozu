//! ドメインモデル。native.md §1: 1型(クラス)= 1ファイルとし、クラス図
//! (`/class-diagram`)の1クラスとファイルが1対1で対応する状態を保つ
//! (issue #184)。このファイルは `mod` 宣言と `pub use` のみとし、外部から
//! 見たパス(`domain::Pc` 等)は分割前と変えない。

mod agent_kind;
mod camera;
mod claude_dir_entry;
mod claude_dir_page;
mod claude_md_file;
mod claude_settings_file;
mod conversation;
mod git_branch;
mod git_ledger;
mod git_repository;
mod git_worktree;
mod github_project;
mod github_project_summary;
mod hub_layout;
mod hub_tuning;
mod image_attachment;
mod log_line;
mod message;
mod message_image;
mod message_kind;
mod node_position;
mod observed_git_state;
mod parsed_session;
mod pc;
mod permission_behavior;
mod permission_request;
mod permission_request_kind;
mod permission_response;
mod permission_suggestion;
mod process_state;
mod process_trigger;
mod profile;
mod progress_event;
mod project;
mod project_item;
mod project_items_page;
mod project_status_option;
mod role;
mod rule_summary;
mod running_session;
mod running_session_by_app;
mod running_session_external;
mod session;
mod session_file;
mod session_line;
mod session_summary;
mod session_title;
mod settings;
mod skill_summary;
mod timestamp;
mod user;
mod validation;
mod viewer_tab;
mod viewer_tabs;
mod window_state;
mod window_tab;

pub use agent_kind::AgentKind;
pub use camera::Camera;
pub use claude_dir_entry::{
    join_claude_dir_path, sort_claude_dir_entries, ClaudeDirEntry, ClaudeDirEntryKind,
};
pub use claude_dir_page::ClaudeDirPage;
pub use claude_md_file::ClaudeMdFile;
pub use claude_settings_file::ClaudeSettingsFile;
pub use conversation::Conversation;
pub use git_branch::{reconcile_branches, GitBranch};
pub use git_ledger::{GitLedger, GitRepositoryLedger, CURRENT_GIT_LEDGER_VERSION};
pub use git_repository::{repositories_from_profiles, GitRepository};
pub use git_worktree::{reconcile_worktrees, GitWorktree, MAIN_WORKTREE_ID, OUTSIDE_WORKTREE_ID};
pub use github_project::GithubProject;
pub use github_project_summary::GithubProjectSummary;
pub use hub_layout::{HubLayout, CURRENT_HUB_LAYOUT_VERSION};
pub use hub_tuning::{HubTuning, CURRENT_HUB_TUNING_VERSION};
pub use image_attachment::{
    validate_image_attachment, validate_image_attachments, validate_image_count, ImageAttachment,
    ImageAttachmentError, ImageMediaType, MAX_IMAGES_PER_MESSAGE, MAX_IMAGE_BASE64_LEN,
};
pub use log_line::{
    convert_json_line_to_log_line, convert_session_line, AssistantLogLine, AttachmentLogLine,
    LogLine, LogLineBase, LogLineConversionError, SystemLogLine, UserLogLine,
};
pub use message::{
    keep_peer_send_results_of_sent_messages, mark_failed_questions, order_messages_newest_first,
    paginate_messages, Message, MessageStatus,
};
pub use message_image::{extract_message_images, MessageImage};
pub use message_kind::MessageKind;
pub use node_position::NodePosition;
pub use observed_git_state::{ObservedGitState, ObservedWorktree};
pub use parsed_session::ParsedSession;
pub use pc::Pc;
pub use permission_behavior::PermissionBehavior;
pub use permission_request::PermissionRequest;
pub use permission_request_kind::PermissionRequestKind;
pub use permission_response::PermissionResponse;
pub use permission_suggestion::PermissionSuggestion;
pub use process_state::ProcessState;
pub use process_trigger::ProcessTrigger;
pub use profile::Profile;
pub use progress_event::ProgressEvent;
pub use project::{sort_projects_by_recency, Project};
pub use project_item::{ProjectItem, ProjectItemKind};
pub use project_items_page::ProjectItemsPage;
pub use project_status_option::ProjectStatusOption;
pub use role::Role;
pub use rule_summary::RuleSummary;
pub use running_session::RunningSession;
pub use running_session_by_app::RunningSessionByApp;
pub use running_session_external::RunningSessionExternal;
pub use session::Session;
pub use session_file::SessionFile;
pub use session_summary::{sort_sessions_newest_first, SessionSummary};
pub use session_title::{excerpt, resolve_session_title};
pub use settings::{effective_projects_dir, Settings, CURRENT_SETTINGS_VERSION};
pub use skill_summary::SkillSummary;
pub use timestamp::parse_iso_timestamp_to_epoch_ms;
pub use user::User;
pub use validation::{
    is_valid_claude_dir_path, is_valid_json, is_valid_project_dir_name, is_valid_rule_file_name,
    is_valid_session_id, is_valid_skill_name,
};
pub use viewer_tab::ViewerTab;
pub use viewer_tabs::{ViewerTabs, CURRENT_VIEWER_TABS_VERSION};
pub use window_state::WindowState;
pub use window_tab::WindowTab;

/// セッションログ(`.jsonl`)1行分の型付きデシリアライズ(issue #39)。
/// `extract_message`/`extract_cwd`/`extract_session_id`/`extract_custom_title`
/// は挙動を変えないリファクタリングとして既存の呼び出し元(infra)から
/// そのまま使えるよう、モジュール名を介さずクレート直下に再エクスポートする。
pub use session_line::{
    extract_ai_title, extract_custom_title, extract_cwd, extract_git_branch, extract_last_prompt,
    extract_message, extract_mode, extract_session_id, extract_slug, AssistantLine, AttachmentLine,
    ChainLineBase, ScannedLine, SessionLine, SystemLevel, UserLine,
};
