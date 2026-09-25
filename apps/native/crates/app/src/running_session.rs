//! app が起動したまま持つ claude CLI(実行中セッション)のユースケースと port
//! (issue #391。Phase 1「1セッションを app から対話する」)。
//!
//! CLI の起動・標準入出力・wire 形式の解釈といった I/O は port の実装(infra)の責務で、
//! ここには状態遷移を動かす規則と、入力の検証・順序だけを置く(native.md §1)。
//! 途中経過(`ProgressEvent`)は画面へ流すだけで保存しない。

use crate::{AppError, RunningSessionSource, SessionSource};
use domain::{
    is_valid_project_dir_name, is_valid_session_id, validate_image_attachments, ImageAttachment,
    PermissionRequest, PermissionResponse, ProcessState, ProcessTrigger, ProgressEvent,
    RunningSession, RunningSessionByApp,
};
use std::path::PathBuf;
use std::sync::Arc;

/// 画面で選べる権限モード(issue #392 の `plan` / `default` に、Phase 2 で `acceptEdits` /
/// `auto` を足した。issue #407)。CLI の `--permission-mode` / `set_permission_mode` に渡す値と、
/// 起動後の `system/init` が返す値([`RunningSessionByApp::current_permission_mode`])を対応づける。
///
/// CLI 2.1.280 では `default` が `manual` に改名されているが、`default` も受け付けて
/// `system/init` は `default` を返す(PoC #382 レポート §0.3)。`manual` が返ってきたときも
/// `Default` として扱う([`Self::from_cli_value`])。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RunningPermissionMode {
    Plan,
    #[default]
    Default,
    AcceptEdits,
    Auto,
}

impl RunningPermissionMode {
    /// CLI の `--permission-mode`(と `set_permission_mode`)に渡す値。
    pub fn as_cli_value(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Default => "default",
            Self::AcceptEdits => "acceptEdits",
            Self::Auto => "auto",
        }
    }

    /// [`Self::as_cli_value`] の逆写像(CLI が報告した値 → 画面が出すモード)。版で名前が変わる
    /// `manual`(280 で `default` から改名)は `Default` に対応づける。画面が扱わない値
    /// (`bypassPermissions` / `dontAsk` など)は `None`(画面は文字列のまま出す)。
    pub fn from_cli_value(value: &str) -> Option<Self> {
        match value {
            "plan" => Some(Self::Plan),
            "default" | "manual" => Some(Self::Default),
            "acceptEdits" => Some(Self::AcceptEdits),
            "auto" => Some(Self::Auto),
            _ => None,
        }
    }
}

/// 同時に持てる実行中セッション(終了していないもの)の上限。運用の方針で、語彙でも domain の
/// 規則でもない。超えると起動は `session_busy` で止まる。
///
/// 初期値は **8**: `claude` は1つが Node のプロセス(常駐で数百 MB)で、生成中は CPU も使う。
/// 8 つなら一般的な開発機のメモリ(16 GB)に収まり、ハブの一覧も1画面で見渡せる。使わない
/// セッションは「終了」しても会話は残り、`--resume` で開き直せるので、常時の同時数はこれで足りる
/// と見た。足りなければこの定数を変える(値の根拠の記録は issue #407 の PR)。
pub const MAX_RUNNING_SESSIONS: usize = 8;

/// 終了したあとも一覧に残す実行中セッションの数の上限(画面が終了を知り、終了コードなどを
/// 見られるように残す。上限を超えた古いものから忘れる)。
pub const MAX_KEPT_EXITED_SESSIONS: usize = 10;

/// 表示名(`--name`)の長さの上限(文字数)。
const MAX_NAME_CHARS: usize = 100;

/// モデル名(`set_model`)の長さの上限(文字数)。
const MAX_MODEL_CHARS: usize = 100;

/// 起動の要求。値は app が解決済みで、フロントから受け取ったパスは含まない
/// (cwd は会話ファイル・プロファイルから求める。native.md §4)。**再開**と**新規**で持つ値が
/// 違う(新規は ID を app が決め、既存の会話ファイルから cwd を求められない)ので、平らな型に
/// `Option` を並べずバリアントで表す。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartRunningSession {
    /// 既存の会話を `--resume` で開く。
    Resume {
        session_id: String,
        cwd: PathBuf,
        mode: RunningPermissionMode,
        /// プロファイルのリポジトリ。
        repository_path: PathBuf,
        /// 表示名(`--name`)。任意。
        name: Option<String>,
    },
    /// 新しい会話を `--session-id` で始める(ID は app が UUID v4 で決める)。cwd はリポジトリ。
    New {
        session_id: String,
        cwd: PathBuf,
        mode: RunningPermissionMode,
        repository_path: PathBuf,
        name: Option<String>,
    },
}

impl StartRunningSession {
    pub fn session_id(&self) -> &str {
        match self {
            Self::Resume { session_id, .. } | Self::New { session_id, .. } => session_id,
        }
    }

    pub fn cwd(&self) -> &std::path::Path {
        match self {
            Self::Resume { cwd, .. } | Self::New { cwd, .. } => cwd,
        }
    }

    pub fn mode(&self) -> RunningPermissionMode {
        match self {
            Self::Resume { mode, .. } | Self::New { mode, .. } => *mode,
        }
    }

    pub fn repository_path(&self) -> &std::path::Path {
        match self {
            Self::Resume {
                repository_path, ..
            }
            | Self::New {
                repository_path, ..
            } => repository_path,
        }
    }

    pub fn name(&self) -> Option<&str> {
        match self {
            Self::Resume { name, .. } | Self::New { name, .. } => name.as_deref(),
        }
    }

    pub fn is_new(&self) -> bool {
        matches!(self, Self::New { .. })
    }
}

/// 起動中に切り替える設定(issue #407。Phase 2)。CLI の `set_model` / `set_permission_mode`
/// (PoC #382 レポート §6.2)に対応する。CLI へ渡す要求の ID は infra が付けるので、ここには無い。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunningSessionSwitch {
    Model(String),
    PermissionMode(RunningPermissionMode),
}

/// 実行中セッション(子プロセス)からの出来事。infra の読み取りスレッドが、CLI の wire 形式を
/// domain の型に写したうえで [`RunningSessionEventSink`] へ流す。
#[derive(Debug, Clone, PartialEq)]
pub enum RunningSessionEvent {
    /// 最初の `system/init` を受けた(以降のターンごとの `init` も同じ出来事として届く)。
    Initialized,
    /// CLI が報告した現在の設定(`system/init` の `model` / `permissionMode`。ターンごとに届く)。
    /// 項目が無かったものは `None`。
    Configured {
        model: Option<String>,
        permission_mode: Option<String>,
    },
    /// 切り替え(`set_model` / `set_permission_mode`)が CLI に受け入れられた。
    SwitchApplied(RunningSessionSwitch),
    /// 画面へ流す途中経過。
    Progress(ProgressEvent),
    /// ツール使用の問い合わせが届いた。
    PermissionRequested(PermissionRequest),
    /// CLI が問い合わせを取り下げた(中断。`control_cancel_request`)。
    PermissionCancelled { request_id: String },
    /// プロセスが終了した。`stderr_tail` は終了理由の手がかり(起動失敗など。末尾の数行)。
    Exited {
        exit_code: Option<i32>,
        stderr_tail: String,
    },
}

/// 実行中セッションからの出来事の受け口(port。実装は tauri 層)。読み取りスレッドから
/// 呼ばれるので、呼び出しは順序どおりに届く前提で、ブロックしないこと。
pub trait RunningSessionEventSink: Send + Sync {
    fn emit(&self, event: RunningSessionEvent);
}

