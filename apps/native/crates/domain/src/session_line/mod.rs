//! Claude Code のセッションログ(`.jsonl`)1行分の型付きデシリアライズ。
//!
//! 型定義は実データの実測調査(`reports/claude-session-jsonl-format.md` §5)
//! に基づく。**公式スキーマではない**ため、以下を徹底する(issue #39):
//!
//! - `deny_unknown_fields` は付けない(未知フィールドは無視する)
//! - 欠損しうるフィールドは `Option` + `#[serde(default)]` にする
//! - 未知の `type`(将来のバージョンで増える可能性がある)は
//!   `#[serde(other)]` で `Unknown` バリアントへ落とし、読み飛ばす
//!
//! ここで得られる値はビューアの会話表示に必要な範囲(`user`/`assistant` の
//! 本文、`cwd`、`sessionId`、`customTitle`)の抽出にのみ使う。他の型
//! (`system`/`pr-link` 等)は将来の機能拡張に備えて構造だけ用意してある
//! (issue #39 の時点では未使用)。
//!
//! 33型を1型1ファイルに分割したディレクトリモジュール(native.md §1。
//! issue #184)。このファイルは `mod` 宣言と `pub use` のみ。

mod ai_title_line;
mod api_error_detail;
mod api_error_line;
mod assistant_content_block;
mod assistant_line;
mod assistant_message;
mod atis_latch_line;
mod attachment_line;
mod cache_creation;
mod chain_line_base;
mod compact_boundary_line;
mod compact_metadata;
mod custom_title_line;
mod extract;
mod hook_info;
mod image_block;
mod informational_line;
mod last_prompt_line;
mod mode_line;
mod pr_link_line;
mod queue_operation_line;
mod scanned_line;
// `SessionLine` 型のファイル名を型名のsnake_caseにする規約(native.md §1)に
// 従うと、モジュール名(`session_line`)と同名になる(clippyの
// module_inception は通常アンチパターンとして検出するが、本クレートでは
// 型名とファイル名の1対1対応を優先する。issue #184)。
#[allow(clippy::module_inception)]
mod session_line;
mod stop_hook_summary_line;
mod system_level;
mod system_line;
mod text_block;
mod thinking_block;
mod tool_result_block;
mod tool_use_block;
mod usage;
mod user_content;
mod user_content_block;
mod user_line;
mod user_message;

pub use ai_title_line::AiTitleLine;
pub use api_error_detail::ApiErrorDetail;
pub use api_error_line::ApiErrorLine;
pub use assistant_content_block::AssistantContentBlock;
pub use assistant_line::AssistantLine;
pub use assistant_message::AssistantMessage;
pub use atis_latch_line::AtisLatchLine;
pub use attachment_line::AttachmentLine;
pub use cache_creation::CacheCreation;
pub use chain_line_base::ChainLineBase;
pub use compact_boundary_line::CompactBoundaryLine;
pub use compact_metadata::CompactMetadata;
pub use custom_title_line::CustomTitleLine;
pub use extract::{
    extract_ai_title, extract_custom_title, extract_cwd, extract_git_branch, extract_last_prompt,
    extract_message, extract_mode, extract_session_id, extract_slug,
};
pub use hook_info::HookInfo;
pub use image_block::ImageBlock;
pub use informational_line::InformationalLine;
pub use last_prompt_line::LastPromptLine;
pub use mode_line::ModeLine;
pub use pr_link_line::PrLinkLine;
pub use queue_operation_line::QueueOperationLine;
pub use scanned_line::ScannedLine;
pub use session_line::SessionLine;
pub use stop_hook_summary_line::StopHookSummaryLine;
pub use system_level::SystemLevel;
pub use system_line::SystemLine;
pub use text_block::TextBlock;
pub use thinking_block::ThinkingBlock;
pub use tool_result_block::ToolResultBlock;
pub use tool_use_block::ToolUseBlock;
pub use usage::Usage;
pub use user_content::UserContent;
pub use user_content_block::UserContentBlock;
pub use user_line::UserLine;
pub use user_message::UserMessage;
