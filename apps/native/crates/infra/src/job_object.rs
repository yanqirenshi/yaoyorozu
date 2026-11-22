//! プロセスの寿命を、Windows のジョブオブジェクトで親(サーバ)に結び付ける。
//!
//! サーバ自身を `KILL_ON_JOB_CLOSE` のジョブへ入れる。サーバが(強制終了を含めて)死ぬと、
//! ジョブのハンドルが閉じられ、**サーバの子孫(claude・その子の git・npm など)が OS によって止められる**。
//! 子はジョブを引き継ぐ。**ブレークアウトは許さない**(`BREAKAWAY_OK` を付けない)。
//!
//! 守れないもの: 親子の関係なく起動されたプロセス(タスクスケジューラ・COM・ShellExecute 経由など)。

use std::sync::OnceLock;
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::GetCurrentProcess;

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
