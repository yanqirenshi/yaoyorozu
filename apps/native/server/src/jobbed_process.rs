//! claude の子プロセスに、**その会話用のジョブ**を結び付ける包み(`app::RunningProcess`)。
//!
//! 停止(`stop`)のとき、claude を穏やかに止めたあと、ジョブごと止める。切り離して起動された子・親が先に終わった
//! 孫が、サーバが動いている間に残らない。ジョブに入れられない環境(入れ子にできない・権限が無い)では、包まずに
//! 今の動き(claude 自身だけを止める)のまま続ける(ログに出す)。ほかの操作は、そのまま中身へ渡す。

use app::{AppError, RunningPermissionMode, RunningProcess};
use domain::{ImageAttachment, PermissionResponse};
use infra::ConversationJob;
use std::sync::Arc;

pub struct JobbedProcess {
    inner: Arc<dyn RunningProcess>,
    job: ConversationJob,
}

impl JobbedProcess {
    /// 起動した `process` を、その会話用のジョブへ入れて包む。入れられなければ、そのまま返す(ログに出す)。
    pub fn wrap(process: Arc<dyn RunningProcess>) -> Arc<dyn RunningProcess> {
        match ConversationJob::assign(process.pid()) {
            Ok(job) => Arc::new(Self {
                inner: process,
                job,
            }),
            Err(e) => {
                eprintln!("会話用のジョブを使えないため、停止は claude 自身だけを止めます: {e}");
                process
            }
        }
    }
}

impl RunningProcess for JobbedProcess {
    fn pid(&self) -> u32 {
        self.inner.pid()
    }
    fn pid_domain(&self) -> String {
        self.inner.pid_domain()
    }
    fn send_user_message(&self, text: &str, images: &[ImageAttachment]) -> Result<(), AppError> {
        self.inner.send_user_message(text, images)
    }
    fn respond_permission(&self, response: &PermissionResponse) -> Result<(), AppError> {
        self.inner.respond_permission(response)
    }
    fn interrupt(&self) -> Result<(), AppError> {
        self.inner.interrupt()
    }
    fn set_model(&self, model: &str) -> Result<(), AppError> {
        self.inner.set_model(model)
    }
    fn set_permission_mode(&self, mode: RunningPermissionMode) -> Result<(), AppError> {
        self.inner.set_permission_mode(mode)
    }
    fn get_usage(&self) -> Result<(), AppError> {
        self.inner.get_usage()
    }
    fn stop(&self) {
        self.inner.stop();
        // claude が終わったあとに残った子孫を、ジョブごと止める。
        self.job.terminate();
    }
}