/// 起動済みの子プロセス(port。実装は infra)。
pub trait RunningProcess: Send + Sync {
    fn pid(&self) -> u32;
    /// pid が有効な範囲(`<OS>:<ホスト名>`)。
    fn pid_domain(&self) -> String;
    /// user メッセージ(本文と画像)を標準入力へ書く。
    fn send_user_message(&self, text: &str, images: &[ImageAttachment]) -> Result<(), AppError>;
    /// 権限の応答を標準入力へ書く。
    fn respond_permission(&self, response: &PermissionResponse) -> Result<(), AppError>;
    /// 生成中(権限待ち中を含む)の中断を要求する。プロセスは生きたまま、次の入力を送れる。
    fn interrupt(&self) -> Result<(), AppError>;
    /// モデルの切り替えを要求する(`set_model`)。受け入れられたかは
    /// [`RunningSessionEvent::SwitchApplied`] で届く(要求 ID の対応づけは実装の責務)。
    fn set_model(&self, model: &str) -> Result<(), AppError>;
    /// 権限モードの切り替えを要求する(`set_permission_mode`)。結果は上と同じ。
    fn set_permission_mode(&self, mode: RunningPermissionMode) -> Result<(), AppError>;
    /// 標準入力を閉じて終了を待つ(約1秒で終了する)。応答が無ければ強制終了する。
    /// 終了済みなら何もしない。
    fn stop(&self);
}

/// 子プロセスを起動する(port。実装は infra)。
pub trait RunningSessionLauncher: Send + Sync {
    /// `request` で `claude` を起動する。起動後の出来事は `sink` へ流す。
    fn start(
        &self,
        request: &StartRunningSession,
        sink: Arc<dyn RunningSessionEventSink>,
    ) -> Result<Arc<dyn RunningProcess>, AppError>;
}

/// [`start_running_session`] の結果。
pub struct StartedRunningSession {
    pub session: RunningSessionByApp,
    pub process: Arc<dyn RunningProcess>,
}

/// 現在時刻(epoch ms)。時計は app に置かない(呼び出し側が渡す)。
pub type NowMs = u64;

/// 再開する会話の指定(フロントから来る値だけ。cwd は app が会話ファイルから求める)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumeRunningSession {
    /// 会話ファイルのあるプロジェクトフォルダ名。
    pub project: String,
    pub session_id: String,
    pub mode: RunningPermissionMode,
    /// プロファイルのリポジトリ(未設定なら会話の cwd をリポジトリとみなす)。
    pub repository_path: Option<PathBuf>,
    /// 表示名(`--name`)。任意。
    pub name: Option<String>,
}

/// 新規作成する会話の指定。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateRunningSession {
    /// プロファイルのリポジトリ。新規の cwd になる(パスはフロントから受け取らない。native.md §4)。
    pub repository_path: PathBuf,
    pub mode: RunningPermissionMode,
    /// 表示名(`--name`)。任意。
    pub name: Option<String>,
}

/// 新しい会話の ID(UUID v4)を決める。app が決めて `--session-id` に渡す(起動時に
/// `RunningSession.session_id` が決まり、domain の型を `Option` にしなくて済む)。
pub fn new_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 終了していない実行中セッションの PID の一覧。#361 のガードで、外部で実行中かを調べるとき、
/// 自分の子プロセスをすべて除外するために使う(PID は使い回されるので、終了済みは含めない)。
pub fn own_running_pids(running: &[RunningSessionByApp]) -> Vec<u32> {
    running
        .iter()
        .filter(|s| s.process_state != ProcessState::Exited)
        .map(|s| s.base.pid)
        .collect()
}

/// 起動してよいかの規則(純粋。I/O は無い)。
///
/// - **同じ会話(`session_id`)を2つ起動しない**: #361 のガードは自分の PID を除外した外部の
///   実行だけを検知する(自分の起動は検知できない)ので、app が持つ集まりの中で `session_id` の
///   一致を見て止める。起動の途中(`starting`)も含める(起動は数秒かかる間に2つ目が来うる)。
/// - 終了していないもの(と起動の途中)が [`MAX_RUNNING_SESSIONS`] に達していたら止める。
///
/// どちらも `session_busy`。
pub fn ensure_can_start(
    running: &[RunningSessionByApp],
    starting: &[String],
    session_id: &str,
) -> Result<(), AppError> {
    let alive = running
        .iter()
        .filter(|s| s.process_state != ProcessState::Exited);
    if let Some(same) = alive.clone().find(|s| s.base.session_id == session_id) {
        return Err(AppError::SessionBusy(format!(
            "この会話はすでに実行中です(PID {})。二重には開けません",
            same.base.pid
        )));
    }
    if starting.iter().any(|id| id == session_id) {
        return Err(AppError::SessionBusy(
            "この会話は起動している最中です".to_string(),
        ));
    }
    if alive.count() + starting.len() >= MAX_RUNNING_SESSIONS {
        return Err(AppError::SessionBusy(format!(
            "同時に実行できるセッションは {MAX_RUNNING_SESSIONS} 個までです。使っていないものを終了してください"
        )));
    }
    Ok(())
}

/// 集まりから忘れる、終了済みの実行中セッション(純粋な規則)。同じ会話を(再び)起動するとき
/// (`starting_session_id`)は、その会話の終了済みを置き換えるので忘れる。それ以外の終了済みは
/// [`MAX_KEPT_EXITED_SESSIONS`] まで残し、超えたぶんを古い(終了した日時の早い)ものから忘れる。
/// 終了していないものは忘れない。
pub fn exited_to_forget(
    running: &[RunningSessionByApp],
    starting_session_id: &str,
) -> Vec<crate::RunningSessionRef> {
    let exited = || {
        running
            .iter()
            .filter(|s| s.process_state == ProcessState::Exited)
    };
    let mut forget: Vec<crate::RunningSessionRef> = exited()
        .filter(|s| s.base.session_id == starting_session_id)
        .map(crate::RunningSessionRef::of)
        .collect();
    let mut kept: Vec<&RunningSessionByApp> = exited()
        .filter(|s| s.base.session_id != starting_session_id)
        .collect();
    kept.sort_by_key(|s| std::cmp::Reverse(s.process_state_at));
    forget.extend(
        kept.into_iter()
            .skip(MAX_KEPT_EXITED_SESSIONS)
            .map(crate::RunningSessionRef::of),
    );
    forget
}

/// 表示名の検証(空白だけなら `None`)。子プロセスの引数になるので、長さと制御文字を制限する。
fn validate_name(name: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) else {
        return Ok(None);
    };
    if name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(format!(
            "表示名は {MAX_NAME_CHARS} 文字以内で、改行などを含めないでください"
        )));
    }
    Ok(Some(name.to_string()))
}

/// 起動して、起動直後(`Starting`)の [`RunningSessionByApp`] を作る(再開・新規の共通部分)。
fn launch(
    launcher: &dyn RunningSessionLauncher,
    request: StartRunningSession,
    sink: Arc<dyn RunningSessionEventSink>,
    now: NowMs,
) -> Result<StartedRunningSession, AppError> {
    let process = launcher.start(&request, sink)?;

    let mut base = RunningSession::new(
        request.session_id(),
        &process.pid_domain(),
        process.pid(),
        now,
    );
    base.cwd = Some(request.cwd().to_path_buf());
    base.name = request.name().map(str::to_string);
    let mut session = RunningSessionByApp::new(base, request.repository_path().to_path_buf(), now);
    // 起動時に選んだ権限モードが、CLI が最初のターンで `system/init` を出すまでの現在値。
    session.current_permission_mode = Some(request.mode().as_cli_value().to_string());
    Ok(StartedRunningSession { session, process })
}

