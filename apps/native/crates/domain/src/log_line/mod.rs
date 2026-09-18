//! クラス図の `LogLine`(抽象)+ 4サブクラス(issue #208)。33型の
//! `session_line`と同じく、まとまりの大きい型群のディレクトリモジュール
//! (native.md §1)。このファイルは `mod` 宣言と `pub use` のみ。

mod assistant_log_line;
mod attachment_log_line;
#[allow(clippy::module_inception)]
mod log_line;
mod log_line_base;
mod system_log_line;
mod user_log_line;

pub use assistant_log_line::AssistantLogLine;
pub use attachment_log_line::AttachmentLogLine;
pub use log_line::LogLine;
pub use log_line_base::LogLineBase;
pub use system_log_line::SystemLogLine;
pub use user_log_line::UserLogLine;
