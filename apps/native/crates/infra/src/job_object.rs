//! プロセスの寿命を、Windows のジョブオブジェクトで親(サーバ)に結び付ける。
//!
//! サーバ自身を `KILL_ON_JOB_CLOSE` のジョブへ入れる。サーバが(強制終了を含めて)死ぬと、
//! ジョブのハンドルが閉じられ、**サーバの子孫(claude・その子の git・npm など)が OS によって止められる**。
//! 子はジョブを引き継ぐ。**ブレークアウトは許さない**(`BREAKAWAY_OK` を付けない)。
//!
//! 守れないもの: 親子の関係なく起動されたプロセス(タスクスケジューラ・COM・ShellExecute 経由など)。

use std::sync::OnceLock;
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HANDLE, STILL_ACTIVE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SET_QUOTA, PROCESS_TERMINATE,
};

/// ジョブのハンドル。プロセスの終わりまで閉じない(閉じると子孫が止まる)。
struct JobHandle(#[allow(dead_code)] HANDLE);
// ハンドルはプロセス内のどのスレッドからも使えるカーネルオブジェクトへの参照で、持つだけ(使わない)。
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}

static JOB: OnceLock<JobHandle> = OnceLock::new();

/// 自分自身を `KILL_ON_JOB_CLOSE` のジョブへ入れる。成功したら、実際にジョブに入っているかも確かめて返す。
///
/// 失敗しても起動は止めない(呼び出し側がログに出して続ける)。2 回目以降の呼び出しは何もしない。
pub fn place_current_process_in_kill_on_close_job() -> Result<(), String> {
    if JOB.get().is_some() {
        return Ok(());
    }
    // SAFETY: 引数は有効なポインタか `None`。作ったハンドルは成功したら `JOB` に持たせて閉じない。
    unsafe {
        let job = CreateJobObjectW(None, windows::core::PCWSTR::null())
            .map_err(|e| format!("ジョブオブジェクトを作れません: {e}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(e) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) {
            let _ = CloseHandle(job);
            return Err(format!("ジョブの設定に失敗しました: {e}"));
        }
        if let Err(e) = AssignProcessToJobObject(job, GetCurrentProcess()) {
            let _ = CloseHandle(job);
            return Err(format!("ジョブへ入れません: {e}"));
        }
        // 入れたことを、自分のジョブについて確かめる。
        let mut inside = BOOL(0);
        IsProcessInJob(GetCurrentProcess(), Some(job), &mut inside)
            .map_err(|e| format!("ジョブへの所属を確かめられません: {e}"))?;
        if !inside.as_bool() {
            return Err("ジョブへ入ったはずが、所属を確かめられませんでした".to_string());
        }
        let _ = JOB.set(JobHandle(job));
    }
    Ok(())
}

/// **会話 1 つ専用のジョブ**(サーバのジョブの中の入れ子。Windows 8 以降)。claude を 1 つ起動するたびに、その
/// プロセスを入れる。以後その子孫(切り離して起動した子・親が先に終わった孫を含む)は、このジョブに残る。
/// [`terminate`](Self::terminate) で、ジョブの中を**ジョブごと**止める。閉じる(`Drop`)と、`KILL_ON_JOB_CLOSE` で
/// 中身も止まる(会話の控えを忘れるとき・サーバの終了)。
pub struct ConversationJob(HANDLE);

// ハンドルはプロセス内のどのスレッドからも使えるカーネルオブジェクトへの参照。
unsafe impl Send for ConversationJob {}
unsafe impl Sync for ConversationJob {}

impl ConversationJob {
    /// 起動した `pid` のプロセスを、新しい専用のジョブへ入れる。入れられない環境(入れ子にできない・権限が無い)
    /// では `Err`(呼び出し側がログに出して、今の動き = 子だけを止める、のまま続ける)。
    pub fn assign(pid: u32) -> Result<Self, String> {
        // SAFETY: 引数は有効な値。作ったハンドルは、失敗したら閉じる。
        unsafe {
            let job = CreateJobObjectW(None, windows::core::PCWSTR::null())
                .map_err(|e| format!("会話用のジョブを作れません: {e}"))?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if let Err(e) = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) {
                let _ = CloseHandle(job);
                return Err(format!("会話用のジョブの設定に失敗しました: {e}"));
            }
            let process = match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                Ok(process) => process,
                Err(e) => {
                    let _ = CloseHandle(job);
                    return Err(format!("プロセスを開けません(PID {pid}): {e}"));
                }
            };
            let assigned = AssignProcessToJobObject(job, process);
            let _ = CloseHandle(process);
            if let Err(e) = assigned {
                let _ = CloseHandle(job);
                return Err(format!("会話用のジョブへ入れません(PID {pid}): {e}"));
            }
            Ok(Self(job))
        }
    }

    /// ジョブの中のプロセスを、全部止める(子孫を残さない)。
    pub fn terminate(&self) {
        // SAFETY: `self.0` は有効なジョブのハンドル。
        unsafe {
            let _ = TerminateJobObject(self.0, 1);
        }
    }
}

impl Drop for ConversationJob {
    fn drop(&mut self) {
        // SAFETY: `self.0` は有効なハンドル(二重に閉じない)。閉じると、中のプロセスも止まる。
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// `pid` のプロセスが存在するか(確認用)。
pub fn process_exists(pid: u32) -> bool {
    // SAFETY: 引数は有効な値。開けたハンドルは閉じる。
    unsafe {
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => {
                let mut code = 0u32;
                let alive =
                    GetExitCodeProcess(handle, &mut code).is_ok() && code == STILL_ACTIVE.0 as u32;
                let _ = CloseHandle(handle);
                alive
            }
            Err(_) => false,
        }
    }
}

/// 自分がいずれかのジョブに入っているか(確認用)。
pub fn current_process_is_in_a_job() -> bool {
    let mut inside = BOOL(0);
    // SAFETY: `inside` は有効な出力先。ジョブを指定しない(`None`)と「どのジョブか」を問わない。
    unsafe { IsProcessInJob(GetCurrentProcess(), None, &mut inside).is_ok() && inside.as_bool() }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// テストのプロセスをジョブへ入れてしまうと、`cargo test` の子孫の扱いが変わるので、
    /// 別のプロセス(子)で確かめる。子は自分自身をジョブへ入れて終わる。
    #[test]
    fn a_child_process_can_place_itself_in_the_job() {
        if std::env::var("INFRA_JOB_TEST_CHILD").is_ok() {
            place_current_process_in_kill_on_close_job().expect("ジョブへ入れる");
            assert!(current_process_is_in_a_job());
            return;
        }
        let exe = std::env::current_exe().unwrap();
        let out = std::process::Command::new(exe)
            .args([
                "--exact",
                "job_object::tests::a_child_process_can_place_itself_in_the_job",
                "--nocapture",
            ])
            .env("INFRA_JOB_TEST_CHILD", "1")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }
}