/// 既存の会話 `session_id` を、子プロセスの `claude` として起動する(`--resume`)。
///
/// - 起動してよいかは [`ensure_can_start`](同じ会話の二重起動・上限)。
/// - #361 のガードは**外部**で実行中かを見る。app が起動した子プロセスは同じ台帳を書くので、
///   自分の PID(**全部**。[`own_running_pids`])は除外して調べる。
/// - 起動に成功したら、`Starting` の状態の [`RunningSessionByApp`] を返す(以降の状態は
///   [`apply_running_session_event`] などが動かす)。
#[allow(clippy::too_many_arguments)]
pub fn resume_running_session(
    source: &dyn SessionSource,
    launcher: &dyn RunningSessionLauncher,
    ledger: &dyn RunningSessionSource,
    running: &[RunningSessionByApp],
    starting: &[String],
    request: &ResumeRunningSession,
    sink: Arc<dyn RunningSessionEventSink>,
    now: NowMs,
) -> Result<StartedRunningSession, AppError> {
    if !is_valid_project_dir_name(&request.project) {
        return Err(AppError::InvalidInput(
            "不正なプロジェクト名です".to_string(),
        ));
    }
    if !is_valid_session_id(&request.session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let name = validate_name(request.name.as_deref())?;
    ensure_can_start(running, starting, &request.session_id)?;

    if let Some(found) = ledger.find_running(&request.session_id, &own_running_pids(running))? {
        return Err(AppError::SessionBusy(found.block_message()));
    }

    let cwd = source.session_cwd(&request.project, &request.session_id)?;
    let repository_path = request
        .repository_path
        .clone()
        .unwrap_or_else(|| cwd.clone());
    launch(
        launcher,
        StartRunningSession::Resume {
            session_id: request.session_id.clone(),
            cwd,
            mode: request.mode,
            repository_path,
            name,
        },
        sink,
        now,
    )
}

/// 新しい会話を、子プロセスの `claude` として起動する(`--session-id`)。`session_id` は
/// [`new_session_id`] で決めた UUID(呼び出し側が渡す。時計・乱数は app に置かない)。
/// cwd はリポジトリ(`request.repository_path`)。会話ファイルは最初のメッセージが送られるまで
/// できない([`domain::Session::without_files`])。新規の ID は他で使われていないので、#361 の
/// ガード(外部の実行の検知)は見ない。
pub fn create_running_session(
    launcher: &dyn RunningSessionLauncher,
    running: &[RunningSessionByApp],
    starting: &[String],
    request: &CreateRunningSession,
    session_id: String,
    sink: Arc<dyn RunningSessionEventSink>,
    now: NowMs,
) -> Result<StartedRunningSession, AppError> {
    if !is_valid_session_id(&session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let name = validate_name(request.name.as_deref())?;
    ensure_can_start(running, starting, &session_id)?;
    launch(
        launcher,
        StartRunningSession::New {
            session_id,
            cwd: request.repository_path.clone(),
            mode: request.mode,
            repository_path: request.repository_path.clone(),
            name,
        },
        sink,
        now,
    )
}

/// 送信の準備: 本文・画像の検証(1回きり送信 [`crate::send_message`] と同じ規則。domain の
/// 関数)と、状態を `MessageSent` で動かすところまでを行い、検証済みの画像を返す。書き込みは
/// しない。
///
/// 状態を**書き込みの前に**動かすのは、CLI が数 ms で応答して(エラーなど)読み取りスレッドの
/// 出来事(`TurnFinished`)が、書き込み直後の `MessageSent` より先に状態へ反映されると、
/// 待機のはずが実行中のまま固まるため。呼び出し側(tauri 層)は状態のロックの中でこれを呼び、
/// **ロックを外してから**書き込む(ロック保持中に I/O をしない。native.md §2)。
/// 終了済みには送れない。実行中に次の入力を送ってもよい(キューは CLI 側)。
pub fn begin_send_to_running_session(
    session: &mut RunningSessionByApp,
    text: &str,
    images: &[String],
    now: NowMs,
) -> Result<Vec<ImageAttachment>, AppError> {
    if text.trim().is_empty() && images.is_empty() {
        return Err(AppError::InvalidInput(
            "メッセージを入力してください".to_string(),
        ));
    }
    let images =
        validate_image_attachments(images).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    ensure_not_exited(session)?;
    if session.process_state == ProcessState::Starting {
        // 起動できたか(initialize の応答)が分かる前に送ると、状態の遷移が食い違う
        // (起動中に送った印は遷移表に無く、あとで届く起動完了で待機になってしまう)。
        return Err(AppError::InvalidInput(
            "実行中のセッションを起動している最中です。しばらく待ってから送ってください"
                .to_string(),
        ));
    }
    session.apply(ProcessTrigger::MessageSent, now);
    Ok(images)
}

/// 実行中セッションへ user メッセージを送る([`begin_send_to_running_session`] +
/// 書き込み)。書き込みに失敗したら、標準入力が壊れている(プロセスが終わりつつある)ので、
/// 状態が「実行中」のまま固まらないようプロセスを止める(`Exited` の出来事が続く)。
pub fn send_to_running_session(
    session: &mut RunningSessionByApp,
    process: &dyn RunningProcess,
    text: &str,
    images: &[String],
    now: NowMs,
) -> Result<(), AppError> {
    let images = begin_send_to_running_session(session, text, images, now)?;
    write_or_stop(process, |p| p.send_user_message(text, &images))
}

/// user メッセージを標準入力へ書く(ロックの外で呼ぶ。[`begin_send_to_running_session`] の後)。
/// 失敗したらプロセスを止めてからエラーを返す。
pub fn write_user_message(
    process: &dyn RunningProcess,
    text: &str,
    images: &[ImageAttachment],
) -> Result<(), AppError> {
    write_or_stop(process, |p| p.send_user_message(text, images))
}

/// 権限の応答を標準入力へ書く(ロックの外で呼ぶ。[`begin_respond_permission`] の後)。
/// 失敗したらプロセスを止めてからエラーを返す。
pub fn write_permission_response(
    process: &dyn RunningProcess,
    response: &PermissionResponse,
) -> Result<(), AppError> {
    write_or_stop(process, |p| p.respond_permission(response))
}

/// 書き込みに失敗したらプロセスを止めてからエラーを返す。
fn write_or_stop(
    process: &dyn RunningProcess,
    write: impl FnOnce(&dyn RunningProcess) -> Result<(), AppError>,
) -> Result<(), AppError> {
    write(process).inspect_err(|_| process.stop())
}

/// 権限の問い合わせへの答えの準備: 答え待ちから `request_id` を探し、送る応答を組み立て、
/// 答え待ちから外す(答え待ちが無くなったら状態を動かす)。書き込みはしない(ロックの外で
/// [`RunningProcess::respond_permission`] を呼ぶ。[`begin_send_to_running_session`] と同じ理由で、
/// 状態は先に動かす)。`request_id` が答え待ちに無ければエラー(取り下げ済み・二重応答)。
/// 許可は `updated_input` を省略すると問い合わせの入力をそのまま返す。
pub fn begin_respond_permission(
    session: &mut RunningSessionByApp,
    request_id: &str,
    decision: PermissionDecision,
    now: NowMs,
) -> Result<PermissionResponse, AppError> {
    let request = session
        .permission_requests
        .iter()
        .find(|r| r.request_id == request_id)
        .cloned()
        .ok_or_else(|| {
            AppError::NotFound(
                "その問い合わせは見つかりません(すでに答えたか、取り下げられました)".to_string(),
            )
        })?;

    let response = match decision {
        PermissionDecision::Allow {
            updated_input,
            updated_permissions,
        } => PermissionResponse::allow(
            request_id,
            &request.tool_input,
            updated_input,
            updated_permissions,
            now,
        ),
        PermissionDecision::Deny { message } => PermissionResponse::deny(
            request_id,
            message
                .as_deref()
                .filter(|m| !m.trim().is_empty())
                .unwrap_or(DEFAULT_DENY_MESSAGE),
            now,
        ),
    };
    session.settle_permission_request(request_id, now);
    Ok(response)
}

/// 権限の問い合わせに答える([`begin_respond_permission`] + 書き込み)。書き込みに失敗したら
/// プロセスを止める(理由は [`send_to_running_session`] と同じ)。
pub fn respond_permission(
    session: &mut RunningSessionByApp,
    process: &dyn RunningProcess,
    request_id: &str,
    decision: PermissionDecision,
    now: NowMs,
) -> Result<(), AppError> {
    let response = begin_respond_permission(session, request_id, decision, now)?;
    write_or_stop(process, |p| p.respond_permission(&response))
}

/// 画面から受け取る、権限の問い合わせへの答え。取り消し(`Cancelled`)は CLI 側が決めるもので
/// 画面からは選べない。
#[derive(Debug, Clone, PartialEq)]
pub enum PermissionDecision {
    Allow {
        updated_input: Option<serde_json::Value>,
        updated_permissions: Option<serde_json::Value>,
    },
    Deny {
        message: Option<String>,
    },
}

/// 拒否メッセージを省略したときの文言(そのままモデルへの tool_result になる)。
const DEFAULT_DENY_MESSAGE: &str = "ユーザーが拒否しました";

/// 生成中(権限待ちを含む)の中断を要求する。プロセスは生きたまま次の入力を送れる。
/// 権限待ちのときは、CLI が問い合わせを取り下げる(`PermissionCancelled` が届く)。
/// 状態はここでは動かさない(`result` と取り下げの出来事が動かす)。
pub fn interrupt_running_session(
    session: &RunningSessionByApp,
    process: &dyn RunningProcess,
) -> Result<(), AppError> {
    ensure_not_exited(session)?;
    process.interrupt()
}

/// 切り替え(モデル・権限モード)の準備: 検証だけを行う。書き込みはしない(ロックの外で
/// [`write_switch`] を呼ぶ)。現在値(`current_*`)は、CLI が受け入れたときの
/// [`RunningSessionEvent::SwitchApplied`] で更新する(要求しただけでは変えない)。
/// 終了済み・起動中(`initialize` の応答前)には要求できない。
pub fn begin_switch_running_session(
    session: &RunningSessionByApp,
    switch: &RunningSessionSwitch,
) -> Result<(), AppError> {
    ensure_not_exited(session)?;
    if session.process_state == ProcessState::Starting {
        return Err(AppError::InvalidInput(
            "実行中のセッションを起動している最中です。しばらく待ってから切り替えてください"
                .to_string(),
        ));
    }
    if let RunningSessionSwitch::Model(model) = switch {
        let valid = !model.is_empty()
            && model.chars().count() <= MAX_MODEL_CHARS
            && model.chars().all(|c| {
                c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '[' | ']')
            });
        if !valid {
            return Err(AppError::InvalidInput("不正なモデル名です".to_string()));
        }
    }
    Ok(())
}

/// 切り替えの要求を標準入力へ書く(ロックの外で呼ぶ。[`begin_switch_running_session`] の後)。
/// 失敗したらプロセスを止めてからエラーを返す(理由は [`send_to_running_session`] と同じ)。
pub fn write_switch(
    process: &dyn RunningProcess,
    switch: &RunningSessionSwitch,
) -> Result<(), AppError> {
    write_or_stop(process, |p| match switch {
        RunningSessionSwitch::Model(model) => p.set_model(model),
        RunningSessionSwitch::PermissionMode(mode) => p.set_permission_mode(*mode),
    })
}

/// 子プロセスを止める(標準入力を閉じて終了を待つ)。終了済みでも呼んでよい。
pub fn stop_running_session(
    session: &mut RunningSessionByApp,
    process: &dyn RunningProcess,
    now: NowMs,
) {
    process.stop();
    session.exit(now);
}

/// 子プロセスからの出来事を、実行中セッションの状態へ反映する(純粋な規則)。
///
/// | 出来事 | 状態への反映 |
/// |---|---|
/// | `Initialized` | `Initialized` |
/// | `Configured` | 現在のモデル・権限モードを、報告された値で更新(欠けた項目は変えない) |
/// | `SwitchApplied` | 切り替えた値を現在のモデル・権限モードに反映 |
/// | `Progress(TurnFinished)` | `TurnFinished` |
/// | `Progress`(それ以外) | なし(画面へ流すだけ) |
/// | `PermissionRequested` | 答え待ちに足して `PermissionAsked` |
/// | `PermissionCancelled` | 答え待ちから外し、無くなったら `PermissionSettled` |
/// | `Exited` | 答え待ちを捨てて `Exited` |
pub fn apply_running_session_event(
    session: &mut RunningSessionByApp,
    event: &RunningSessionEvent,
    now: NowMs,
) {
    match event {
        RunningSessionEvent::Initialized => session.apply(ProcessTrigger::Initialized, now),
        RunningSessionEvent::Configured {
            model,
            permission_mode,
        } => session.observe_configuration(model.clone(), permission_mode.clone()),
        RunningSessionEvent::SwitchApplied(switch) => match switch {
            RunningSessionSwitch::Model(model) => session.current_model = Some(model.clone()),
            RunningSessionSwitch::PermissionMode(mode) => {
                session.current_permission_mode = Some(mode.as_cli_value().to_string())
            }
        },
        RunningSessionEvent::Progress(ProgressEvent::TurnFinished { .. }) => {
            session.apply(ProcessTrigger::TurnFinished, now)
        }
        RunningSessionEvent::Progress(_) => {}
        RunningSessionEvent::PermissionRequested(request) => {
            session.receive_permission_request(request.clone(), now)
        }
        RunningSessionEvent::PermissionCancelled { request_id } => {
            session.settle_permission_request(request_id, now);
        }
        RunningSessionEvent::Exited { .. } => session.exit(now),
    }
}

fn ensure_not_exited(session: &RunningSessionByApp) -> Result<(), AppError> {
    if session.process_state == ProcessState::Exited {
        return Err(AppError::InvalidInput(
            "実行中のセッションは終了しています。開き直してください".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DetectedRunning;
    use domain::{PermissionBehavior, Project};
    use std::sync::Mutex;

    // ---- フェイク ----

    #[derive(Default)]
    struct FakeProcess {
        sent: Mutex<Vec<(String, usize)>>,
        responses: Mutex<Vec<PermissionResponse>>,
        interrupts: Mutex<usize>,
        stopped: Mutex<usize>,
        switches: Mutex<Vec<RunningSessionSwitch>>,
        fail_send: bool,
        /// 0 のときは 4242。
        pid: u32,
    }

    impl RunningProcess for FakeProcess {
        fn pid(&self) -> u32 {
            if self.pid == 0 {
                4242
            } else {
                self.pid
            }
        }
        fn pid_domain(&self) -> String {
            "windows:PC".to_string()
        }
        fn send_user_message(
            &self,
            text: &str,
            images: &[ImageAttachment],
        ) -> Result<(), AppError> {
            if self.fail_send {
                return Err(AppError::Io("pipe closed".to_string()));
            }
            self.sent
                .lock()
                .unwrap()
                .push((text.to_string(), images.len()));
            Ok(())
        }
        fn respond_permission(&self, response: &PermissionResponse) -> Result<(), AppError> {
            self.responses.lock().unwrap().push(response.clone());
            Ok(())
        }
        fn interrupt(&self) -> Result<(), AppError> {
            *self.interrupts.lock().unwrap() += 1;
            Ok(())
        }
        fn set_model(&self, model: &str) -> Result<(), AppError> {
            self.switches
                .lock()
                .unwrap()
                .push(RunningSessionSwitch::Model(model.to_string()));
            Ok(())
        }
        fn set_permission_mode(&self, mode: RunningPermissionMode) -> Result<(), AppError> {
            self.switches
                .lock()
                .unwrap()
                .push(RunningSessionSwitch::PermissionMode(mode));
            Ok(())
        }
        fn stop(&self) {
            *self.stopped.lock().unwrap() += 1;
        }
    }

    struct FakeLauncher {
        process: Arc<FakeProcess>,
        started: Mutex<Vec<StartRunningSession>>,
    }

    impl FakeLauncher {
        fn new() -> Self {
            Self::with_pid(0)
        }
        fn with_pid(pid: u32) -> Self {
            Self {
                process: Arc::new(FakeProcess {
                    pid,
                    ..FakeProcess::default()
                }),
                started: Mutex::new(Vec::new()),
            }
        }
    }

    impl RunningSessionLauncher for FakeLauncher {
        fn start(
            &self,
            request: &StartRunningSession,
            _sink: Arc<dyn RunningSessionEventSink>,
        ) -> Result<Arc<dyn RunningProcess>, AppError> {
            self.started.lock().unwrap().push(request.clone());
            Ok(self.process.clone())
        }
    }

    struct NullSink;
    impl RunningSessionEventSink for NullSink {
        fn emit(&self, _event: RunningSessionEvent) {}
    }

    /// 台帳のフェイク。`running_pid` の PID の台帳が sessionId 一致で残っている状況を作る。
    /// 実物と同じく、`exclude_pids` に入っている PID は見ない。
    struct FakeLedger {
        running_pid: Option<u32>,
        asked_excludes: Mutex<Vec<Vec<u32>>>,
    }

    impl FakeLedger {
        fn none() -> Self {
            Self {
                running_pid: None,
                asked_excludes: Mutex::new(Vec::new()),
            }
        }
        fn with_pid(pid: u32) -> Self {
            Self {
                running_pid: Some(pid),
                asked_excludes: Mutex::new(Vec::new()),
            }
        }
    }

    impl RunningSessionSource for FakeLedger {
        fn find_running(
            &self,
            _session_id: &str,
            exclude_pids: &[u32],
        ) -> Result<Option<DetectedRunning>, AppError> {
            self.asked_excludes
                .lock()
                .unwrap()
                .push(exclude_pids.to_vec());
            Ok(self
                .running_pid
                .filter(|pid| !exclude_pids.contains(pid))
                .map(|pid| DetectedRunning {
                    ledger_path: PathBuf::from(format!("/sessions/{pid}.json")),
                    pid,
                    evidence: crate::RunningEvidence::SessionMatched,
                }))
        }
    }

    struct FakeSource;
    impl SessionSource for FakeSource {
        fn list_projects(&self) -> Result<Vec<Project>, AppError> {
            Ok(Vec::new())
        }
        fn read_session(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<crate::SessionContent, AppError> {
            Err(AppError::NotFound("unused".to_string()))
        }
        fn session_fingerprint(
            &self,
            _project: &str,
            _session_id: &str,
        ) -> Result<crate::FileFingerprint, AppError> {
            Err(AppError::NotFound("unused".to_string()))
        }
        fn session_cwd(&self, _project: &str, _session_id: &str) -> Result<PathBuf, AppError> {
            Ok(PathBuf::from("/work/proj"))
        }
        fn list_sessions(&self, _project: &str) -> Result<Vec<domain::SessionSummary>, AppError> {
            Ok(Vec::new())
        }
        fn list_parsed_sessions(
            &self,
            _project: &str,
        ) -> Result<Vec<domain::ParsedSession>, AppError> {
            Ok(Vec::new())
        }
        fn session_line_raw(
            &self,
            _project: &str,
            _session_id: &str,
            _uuid: &str,
        ) -> Result<String, AppError> {
            Err(AppError::NotFound("unused".to_string()))
        }
    }

    fn sink() -> Arc<dyn RunningSessionEventSink> {
        Arc::new(NullSink)
    }

    fn resume_request(session_id: &str) -> ResumeRunningSession {
        ResumeRunningSession {
            project: "proj".to_string(),
            session_id: session_id.to_string(),
            mode: RunningPermissionMode::Default,
            repository_path: Some(PathBuf::from("/repo")),
            name: None,
        }
    }

    fn resume(
        launcher: &FakeLauncher,
        ledger: &FakeLedger,
        running: &[RunningSessionByApp],
        session_id: &str,
    ) -> Result<StartedRunningSession, AppError> {
        resume_running_session(
            &FakeSource,
            launcher,
            ledger,
            running,
            &[],
            &resume_request(session_id),
            sink(),
            1000,
        )
    }

    fn start(
        launcher: &FakeLauncher,
        ledger: &FakeLedger,
        running: &[RunningSessionByApp],
    ) -> Result<StartedRunningSession, AppError> {
        resume(launcher, ledger, running, "s1")
    }

    fn create_request() -> CreateRunningSession {
        CreateRunningSession {
            repository_path: PathBuf::from("/repo"),
            mode: RunningPermissionMode::Plan,
            name: Some("調査".to_string()),
        }
    }

    /// 起動済みで、状態と PID を指定した実行中セッション(集まりの検証用)。
    fn alive(session_id: &str, pid: u32, state: ProcessState) -> RunningSessionByApp {
        let launcher = FakeLauncher::with_pid(pid);
        let mut started = resume(&launcher, &FakeLedger::none(), &[], session_id).unwrap();
        started.session.process_state = state;
        started.session
    }

    fn started_in(state: ProcessState) -> (RunningSessionByApp, Arc<FakeProcess>) {
        let launcher = FakeLauncher::new();
        let mut started = start(&launcher, &FakeLedger::none(), &[]).unwrap();
        started.session.process_state = state;
        (started.session, launcher.process)
    }

    fn request(id: &str) -> PermissionRequest {
        PermissionRequest {
            request_id: id.to_string(),
            tool_name: "Write".to_string(),
            display_name: None,
            description: None,
            tool_use_id: "toolu_1".to_string(),
            tool_input: serde_json::json!({"file_path":"a.txt","content":"hi"}),
            blocked_path: None,
            requested_at: 1,
            suggestions: Vec::new(),
        }
    }

    // ---- 起動 ----

    #[test]
    fn start_launches_the_process_with_the_resolved_cwd_and_returns_a_starting_session() {
        let launcher = FakeLauncher::new();

        let started = start(&launcher, &FakeLedger::none(), &[]).expect("should start");

        let requests = launcher.started.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0],
            StartRunningSession::Resume {
                session_id: "s1".to_string(),
                cwd: PathBuf::from("/work/proj"),
                mode: RunningPermissionMode::Default,
                repository_path: PathBuf::from("/repo"),
                name: None,
            }
        );
        assert_eq!(started.session.process_state, ProcessState::Starting);
        assert_eq!(started.session.repository_path, PathBuf::from("/repo"));
        assert_eq!(
            started.session.current_permission_mode.as_deref(),
            Some("default"),
            "起動時に選んだモードが、最初の init までの現在値"
        );
        assert_eq!(started.session.current_model, None);
        assert_eq!(started.session.base.pid, 4242);
        assert_eq!(started.session.base.session_id, "s1");
        assert_eq!(started.session.base.started_at, 1000);
        assert_eq!(started.session.base.cwd, Some(PathBuf::from("/work/proj")));
    }

    #[test]
    fn start_rejects_unsafe_ids_without_launching() {
        let launcher = FakeLauncher::new();

        let bad_session = resume(&launcher, &FakeLedger::none(), &[], "../etc/passwd");
        let bad_project = resume_running_session(
            &FakeSource,
            &launcher,
            &FakeLedger::none(),
            &[],
            &[],
            &ResumeRunningSession {
                project: "../x".to_string(),
                ..resume_request("s1")
            },
            sink(),
            1,
        );
        let bad_name = resume_running_session(
            &FakeSource,
            &launcher,
            &FakeLedger::none(),
            &[],
            &[],
            &ResumeRunningSession {
                name: Some("a\nb".to_string()),
                ..resume_request("s1")
            },
            sink(),
            1,
        );

        assert!(matches!(bad_session, Err(AppError::InvalidInput(_))));
        assert!(matches!(bad_project, Err(AppError::InvalidInput(_))));
        assert!(matches!(bad_name, Err(AppError::InvalidInput(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn several_different_conversations_can_run_at_the_same_time() {
        let first = alive("s1", 100, ProcessState::Idle);
        let launcher = FakeLauncher::with_pid(101);

        let second = resume(&launcher, &FakeLedger::none(), &[first], "s2");

        assert!(second.is_ok());
        assert_eq!(launcher.started.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_same_conversation_cannot_be_started_twice() {
        // #361 のガードは自分の PID を除外するので、自分の起動は集まりの中で見て止める。
        let existing = alive("s1", 100, ProcessState::Idle);
        let launcher = FakeLauncher::with_pid(101);

        let second = resume(&launcher, &FakeLedger::none(), &[existing], "s1");

        assert!(matches!(second, Err(AppError::SessionBusy(m)) if m.contains("100")));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn the_same_conversation_cannot_be_started_while_it_is_still_starting() {
        let launcher = FakeLauncher::new();

        let second = resume_running_session(
            &FakeSource,
            &launcher,
            &FakeLedger::none(),
            &[],
            &["s1".to_string()],
            &resume_request("s1"),
            sink(),
            1,
        );

        assert!(matches!(second, Err(AppError::SessionBusy(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn exited_sessions_are_forgotten_when_the_same_conversation_starts_or_beyond_the_kept_limit() {
        let mut exited_a = alive("s1", 100, ProcessState::Exited);
        exited_a.process_state_at = 5;
        let mut running = vec![exited_a, alive("s2", 101, ProcessState::Running)];
        // 上限を超えた古い終了済み(s2 を除く 11 個の別の会話)。
        for i in 0..=MAX_KEPT_EXITED_SESSIONS as u32 {
            let mut s = alive(&format!("old{i}"), 200 + i, ProcessState::Exited);
            s.process_state_at = 10 + i as u64;
            running.push(s);
        }

        let forgotten = exited_to_forget(&running, "s1");
        let pids: Vec<u32> = forgotten.iter().map(|r| r.pid).collect();

        // s1 の終了済み(100)は置き換わる。残りの終了済み 11 個のうち、いちばん古い 1 個(200)が
        // 上限を超えるので忘れる。実行中の s2(101)は忘れない。
        assert_eq!(pids, vec![100, 200]);
        // 起動する会話が別なら、s1 の終了済みも残る(上限内の間は)。
        let none = exited_to_forget(&running[..2], "other");
        assert!(none.is_empty());
    }

    #[test]
    fn a_conversation_can_be_started_again_after_it_exited() {
        let exited = alive("s1", 100, ProcessState::Exited);
        let launcher = FakeLauncher::with_pid(101);

        assert!(resume(&launcher, &FakeLedger::none(), &[exited], "s1").is_ok());
    }

    #[test]
    fn the_upper_limit_counts_running_and_starting_sessions_but_not_exited_ones() {
        let mut running: Vec<RunningSessionByApp> = (0..MAX_RUNNING_SESSIONS - 1)
            .map(|i| alive(&format!("s{i}"), 200 + i as u32, ProcessState::Idle))
            .collect();
        // 終了済みは数えない。
        running.push(alive("gone", 300, ProcessState::Exited));

        // 上限の1つ手前までは起動できる。
        assert!(ensure_can_start(&running, &[], "new").is_ok());
        // 起動の途中も数える。
        let over = ensure_can_start(&running, &["other".to_string()], "new");
        assert!(
            matches!(over, Err(AppError::SessionBusy(m)) if m.contains(&MAX_RUNNING_SESSIONS.to_string()))
        );

        // 上限に達したら、起動要求はプロセスを起こさず session_busy で止まる。
        running.push(alive("last", 301, ProcessState::Running));
        let launcher = FakeLauncher::with_pid(999);
        let result = resume(&launcher, &FakeLedger::none(), &running, "new");
        assert!(matches!(result, Err(AppError::SessionBusy(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn the_block_message_names_the_ledger_file_and_pid_so_the_user_can_resolve_it() {
        // issue #345 の後続: 台帳が壊れて PID が使い回されると止まり続けうるため、
        // 止めた理由に原因の台帳のパスと PID を含める(どちらの根拠でも)。
        struct FixedLedger(DetectedRunning);
        impl RunningSessionSource for FixedLedger {
            fn find_running(
                &self,
                _session_id: &str,
                _exclude_pids: &[u32],
            ) -> Result<Option<DetectedRunning>, AppError> {
                Ok(Some(self.0.clone()))
            }
        }
        for evidence in [
            crate::RunningEvidence::SessionMatched,
            crate::RunningEvidence::LedgerUnreadable,
        ] {
            let ledger = FixedLedger(DetectedRunning {
                ledger_path: PathBuf::from("/home/u/.claude/sessions/19104.json"),
                pid: 19104,
                evidence,
            });
            let launcher = FakeLauncher::new();

            let Err(AppError::SessionBusy(message)) = resume_running_session(
                &FakeSource,
                &launcher,
                &ledger,
                &[],
                &[],
                &resume_request("s1"),
                sink(),
                1,
            ) else {
                panic!("expected SessionBusy");
            };

            assert!(
                message.contains("19104.json") && message.contains("19104"),
                "{evidence:?}: {message}"
            );
            assert!(launcher.started.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn start_is_blocked_when_another_process_is_running_the_same_session() {
        let launcher = FakeLauncher::new();

        let result = start(&launcher, &FakeLedger::with_pid(9999), &[]);

        assert!(matches!(result, Err(AppError::SessionBusy(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn the_guard_excludes_the_pids_of_all_app_started_processes() {
        // #361 のガード: app が起動した子プロセスは(複数あっても全部)外部の実行中とみなさない。
        assert_eq!(own_running_pids(&[]), Vec::<u32>::new());
        let idle = alive("s1", 4242, ProcessState::Idle);
        let running = alive("s2", 4243, ProcessState::Running);
        let exited = alive("s3", 4244, ProcessState::Exited);
        let all = vec![idle, running, exited];
        assert_eq!(
            own_running_pids(&all),
            vec![4242, 4243],
            "終了済みの PID は除外しない(PID は使い回される)"
        );

        // 自分の PID の台帳だけが残っている状況では、どちらの会話でもガードを通る。
        let own = own_running_pids(&all);
        for pid in [4242, 4243] {
            assert!(FakeLedger::with_pid(pid)
                .find_running("s1", &own)
                .unwrap()
                .is_none());
        }
        // 別のプロセスの台帳は、自分の PID を除外しても実行中と判定する。
        assert!(FakeLedger::with_pid(9999)
            .find_running("s1", &own)
            .unwrap()
            .is_some());
        // 終了済みの PID(使い回されうる)は除外しないので、その台帳は実行中と判定される。
        assert!(FakeLedger::with_pid(4244)
            .find_running("s1", &own)
            .unwrap()
            .is_some());
    }

    #[test]
    fn resuming_a_second_conversation_excludes_every_own_pid_from_the_ledger_check() {
        let first = alive("s1", 100, ProcessState::Idle);
        let second = alive("s2", 101, ProcessState::Running);
        let ledger = FakeLedger::none();
        let launcher = FakeLauncher::with_pid(102);

        resume(&launcher, &ledger, &[first, second], "s3").unwrap();

        assert_eq!(*ledger.asked_excludes.lock().unwrap(), vec![vec![100, 101]]);
    }

    // ---- 新規作成 ----

    #[test]
    fn create_starts_a_new_conversation_in_the_repository_with_the_decided_id() {
        let launcher = FakeLauncher::new();

        let started = create_running_session(
            &launcher,
            &[],
            &[],
            &create_request(),
            "3a392392-0000-4000-8000-000000000001".to_string(),
            sink(),
            1000,
        )
        .expect("should start");

        assert_eq!(
            launcher.started.lock().unwrap().as_slice(),
            &[StartRunningSession::New {
                session_id: "3a392392-0000-4000-8000-000000000001".to_string(),
                cwd: PathBuf::from("/repo"),
                mode: RunningPermissionMode::Plan,
                repository_path: PathBuf::from("/repo"),
                name: Some("調査".to_string()),
            }]
        );
        let session = started.session;
        assert_eq!(
            session.base.session_id,
            "3a392392-0000-4000-8000-000000000001"
        );
        assert_eq!(session.base.cwd, Some(PathBuf::from("/repo")));
        assert_eq!(session.base.name.as_deref(), Some("調査"));
        assert_eq!(session.repository_path, PathBuf::from("/repo"));
        assert_eq!(session.process_state, ProcessState::Starting);
        assert_eq!(session.current_permission_mode.as_deref(), Some("plan"));
    }

    #[test]
    fn create_follows_the_same_start_rules_as_resume() {
        let existing = alive(
            "3a392392-0000-4000-8000-000000000001",
            100,
            ProcessState::Idle,
        );
        let launcher = FakeLauncher::with_pid(101);

        let duplicate = create_running_session(
            &launcher,
            &[existing],
            &[],
            &create_request(),
            "3a392392-0000-4000-8000-000000000001".to_string(),
            sink(),
            1,
        );
        let bad_id = create_running_session(
            &launcher,
            &[],
            &[],
            &create_request(),
            "../x".to_string(),
            sink(),
            1,
        );

        assert!(matches!(duplicate, Err(AppError::SessionBusy(_))));
        assert!(matches!(bad_id, Err(AppError::InvalidInput(_))));
        assert!(launcher.started.lock().unwrap().is_empty());
    }

    #[test]
    fn a_decided_session_id_is_a_fresh_uuid_v4_each_time() {
        let a = new_session_id();
        let b = new_session_id();

        assert_ne!(a, b);
        assert!(is_valid_session_id(&a));
        assert_eq!(uuid::Uuid::parse_str(&a).unwrap().get_version_num(), 4);
    }

    #[test]
    fn a_blank_name_means_no_name() {
        let launcher = FakeLauncher::new();
        let request = CreateRunningSession {
            name: Some("   ".to_string()),
            ..create_request()
        };

        let started = create_running_session(
            &launcher,
            &[],
            &[],
            &request,
            "s-new".to_string(),
            sink(),
            1,
        )
        .unwrap();

        assert_eq!(started.session.base.name, None);
    }

    #[test]
    fn resume_uses_the_conversation_cwd_as_the_repository_when_the_profile_has_none() {
        let launcher = FakeLauncher::new();

        let started = resume_running_session(
            &FakeSource,
            &launcher,
            &FakeLedger::none(),
            &[],
            &[],
            &ResumeRunningSession {
                repository_path: None,
                ..resume_request("s1")
            },
            sink(),
            1,
        )
        .unwrap();

        assert_eq!(started.session.repository_path, PathBuf::from("/work/proj"));
    }

    // ---- 切り替え ----

    #[test]
    fn switching_is_forwarded_to_the_process_but_does_not_change_the_current_values_yet() {
        let (session, process) = started_in(ProcessState::Idle);
        let switch = RunningSessionSwitch::Model("opus".to_string());

        begin_switch_running_session(&session, &switch).unwrap();
        write_switch(process.as_ref(), &switch).unwrap();
        write_switch(
            process.as_ref(),
            &RunningSessionSwitch::PermissionMode(RunningPermissionMode::AcceptEdits),
        )
        .unwrap();

        assert_eq!(
            process.switches.lock().unwrap().as_slice(),
            &[
                RunningSessionSwitch::Model("opus".to_string()),
                RunningSessionSwitch::PermissionMode(RunningPermissionMode::AcceptEdits)
            ]
        );
        // 反映は CLI が受け入れたとき(SwitchApplied)。要求しただけでは変えない。
        assert_eq!(session.current_model, None);
        assert_eq!(session.current_permission_mode.as_deref(), Some("default"));
    }

    #[test]
    fn switching_is_rejected_for_exited_or_starting_sessions_and_bad_model_names() {
        let (exited, _) = started_in(ProcessState::Exited);
        let (starting, _) = started_in(ProcessState::Starting);
        let (idle, _) = started_in(ProcessState::Idle);
        let ok = RunningSessionSwitch::PermissionMode(RunningPermissionMode::Plan);

        assert!(matches!(
            begin_switch_running_session(&exited, &ok),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            begin_switch_running_session(&starting, &ok),
            Err(AppError::InvalidInput(_))
        ));
        for bad in ["", "opus 4", "a\nb", "--flag;rm", &"x".repeat(101)] {
            assert!(
                matches!(
                    begin_switch_running_session(
                        &idle,
                        &RunningSessionSwitch::Model(bad.to_string())
                    ),
                    Err(AppError::InvalidInput(_))
                ),
                "{bad:?}"
            );
        }
        for good in [
            "opus",
            "claude-opus-4-7",
            "sonnet[1m]",
            "claude-haiku-4-5-20251001",
        ] {
            assert!(begin_switch_running_session(
                &idle,
                &RunningSessionSwitch::Model(good.to_string())
            )
            .is_ok());
        }
    }

    #[test]
    fn an_accepted_switch_updates_the_current_model_and_permission_mode() {
        let (mut session, _) = started_in(ProcessState::Idle);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::SwitchApplied(RunningSessionSwitch::Model("haiku".to_string())),
            5,
        );
        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::SwitchApplied(RunningSessionSwitch::PermissionMode(
                RunningPermissionMode::Auto,
            )),
            6,
        );

        assert_eq!(session.current_model.as_deref(), Some("haiku"));
        assert_eq!(session.current_permission_mode.as_deref(), Some("auto"));
        assert_eq!(session.process_state, ProcessState::Idle);
    }

    #[test]
    fn the_configuration_the_cli_reports_wins_and_missing_items_change_nothing() {
        let (mut session, _) = started_in(ProcessState::Idle);
        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::SwitchApplied(RunningSessionSwitch::Model("haiku".to_string())),
            5,
        );

        // 次のターンの system/init が、実際の(解決済みの)モデル名と権限モードを報告する。
        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Configured {
                model: Some("claude-haiku-4-5-20251001".to_string()),
                permission_mode: Some("manual".to_string()),
            },
            6,
        );
        assert_eq!(
            session.current_model.as_deref(),
            Some("claude-haiku-4-5-20251001")
        );
        assert_eq!(session.current_permission_mode.as_deref(), Some("manual"));

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Configured {
                model: None,
                permission_mode: None,
            },
            7,
        );
        assert_eq!(
            session.current_model.as_deref(),
            Some("claude-haiku-4-5-20251001")
        );
    }

    #[test]
    fn the_cli_value_maps_back_to_the_mode_including_the_renamed_default() {
        for mode in [
            RunningPermissionMode::Plan,
            RunningPermissionMode::Default,
            RunningPermissionMode::AcceptEdits,
            RunningPermissionMode::Auto,
        ] {
            assert_eq!(
                RunningPermissionMode::from_cli_value(mode.as_cli_value()),
                Some(mode)
            );
        }
        // CLI 2.1.280 は default を manual に改名した。
        assert_eq!(
            RunningPermissionMode::from_cli_value("manual"),
            Some(RunningPermissionMode::Default)
        );
        assert_eq!(
            RunningPermissionMode::from_cli_value("bypassPermissions"),
            None
        );
        assert_eq!(RunningPermissionMode::from_cli_value(""), None);
    }

    // ---- 送信 ----

    #[test]
    fn send_while_starting_is_rejected_until_the_process_reports_it_started() {
        let (mut session, process) = started_in(ProcessState::Starting);

        let early = send_to_running_session(&mut session, process.as_ref(), "x", &[], 5);

        assert!(matches!(early, Err(AppError::InvalidInput(_))));
        assert!(process.sent.lock().unwrap().is_empty());
        assert_eq!(session.process_state, ProcessState::Starting);

        apply_running_session_event(&mut session, &RunningSessionEvent::Initialized, 6);
        assert!(send_to_running_session(&mut session, process.as_ref(), "x", &[], 7).is_ok());
    }

    #[test]
    fn send_writes_to_the_process_and_moves_idle_to_running() {
        let (mut session, process) = started_in(ProcessState::Idle);

        send_to_running_session(&mut session, process.as_ref(), "こんにちは", &[], 2000)
            .expect("should send");

        assert_eq!(
            process.sent.lock().unwrap().as_slice(),
            &[("こんにちは".to_string(), 0)]
        );
        assert_eq!(session.process_state, ProcessState::Running);
        assert_eq!(session.process_state_at, 2000);
    }

    #[test]
    fn send_while_running_is_allowed_and_keeps_running() {
        let (mut session, process) = started_in(ProcessState::Running);

        send_to_running_session(&mut session, process.as_ref(), "続き", &[], 2000)
            .expect("should send");

        assert_eq!(session.process_state, ProcessState::Running);
        assert_eq!(process.sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn send_rejects_blank_text_invalid_images_and_an_exited_session_without_writing() {
        let (mut session, process) = started_in(ProcessState::Idle);
        assert!(matches!(
            send_to_running_session(&mut session, process.as_ref(), "  ", &[], 1),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            send_to_running_session(
                &mut session,
                process.as_ref(),
                "x",
                &["not-base64!!".to_string()],
                1
            ),
            Err(AppError::InvalidInput(_))
        ));
        let (mut exited, process2) = started_in(ProcessState::Exited);
        assert!(matches!(
            send_to_running_session(&mut exited, process2.as_ref(), "x", &[], 1),
            Err(AppError::InvalidInput(_))
        ));
        assert!(process.sent.lock().unwrap().is_empty());
        assert!(process2.sent.lock().unwrap().is_empty());
        assert_eq!(session.process_state, ProcessState::Idle);
    }

    #[test]
    fn a_failed_write_stops_the_process_so_the_state_does_not_stay_running() {
        let launcher = FakeLauncher::new();
        let mut started = start(&launcher, &FakeLedger::none(), &[]).unwrap();
        started.session.process_state = ProcessState::Idle;
        let process = FakeProcess {
            fail_send: true,
            ..FakeProcess::default()
        };

        let result = send_to_running_session(&mut started.session, &process, "x", &[], 5);

        assert!(matches!(result, Err(AppError::Io(_))));
        // 状態は書き込みの前に動かしてある。壊れた標準入力のプロセスは止め、
        // 出来事(Exited)が状態を終わりにする。
        assert_eq!(*process.stopped.lock().unwrap(), 1);
    }

    #[test]
    fn the_state_moves_before_the_write_so_a_fast_reply_cannot_be_lost() {
        // 書き込みの前に MessageSent を反映しておけば、CLI が即座に返した TurnFinished が
        // その後で待機に戻せる(逆順だと実行中のまま固まる)。
        let (mut session, _) = started_in(ProcessState::Idle);

        let images = begin_send_to_running_session(&mut session, "x", &[], 5).unwrap();
        assert!(images.is_empty());
        assert_eq!(session.process_state, ProcessState::Running);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: false }),
            6,
        );
        assert_eq!(session.process_state, ProcessState::Idle);
    }

    #[test]
    fn begin_respond_settles_first_and_returns_the_response_to_write() {
        let (mut session, _) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);

        let response = begin_respond_permission(
            &mut session,
            "r1",
            PermissionDecision::Deny { message: None },
            20,
        )
        .unwrap();

        assert_eq!(response.request_id, "r1");
        assert_eq!(session.process_state, ProcessState::Running);
        assert!(session.permission_requests.is_empty());
        // 二重応答はできない(先に外してあるので、同時に2回押されても2回書かない)。
        assert!(matches!(
            begin_respond_permission(
                &mut session,
                "r1",
                PermissionDecision::Deny { message: None },
                21
            ),
            Err(AppError::NotFound(_))
        ));
    }

    // ---- 権限の応答 ----

    #[test]
    fn respond_allow_returns_the_requested_input_and_settles_the_request() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);
        assert_eq!(session.process_state, ProcessState::AwaitingPermission);

        respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Allow {
                updated_input: None,
                updated_permissions: None,
            },
            20,
        )
        .expect("should respond");

        let responses = process.responses.lock().unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(
            responses[0].behavior,
            PermissionBehavior::Allow {
                updated_input: serde_json::json!({"file_path":"a.txt","content":"hi"}),
                updated_permissions: None
            }
        );
        assert_eq!(session.process_state, ProcessState::Running);
        assert!(session.permission_requests.is_empty());
    }

    #[test]
    fn respond_deny_uses_the_message_or_a_default() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);
        session.receive_permission_request(request("r2"), 11);

        respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Deny {
                message: Some("だめ".to_string()),
            },
            20,
        )
        .unwrap();
        respond_permission(
            &mut session,
            process.as_ref(),
            "r2",
            PermissionDecision::Deny { message: None },
            21,
        )
        .unwrap();

        let responses = process.responses.lock().unwrap();
        assert_eq!(
            responses[0].behavior,
            PermissionBehavior::Deny {
                message: "だめ".to_string()
            }
        );
        assert_eq!(
            responses[1].behavior,
            PermissionBehavior::Deny {
                message: DEFAULT_DENY_MESSAGE.to_string()
            }
        );
    }

    #[test]
    fn respond_to_an_unknown_or_already_answered_request_is_an_error_and_writes_nothing() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);
        respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Deny { message: None },
            20,
        )
        .unwrap();

        let again = respond_permission(
            &mut session,
            process.as_ref(),
            "r1",
            PermissionDecision::Deny { message: None },
            21,
        );

        assert!(matches!(again, Err(AppError::NotFound(_))));
        assert_eq!(process.responses.lock().unwrap().len(), 1);
    }

    // ---- 中断・停止 ----

    #[test]
    fn interrupt_is_forwarded_and_does_not_move_the_state() {
        let (session, process) = started_in(ProcessState::AwaitingPermission);

        interrupt_running_session(&session, process.as_ref()).unwrap();

        assert_eq!(*process.interrupts.lock().unwrap(), 1);
        assert_eq!(session.process_state, ProcessState::AwaitingPermission);
    }

    #[test]
    fn interrupt_of_an_exited_session_is_an_error() {
        let (session, process) = started_in(ProcessState::Exited);

        assert!(matches!(
            interrupt_running_session(&session, process.as_ref()),
            Err(AppError::InvalidInput(_))
        ));
        assert_eq!(*process.interrupts.lock().unwrap(), 0);
    }

    #[test]
    fn stop_stops_the_process_and_marks_the_session_exited() {
        let (mut session, process) = started_in(ProcessState::Running);
        session.receive_permission_request(request("r1"), 10);

        stop_running_session(&mut session, process.as_ref(), 30);

        assert_eq!(*process.stopped.lock().unwrap(), 1);
        assert_eq!(session.process_state, ProcessState::Exited);
        assert!(session.permission_requests.is_empty());
    }

    // ---- 出来事の反映 ----

    #[test]
    fn events_drive_the_state_machine() {
        let (mut session, _) = started_in(ProcessState::Starting);

        apply_running_session_event(&mut session, &RunningSessionEvent::Initialized, 1);
        assert_eq!(session.process_state, ProcessState::Idle);

        session.apply(ProcessTrigger::MessageSent, 2);
        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TextDelta {
                text: "a".to_string(),
            }),
            3,
        );
        assert_eq!(
            session.process_state,
            ProcessState::Running,
            "途中経過は状態を動かさない"
        );

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::PermissionRequested(request("r1")),
            4,
        );
        assert_eq!(session.process_state, ProcessState::AwaitingPermission);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::PermissionCancelled {
                request_id: "r1".to_string(),
            },
            5,
        );
        assert_eq!(session.process_state, ProcessState::Running);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: true }),
            6,
        );
        assert_eq!(session.process_state, ProcessState::Idle);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Exited {
                exit_code: Some(0),
                stderr_tail: String::new(),
            },
            7,
        );
        assert_eq!(session.process_state, ProcessState::Exited);
        assert_eq!(session.process_state_at, 7);
    }

    #[test]
    fn a_failed_turn_also_returns_to_idle() {
        let (mut session, _) = started_in(ProcessState::Running);

        apply_running_session_event(
            &mut session,
            &RunningSessionEvent::Progress(ProgressEvent::TurnFinished { succeeded: false }),
            9,
        );

        assert_eq!(session.process_state, ProcessState::Idle);
    }

    #[test]
    fn the_mode_is_passed_to_the_cli_as_is() {
        assert_eq!(RunningPermissionMode::Plan.as_cli_value(), "plan");
        assert_eq!(RunningPermissionMode::Default.as_cli_value(), "default");
        assert_eq!(
            RunningPermissionMode::AcceptEdits.as_cli_value(),
            "acceptEdits"
        );
        assert_eq!(RunningPermissionMode::Auto.as_cli_value(), "auto");
        assert_eq!(
            RunningPermissionMode::default(),
            RunningPermissionMode::Default
        );
    }
}
