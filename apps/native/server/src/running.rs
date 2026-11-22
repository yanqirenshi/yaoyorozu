//! サーバが起動したまま持つ claude CLI(実行中セッション)の中身。写し元は
//! `tauri/src/running_session.rs` の、command 以外の部分(イベントループ・利用状況の定期取得・起動・
//! 自動再開・終了時の停止)。command(`/rpc`)の受け口は `rpc/running.rs`。
//!
//! Tauri 版との違い:
//! - 画面への配送は Channel ではなく、**同じ `/events` の SSE**(`progress.rs`)。購読は「接続の ID と
//!   購読の ID」だけを持ち、配る側は状態のロックの外で、待たない送信をする。
//! - イベント(`emit`)は `EventBus`(SSE)へ。
//! - 控え・アーカイブ・台帳の保存は、データフォルダの JSON を `write_atomic` で書き、**保存のレーン**を通す。
//! - claude の起動は、環境変数で偽物(`fake_claude.cjs`)へ差し替えられる(確認用。README 参照)。

use crate::dto::{
    AddressedProgressDto, AppWarningEventDto, ClaudeUsageSnapshotDto,
    RunningSessionChangedEventDto, RunningSessionDto, StartRunningSessionDto, WorktreeSpecDto,
};
use crate::progress::{Connections, Delivery, ProgressMessage};
use crate::state::{resolve_effective_projects_dir, RunningSessionSlot, ServerState};
use crate::AppContext;
use app::{
    AddressedRunningSessionEvent, AppError, RunningSessionEvent, RunningSessionEventSink,
    RunningSessionRef, SessionSource,
};
use domain::{GitLedger, ProcessState, RunningSessionByApp, Settings};
use infra::{
    ClaudeCliProcessLauncher, FileArchivedSessionsStore, FileGitLedgerStore,
    FileRestorableRunningSessionsStore, FileRunningSessionSource, FileSystemRepository,
    SystemGitStateSource,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

/// 実行中セッションの状態が変わった・権限の問い合わせが届いた/決着したことの通知。
pub const RUNNING_SESSION_CHANGED_EVENT: &str = "running-session:changed";
/// 画面に出す軽い警告。
pub const APP_WARNING_EVENT: &str = "app:warning";
/// Claude.ai の利用状況が更新されたことの通知。
pub const CLAUDE_USAGE_CHANGED_EVENT: &str = "claude-usage:updated";
/// 途中経過(SSE の接続ごと。購読の ID つき)。
pub const RUNNING_SESSION_PROGRESS_EVENT: &str = "running-session:progress";

/// 利用状況の定期取得の間隔(5 分おき)。
const USAGE_POLL_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// 終了時に、claude を穏やかに止めるのを待つ上限。コンソールを閉じる・ログオフ・シャットダウンの合図から
/// OS が打ち切るまで約 5 秒しかない。間に合わなかった分はジョブオブジェクトが止める。
pub const STOP_ALL_BUDGET: Duration = Duration::from_secs(4);

/// 偽の claude に差し替える環境変数(値は `fake_claude.cjs` のパス。確認用)。
pub const FAKE_CLAUDE_ENV_VAR: &str = "YAOYOROZU_SERVER_FAKE_CLAUDE";

/// 実行中セッションまわりの、サーバ全体で共有するもの。
#[derive(Clone, Default)]
pub struct RunningServices {
    /// SSE の接続の表。
    pub connections: Connections,
    /// `running-sessions.json`・`archived-sessions.json`・`git-ledger.json` の保存のレーン
    /// (ロックの順は「レーン → 状態」の一方向)。
    pub store_lane: Arc<tokio::sync::Mutex<()>>,
    /// claude の起動の差し替え(確認用)。`None` は本物。
    pub claude_override: Option<ClaudeOverride>,
}

/// 起動するコマンドの差し替え(`node <fake_claude.cjs>` など)。
#[derive(Clone, Debug)]
pub struct ClaudeOverride {
    pub program: String,
    pub leading_args: Vec<String>,
}

impl ClaudeOverride {
    /// 環境変数 [`FAKE_CLAUDE_ENV_VAR`] から作る。空・未設定なら `None`。
    pub fn from_env_value(value: Option<&str>) -> Option<Self> {
        let path = value.map(str::trim).filter(|v| !v.is_empty())?;
        Some(Self {
            program: "node".to_string(),
            leading_args: vec![path.to_string()],
        })
    }
}

impl RunningServices {
    pub fn launcher(&self) -> ClaudeCliProcessLauncher {
        match &self.claude_override {
            Some(o) => {
                let args: Vec<&str> = o.leading_args.iter().map(String::as_str).collect();
                ClaudeCliProcessLauncher::with_command(&o.program, &args)
            }
            None => ClaudeCliProcessLauncher::new(),
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn background_failed() -> AppError {
    AppError::Io("バックグラウンド処理に失敗しました".to_string())
}

/// 読み取りスレッドから、順序を保ったまま処理タスクへ出来事を渡す受け口。
struct ChannelSink(mpsc::UnboundedSender<RunningSessionEvent>);

impl RunningSessionEventSink for ChannelSink {
    fn emit(&self, event: RunningSessionEvent) {
        // 受け側(処理タスク)が終わっていれば捨てる。
        let _ = self.0.send(event);
    }
}

pub fn find_slot<'a>(
    state: &'a ServerState,
    target: &RunningSessionRef,
) -> Option<&'a RunningSessionSlot> {
    state
        .running_sessions
        .iter()
        .find(|slot| target.matches(&slot.session))
}

pub fn find_slot_mut<'a>(
    state: &'a mut ServerState,
    target: &RunningSessionRef,
) -> Option<&'a mut RunningSessionSlot> {
    state
        .running_sessions
        .iter_mut()
        .find(|slot| target.matches(&slot.session))
}

pub fn changed_event(
    session: &RunningSessionByApp,
    exit_code: Option<i32>,
) -> RunningSessionChangedEventDto {
    RunningSessionChangedEventDto {
        target: RunningSessionRef::of(session).into(),
        session_id: session.base.session_id.clone(),
        process_state: session.process_state.into(),
        pending_permission_count: session.permission_requests.len(),
        exit_code,
    }
}

/// 状態の変化を見るための要約(状態・答え待ちの数・現在のモデルと権限モード)。
fn watched(session: &RunningSessionByApp) -> (ProcessState, usize, Option<String>, Option<String>) {
    (
        session.process_state,
        session.permission_requests.len(),
        session.current_model.clone(),
        session.current_permission_mode.clone(),
    )
}

// ---------------------------------------------------------------------------
// 保存(データフォルダの JSON。`write_atomic` + 保存のレーン)
// ---------------------------------------------------------------------------

/// 控え(前回動かしていた実行中セッション)の読み書き。失敗しても起動・停止は続ける(ログだけ)。
pub async fn with_restorable_store<F>(ctx: &AppContext, what: &'static str, change: F)
where
    F: FnOnce(&FileRestorableRunningSessionsStore) -> Result<(), AppError> + Send + 'static,
{
    let path = ctx.data_dir.join("running-sessions.json");
    let _lane = ctx.running.store_lane.lock().await;
    let watch = crate::corruption::Watch::start(&ctx.data_dir, "running-sessions.json");
    let data_dir = ctx.data_dir.as_ref().clone();
    let result = tokio::task::spawn_blocking(move || {
        // 読む前に、大文字を含む会話 ID を小文字にそろえる(同じ会話の行は 1 行にまとめる)。
        crate::session_ids::normalize_stores(&data_dir);
        change(&FileRestorableRunningSessionsStore::new(path))
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()));
    watch.report(ctx).await;
    if let Err(e) = result {
        eprintln!("{what}に失敗しました: {e}");
    }
}

/// アーカイブの印の読み書き。失敗は呼び出し側へ返す(利用者の操作で直接呼ばれるものが使う)。
pub async fn try_with_archived_store<F, T>(ctx: &AppContext, change: F) -> Result<T, AppError>
where
    F: FnOnce(&FileArchivedSessionsStore) -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    let path = ctx.data_dir.join("archived-sessions.json");
    let _lane = ctx.running.store_lane.lock().await;
    let watch = crate::corruption::Watch::start(&ctx.data_dir, "archived-sessions.json");
    let data_dir = ctx.data_dir.as_ref().clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::session_ids::normalize_stores(&data_dir);
        change(&FileArchivedSessionsStore::new(path))
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()));
    watch.report(ctx).await;
    result
}

/// 起動・再開の「ついで」の処理用(失敗はログだけ)。
async fn with_archived_store<F>(ctx: &AppContext, what: &'static str, change: F)
where
    F: FnOnce(&FileArchivedSessionsStore) -> Result<(), AppError> + Send + 'static,
{
    if let Err(e) = try_with_archived_store(ctx, change).await {
        eprintln!("{what}に失敗しました: {e}");
    }
}

// ---------------------------------------------------------------------------
// 警告(画面へ。控えにも積んで、取りこぼしても `list_pending_warnings` で取れるようにする)
// ---------------------------------------------------------------------------

/// 画面に警告を出す。パスはサーバの構成なので、画面へ出す文面からは取り除く(ログには全文)。
pub async fn warn(ctx: &AppContext, message: String) {
    eprintln!("{message}");
    let message = crate::redact::redact_paths(&message);
    let id = ctx
        .state
        .lock()
        .await
        .push_warning(APP_WARNING_EVENT, message.clone());
    ctx.events.emit(
        APP_WARNING_EVENT,
        &AppWarningEventDto {
            message,
            id: Some(id),
        },
    );
}

// ---------------------------------------------------------------------------
// 利用状況の定期取得
// ---------------------------------------------------------------------------

/// 利用状況を聞く相手(動いているもののうち、一覧の先頭。値はアカウント単位なので 1 つで足りる)。
fn pick_usage_source(
    running_sessions: &[RunningSessionSlot],
) -> Option<Arc<dyn app::RunningProcess>> {
    running_sessions
        .iter()
        .find(|slot| slot.session.process_state != ProcessState::Exited)
        .map(|slot| slot.process.clone())
}

/// 利用状況を取得し続ける。**最初の 1 回は待たずに取得し、以後は 5 分おき**。動いている実行中セッションが
/// 1 つも無くなったら `usage_polling_active` を偽に戻し、このループ自身も終える。
pub fn spawn_usage_polling(ctx: AppContext) {
    tokio::spawn(async move {
        let mut shutdown = ctx.shutdown.clone();
        loop {
            let process = {
                let mut guard = ctx.state.lock().await;
                let process = pick_usage_source(&guard.running_sessions);
                if process.is_none() {
                    guard.usage_polling_active = false;
                }
                process
            };
            let Some(process) = process else {
                break;
            };
            let result = tokio::task::spawn_blocking(move || process.get_usage())
                .await
                .unwrap_or_else(|_| Err(background_failed()));
            if let Err(e) = result {
                eprintln!("利用状況の取得に失敗しました: {e}");
            }
            tokio::select! {
                _ = tokio::time::sleep(USAGE_POLL_INTERVAL) => {}
                _ = shutdown.wait_for(|v| *v) => break,
            }
        }
    });
}

// ---------------------------------------------------------------------------
// イベントループ(起動した子プロセス 1 つの出来事を、順に処理する)
// ---------------------------------------------------------------------------

/// 途中経過 1 件を、購読している接続へ配る(状態のロックの外。待たない)。送れなかった接続の購読は外す。
pub async fn deliver_progress(
    ctx: &AppContext,
    subscribers: &[crate::state::Subscription],
    dto: &AddressedProgressDto,
    seq: u64,
) {
    if subscribers.is_empty() {
        return;
    }
    let Ok(progress) = serde_json::to_value(dto) else {
        return;
    };
    let mut dropped: Vec<String> = Vec::new();
    for sub in subscribers {
        let json =
            serde_json::json!({ "subscription_id": sub.id, "seq": seq, "progress": progress })
                .to_string();
        let delivery = ctx.running.connections.deliver(
            &sub.conn_id,
            ProgressMessage {
                subscription_id: sub.id,
                progress_json: json,
            },
        );
        if delivery == Delivery::Dropped && !dropped.contains(&sub.conn_id) {
            dropped.push(sub.conn_id.clone());
        }
    }
    if !dropped.is_empty() {
        ctx.state
            .lock()
            .await
            .drop_connection_subscriptions(&dropped);
    }
}

fn spawn_event_loop(
    ctx: AppContext,
    target: RunningSessionRef,
    // 控えの更新に使う会話の ID。宛先(PID の組)からは引けないため別に渡す。
    session_id: String,
    mut rx: mpsc::UnboundedReceiver<RunningSessionEvent>,
) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let addressed = AddressedRunningSessionEvent {
                target: target.clone(),
                event,
            };
            let exit_code = match &addressed.event {
                RunningSessionEvent::Exited { exit_code, .. } => *exit_code,
                _ => None,
            };

            let (
                notify,
                subscribers,
                progress_seq,
                exited_abnormally,
                usage_payload,
                turn_finished_process,
            ) = {
                let mut guard = ctx.state.lock().await;
                // アカウント単位の値なので、この会話(`slot`)ではなく状態へ直接反映する。
                let usage_payload =
                    if let RunningSessionEvent::UsageUpdated(usage) = &addressed.event {
                        guard.claude_usage = app::ClaudeUsageSnapshot {
                            usage: Some(usage.clone()),
                            fetched_at_ms: Some(now_ms()),
                        };
                        Some(ClaudeUsageSnapshotDto::from(guard.claude_usage.clone()))
                    } else {
                        None
                    };
                let (notify, subscribers, progress_seq, exited_abnormally, turn_finished_process) =
                    match find_slot_mut(&mut guard, &target) {
                        Some(slot) => {
                            let before = watched(&slot.session);
                            let display_name = slot
                                .session
                                .base
                                .name
                                .clone()
                                .unwrap_or_else(|| slot.session.base.session_id.clone());
                            app::apply_running_session_event(
                                &mut slot.session,
                                &addressed.event,
                                now_ms(),
                            );
                            let models_listed = match &addressed.event {
                                RunningSessionEvent::ModelsListed(models) => {
                                    slot.available_models = models.clone();
                                    true
                                }
                                _ => false,
                            };
                            let changed = before != watched(&slot.session)
                                || exit_code.is_some()
                                || models_listed;
                            // 途中経過には、このセッションの連番を付ける(購読者がいなくても進める。取り直しの「ここまで」)。
                            let subscribers = if addressed.as_progress().is_some() {
                                slot.progress_seq += 1;
                                slot.subscribers.clone()
                            } else {
                                Vec::new()
                            };
                            let progress_seq = slot.progress_seq;
                            if matches!(addressed.event, RunningSessionEvent::Exited { .. }) {
                                slot.subscribers.clear();
                            }
                            let exited_abnormally = match &addressed.event {
                                RunningSessionEvent::Exited { stderr_tail, .. }
                                    if !stderr_tail.is_empty() =>
                                {
                                    Some((display_name, stderr_tail.clone()))
                                }
                                _ => None,
                            };
                            // ターンが終わったら、使った直後に数字が動くよう利用状況を取り直す。
                            let turn_finished_process = matches!(
                                addressed.event,
                                RunningSessionEvent::Progress(
                                    domain::ProgressEvent::TurnFinished { .. }
                                )
                            )
                            .then(|| slot.process.clone());
                            (
                                changed.then(|| changed_event(&slot.session, exit_code)),
                                subscribers,
                                progress_seq,
                                exited_abnormally,
                                turn_finished_process,
                            )
                        }
                        None => (None, Vec::new(), 0, None, None),
                    };
                (
                    notify,
                    subscribers,
                    progress_seq,
                    exited_abnormally,
                    usage_payload,
                    turn_finished_process,
                )
            };
            if let Some(payload) = usage_payload {
                ctx.events.emit(CLAUDE_USAGE_CHANGED_EVENT, &payload);
            }
            if let Some(process) = turn_finished_process {
                tokio::task::spawn_blocking(move || {
                    if let Err(e) = process.get_usage() {
                        eprintln!("ターン終了時の利用状況の取得に失敗しました: {e}");
                    }
                });
            }
            if let Some((name, stderr_tail)) = exited_abnormally {
                // 起動直後の終了など、CLI 自身が理由を残して終わったときは画面にも出す。
                warn(&ctx, format!("「{name}」が終了しました: {stderr_tail}")).await;
            }

            // 途中経過を、購読中の接続へ流す(ロックの外・待たない)。
            if let Some(progress) = addressed.as_progress() {
                let dto = AddressedProgressDto::from(progress);
                deliver_progress(&ctx, &subscribers, &dto, progress_seq).await;
            }
            if let Some(payload) = notify {
                ctx.events.emit(RUNNING_SESSION_CHANGED_EVENT, &payload);
            }
            // 切り替えが CLI に受け入れられたら、控えも現在の値にしておく。
            if let RunningSessionEvent::SwitchApplied(switch) = &addressed.event {
                let switch = switch.clone();
                let session_id = session_id.clone();
                with_restorable_store(
                    &ctx,
                    "実行中セッションの控えの更新",
                    move |store| app::remember_running_session_switch(store, &session_id, &switch),
                )
                .await;
            }
            if matches!(addressed.event, RunningSessionEvent::Exited { .. }) {
                break;
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Git 台帳(最小。worktree の ID と実体の対応に使う。表示・操作は段階 4)
// ---------------------------------------------------------------------------

/// 登録済みプロファイルから Git の状態を観測して台帳と突き合わせる(保存はしない)。
fn reconcile_ledger(settings: &Settings, previous: &GitLedger) -> GitLedger {
    let repository_paths: Vec<PathBuf> = domain::repositories_from_profiles(&settings.profiles)
        .into_iter()
        .map(|r| r.repository_path)
        .collect();
    let result = app::reconcile_git_ledger(
        &SystemGitStateSource::new(),
        previous,
        &repository_paths,
        now_ms(),
        app::new_session_id,
    );
    for failed in &result.failed_repository_paths {
        eprintln!(
            "Git 状態の観測に失敗したため、{} の台帳は変更しませんでした",
            failed.display()
        );
    }
    result.ledger
}

/// 台帳を、登録済みプロファイルの Git の状態に合わせて更新して保存する。
pub async fn reload_git_ledger(ctx: &AppContext) -> Result<(), AppError> {
    let (settings, previous, path) = {
        let guard = ctx.state.lock().await;
        (
            guard.settings.clone(),
            guard.git_ledger.clone(),
            guard.git_ledger_path.clone(),
        )
    };
    let new_ledger = tokio::task::spawn_blocking(move || reconcile_ledger(&settings, &previous))
        .await
        .map_err(|_| background_failed())?;
    {
        let _lane = ctx.running.store_lane.lock().await;
        let to_save = new_ledger.clone();
        let saved = tokio::task::spawn_blocking(move || {
            app::save_git_ledger(&FileGitLedgerStore::new(path), &to_save)
        })
        .await
        .unwrap_or_else(|_| Err(background_failed()));
        if let Err(e) = saved {
            eprintln!("Git 台帳の保存に失敗しました: {e}");
        }
    }
    ctx.state.lock().await.git_ledger = new_ledger;
    Ok(())
}

/// 起動する worktree を用意する(必要なら作り、起動前に最新化する)。用意できたら、新しい worktree を
/// 台帳へ反映してから、その `worktree_id` を引く。`spec` が `None` なら何もしない。
async fn prepare_start_worktree(
    ctx: &AppContext,
    repository: Option<&std::path::Path>,
    spec: Option<app::WorktreeSpec>,
    sync: bool,
) -> Result<(Option<app::ResolvedWorktree>, app::WorktreeIndex), AppError> {
    let Some(repository) = repository else {
        return match spec {
            Some(_) => Err(AppError::InvalidInput(
                "プロファイルにリポジトリが設定されていません".to_string(),
            )),
            None => Ok((None, app::WorktreeIndex::default())),
        };
    };
    let ledger = ctx.state.lock().await.git_ledger.clone();
    let index = app::WorktreeIndex::from_ledger(&ledger, repository);
    let Some(spec) = spec else {
        return Ok((None, index));
    };

    let repo = repository.to_path_buf();
    let index_for_task = index.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        app::prepare_worktree(
            &infra::SystemGitWorktreeManager::new(),
            &repo,
            &spec,
            &index_for_task,
            sync,
        )
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()))?;

    // 新しく作った(または台帳が知らない)worktree は、台帳へ反映して ID を得る。
    let index = if prepared.is_main || index.knows(&prepared.path) {
        index
    } else {
        reload_git_ledger(ctx).await?;
        let ledger = ctx.state.lock().await.git_ledger.clone();
        app::WorktreeIndex::from_ledger(&ledger, repository)
    };
    let worktree_id = index.id_of(&prepared.path);
    Ok((
        Some(app::ResolvedWorktree {
            path: prepared.path,
            worktree_id,
        }),
        index,
    ))
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

/// 会話 ID の正規の形(小文字)。比べる・控えに書く・claude へ渡すときは、すべてこの値を使う。
fn canonical_session_id(session_id: &str) -> String {
    crate::session_ids::canonical(session_id)
}

/// 再開する会話の作業フォルダ(cwd)が、リポジトリの外のときの文面(フルパスは入れない)。
const RESUME_OUTSIDE_MESSAGE: &str =
    "再開する会話の作業フォルダが、このプロファイルのリポジトリ(またはその worktree)の中にありません";

/// 再開する会話の作業フォルダが、プロファイルのリポジトリか、台帳にあるその worktree の中にあることを確かめる。
/// 外なら `cwd_missing`(422)。台帳に無い worktree かもしれないので、外と判断する前に台帳を 1 回だけ取り直す。
/// 戻り値は、確かめた**実体のパス**(起動の作業フォルダに、これをそのまま使う。確かめたあとに会話ファイルを
/// 読み直さない)。
async fn ensure_resume_target_in_project(
    ctx: &AppContext,
    projects_root: &Path,
    project: &str,
    session_id: &str,
    repository: Option<&Path>,
) -> Result<PathBuf, AppError> {
    let Some(repository) = repository else {
        return Err(AppError::InvalidInput(
            "プロファイルにリポジトリが設定されていません".to_string(),
        ));
    };
    match resume_target_check_once(ctx, projects_root, project, session_id, repository).await {
        Err(AppError::CwdMissing(m)) if m == RESUME_OUTSIDE_MESSAGE => {
            if reload_git_ledger(ctx).await.is_err() {
                return Err(AppError::CwdMissing(m));
            }
            resume_target_check_once(ctx, projects_root, project, session_id, repository).await
        }
        other => other,
    }
}

async fn resume_target_check_once(
    ctx: &AppContext,
    projects_root: &Path,
    project: &str,
    session_id: &str,
    repository: &Path,
) -> Result<PathBuf, AppError> {
    let ledger = ctx.state.lock().await.git_ledger.clone();
    let index = app::WorktreeIndex::from_ledger(&ledger, repository);
    let (root, project, session_id, repository) = (
        projects_root.to_path_buf(),
        project.to_string(),
        session_id.to_string(),
        repository.to_path_buf(),
    );
    tokio::task::spawn_blocking(move || {
        resume_target_check(&root, &project, &session_id, &repository, &index)
    })
    .await
    .unwrap_or_else(|_| Err(background_failed()))
}

/// 会話ファイルに記録された cwd を、パスの検査(UNC・デバイスの形・ネットワークのドライブを断る)に通し、
/// 実体のパスへ解決したうえで、リポジトリか台帳の worktree の中にあるかを見る(リンクで外へ出るものは外)。
fn resume_target_check(
    projects_root: &Path,
    project: &str,
    session_id: &str,
    repository: &Path,
    index: &app::WorktreeIndex,
) -> Result<PathBuf, AppError> {
    if !domain::is_valid_project_dir_name(project) {
        return Err(AppError::InvalidInput(
            "不正なプロジェクト名です".to_string(),
        ));
    }
    if !domain::is_valid_session_id(session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()));
    }
    let outside = || AppError::CwdMissing(RESUME_OUTSIDE_MESSAGE.to_string());
    let cwd =
        FileSystemRepository::new(projects_root.to_path_buf()).session_cwd(project, session_id)?;
    let cwd = crate::folders::guard_folder_path(&cwd.to_string_lossy()).map_err(|_| outside())?;
    let real = std::fs::canonicalize(&cwd).map_err(|_| {
        AppError::CwdMissing("再開する会話の作業フォルダが見つかりません".to_string())
    })?;
    let inside = std::iter::once(repository)
        .chain(index.worktree_folders())
        .filter_map(|folder| std::fs::canonicalize(folder).ok())
        .any(|folder| real.starts_with(&folder));
    if inside {
        // `\\?\` 付きの実体のパスは、claude の作業フォルダにそのまま渡せる形(`C:\…`)へ戻す。
        let text = real.to_string_lossy().to_string();
        Ok(PathBuf::from(
            text.strip_prefix(r"\\?\").unwrap_or(&text).to_string(),
        ))
    } else {
        Err(outside())
    }
}

/// 実行中セッションを起動する。`Resume` は既存の会話を `--resume` で、`New` は新しい会話を
/// `--session-id`(サーバが決めた UUID v4)で開く。同じ会話の二重起動(同時の再開を含む)と上限は
/// `session_busy`。起動先(リポジトリ・worktree)は、登録済みのプロファイルのリポジトリと、実際の
/// `git worktree list` から引けるものだけ(クライアントのパスは受け取らない)。
pub async fn start_running_session(
    ctx: &AppContext,
    profile_id: Option<String>,
    request: StartRunningSessionDto,
) -> Result<RunningSessionDto, AppError> {
    // 会話 ID は、ここ 1 か所で小文字にそろえる(二重起動の判断・控え・claude へ渡す値が、すべて同じ値になる)。
    let mut request = request;
    if let StartRunningSessionDto::Resume { session_id, .. } = &mut request {
        *session_id = canonical_session_id(session_id);
    }
    let session_id = match &request {
        StartRunningSessionDto::Resume { session_id, .. } => session_id.clone(),
        StartRunningSessionDto::New { .. } => app::new_session_id(),
    };

    // 起動してよいかを見て、起動の最中の印を付ける(同じ状態のロックの中で判断と印づけをするので、
    // 同時に来た同じ会話の起動のうち、通るのは 1 本だけ)。
    let (settings, running, starting) = {
        let mut guard = ctx.state.lock().await;
        let running: Vec<RunningSessionByApp> = guard
            .running_sessions
            .iter()
            .map(|slot| slot.session.clone())
            .collect();
        let starting = guard.starting_session_ids.clone();
        app::ensure_can_start(&running, &starting, &session_id)?;
        guard.starting_session_ids.push(session_id.clone());
        (guard.settings.clone(), running, starting)
    };
    // 起動の最中の印を外す(成功・失敗のどちらでも)。
    let release = |guard: &mut ServerState| {
        guard.starting_session_ids.retain(|id| id != &session_id);
    };

    type PreparedStart = (Option<PathBuf>, PathBuf, String);
    let prepared = (|| -> Result<PreparedStart, AppError> {
        let profile = app::resolve_profile(&settings, profile_id.as_deref())?;
        let resolved_profile_id = profile.id.clone();
        let repository = match &request {
            StartRunningSessionDto::Resume { .. } => profile.repository_path.clone(),
            StartRunningSessionDto::New { .. } => Some(app::resolve_repository_dir(
                &settings,
                profile_id.as_deref(),
            )?),
        };
        Ok((
            repository,
            resolve_effective_projects_dir(&settings)?,
            resolved_profile_id,
        ))
    })();
    let (repository, root, resolved_profile_id) = match prepared {
        Ok(prepared) => prepared,
        Err(e) => {
            release(&mut *ctx.state.lock().await);
            return Err(e);
        }
    };

    // 再開する会話は、このプロファイルのリポジトリ(と、台帳のその worktree)のものだけ(worktree を作る前に確かめる)。
    let mut verified_cwd: Option<PathBuf> = None;
    if let StartRunningSessionDto::Resume {
        project,
        session_id,
        ..
    } = &request
    {
        match ensure_resume_target_in_project(
            ctx,
            &root,
            project,
            session_id,
            repository.as_deref(),
        )
        .await
        {
            Ok(real) => verified_cwd = Some(real),
            Err(e) => {
                release(&mut *ctx.state.lock().await);
                return Err(e);
            }
        }
    }

    // 起動する worktree(新規の既定はリポジトリ本体。再開で指定が無ければ、会話ファイルの cwd)。
    let (spec, sync) = match &request {
        StartRunningSessionDto::Resume {
            worktree,
            sync_origin_main,
            ..
        } => (
            worktree.clone().map(app::WorktreeSpec::from),
            sync_origin_main.unwrap_or(true),
        ),
        StartRunningSessionDto::New {
            worktree,
            sync_origin_main,
            ..
        } => (
            Some(
                worktree
                    .clone()
                    .map(app::WorktreeSpec::from)
                    .unwrap_or(app::WorktreeSpec::Main),
            ),
            sync_origin_main.unwrap_or(true),
        ),
    };
    let (worktree, worktree_index) =
        match prepare_start_worktree(ctx, repository.as_deref(), spec, sync).await {
            Ok(prepared) => prepared,
            Err(e) => {
                release(&mut *ctx.state.lock().await);
                return Err(e);
            }
        };
    // 再開で worktree の指定が無いときは、確かめた実体のパスを作業フォルダとして渡す(会話ファイルを読み直さない)。
    let worktree = match (worktree, verified_cwd) {
        (None, Some(path)) => {
            let worktree_id = worktree_index.id_of(&path);
            Some(app::ResolvedWorktree { path, worktree_id })
        }
        (worktree, _) => worktree,
    };

    let (tx, rx) = mpsc::unbounded_channel();
    let sink: Arc<dyn RunningSessionEventSink> = Arc::new(ChannelSink(tx));
    let resumed_project = match &request {
        StartRunningSessionDto::Resume { project, .. } => Some(project.clone()),
        StartRunningSessionDto::New { .. } => None,
    };
    let is_resume = matches!(request, StartRunningSessionDto::Resume { .. });
    // 起動のときに選んだモデルの別名(控えに覚える値)。
    let start_model: Option<app::StartModel> = match &request {
        StartRunningSessionDto::Resume { model, .. }
        | StartRunningSessionDto::New { model, .. } => model.map(Into::into),
    };
    let session_id_for_task = session_id.clone();
    let launcher = ctx.running.launcher();
    // claude の起動は数秒かかりうるため、async ランタイムを塞がないようブロッキングスレッドで行う。
    let started =
        tokio::task::spawn_blocking(move || -> Result<app::StartedRunningSession, AppError> {
            match request {
                StartRunningSessionDto::Resume {
                    project,
                    session_id,
                    mode,
                    name,
                    model,
                    ..
                } => {
                    let source = FileSystemRepository::new(root);
                    let ledger = FileRunningSessionSource::new(
                        FileRunningSessionSource::default_sessions_dir()?,
                    );
                    app::resume_running_session(
                        &source,
                        &launcher,
                        &ledger,
                        &running,
                        &starting,
                        &app::ResumeRunningSession {
                            project,
                            session_id,
                            mode: mode.into(),
                            repository_path: repository,
                            name,
                            model: model.map(Into::into),
                            worktree,
                            worktree_index,
                        },
                        sink,
                        now_ms(),
                    )
                }
                StartRunningSessionDto::New {
                    mode, name, model, ..
                } => {
                    let repository_path = repository.ok_or_else(|| {
                        AppError::InvalidInput(
                            "プロファイルにリポジトリが設定されていません".to_string(),
                        )
                    })?;
                    let ledger = FileRunningSessionSource::new(
                        FileRunningSessionSource::default_sessions_dir()?,
                    );
                    app::create_running_session(
                        &launcher,
                        &ledger,
                        &running,
                        &starting,
                        &app::CreateRunningSession {
                            repository_path,
                            mode: mode.into(),
                            name,
                            model: model.map(Into::into),
                            worktree: worktree.ok_or_else(|| {
                                AppError::InvalidInput(
                                    "起動する worktree が決まりません".to_string(),
                                )
                            })?,
                        },
                        session_id_for_task,
                        sink,
                        now_ms(),
                    )
                }
            }
        })
        .await
        .unwrap_or_else(|_| Err(background_failed()));

    let started = match started {
        Ok(started) => started,
        Err(e) => {
            release(&mut *ctx.state.lock().await);
            return Err(e);
        }
    };

    let target = RunningSessionRef::of(&started.session);
    let remembered_project = resumed_project.clone();
    let (dto, payload, remembered, start_usage_polling) = {
        let mut guard = ctx.state.lock().await;
        release(&mut guard);
        // 同じ会話の終了済みは置き換え、終了済みが増えすぎないよう古いものを忘れる。
        let current: Vec<RunningSessionByApp> = guard
            .running_sessions
            .iter()
            .map(|slot| slot.session.clone())
            .collect();
        for gone in app::exited_to_forget(&current, &session_id) {
            guard
                .running_sessions
                .retain(|slot| !gone.matches(&slot.session));
        }
        let slot = RunningSessionSlot {
            progress_seq: 0,
            project: resumed_project,
            session: started.session,
            // 会話用のジョブへ入れる(停止のとき、切り離された子孫も止める)。
            process: crate::jobbed_process::JobbedProcess::wrap(started.process),
            available_models: Vec::new(),
            subscribers: Vec::new(),
        };
        let dto = RunningSessionDto::from_session(
            slot.project.as_deref(),
            slot.session.clone(),
            slot.available_models.clone(),
            slot.progress_seq,
        );
        let payload = changed_event(&slot.session, None);
        let remembered = slot.session.clone();
        guard.running_sessions.push(slot);
        let start_usage_polling = !guard.usage_polling_active;
        guard.usage_polling_active = true;
        (dto, payload, remembered, start_usage_polling)
    };
    spawn_event_loop(ctx.clone(), target, session_id.clone(), rx);
    ctx.events.emit(RUNNING_SESSION_CHANGED_EVENT, &payload);
    if start_usage_polling {
        spawn_usage_polling(ctx.clone());
    }

    // 次のサーバの起動で再開できるよう、指定を覚える(ロックの外で書く)。
    let project = remembered_project;
    with_restorable_store(
        ctx,
        "実行中セッションの控えの保存",
        move |store| {
            app::remember_running_session(
                store,
                &remembered,
                &resolved_profile_id,
                project.as_deref(),
                start_model,
            )
        },
    )
    .await;
    if is_resume {
        // 起動(再開)したら自動でアーカイブの印を外す。失敗しても起動自体は成功のまま返す。
        let sid = session_id.clone();
        with_archived_store(ctx, "アーカイブの印の解除", move |store| {
            app::unarchive_session(store, &sid)
        })
        .await;
    }
    Ok(dto)
}

// ---------------------------------------------------------------------------
// 自動再開(前回動かしていたものを、起動のときに 1 件ずつ再開する)
// ---------------------------------------------------------------------------

/// サーバの起動時に、前回動かしていた実行中セッションを順に再開する。**データフォルダの
/// `running-sessions.json` だけ**を読む(使い捨てのデータフォルダでは空)。ハブの初回表示などを
/// 妨げないよう、バックグラウンドで走らせる。
///
/// 1 件ずつ(`claude` は 1 つが数百 MB・起動に数秒かかるため)。再開できなかったものは飛ばして
/// 次へ進み、理由を `app:warning` とログに残す。控えからは消さない(一時的な理由で消すと、
/// 次の起動でもう試さなくなるため)。利用者が「停止」したときだけ控えから外れる。
pub fn start_restoring_running_sessions(ctx: AppContext) {
    tokio::spawn(async move {
        // 台帳を最新にしてから(worktree の ID を引けるように)。失敗しても続ける。
        if let Err(e) = reload_git_ledger(&ctx).await {
            eprintln!("Git 台帳の更新に失敗しました: {e}");
        }
        let settings = ctx.state.lock().await.settings.clone();
        let root = match resolve_effective_projects_dir(&settings) {
            Ok(root) => root,
            Err(e) => {
                eprintln!("前回の実行中セッションを再開できませんでした: {e}");
                return;
            }
        };
        let path = ctx.data_dir.join("running-sessions.json");
        let archived_path = ctx.data_dir.join("archived-sessions.json");
        let watches = [
            crate::corruption::Watch::start(&ctx.data_dir, "running-sessions.json"),
            crate::corruption::Watch::start(&ctx.data_dir, "archived-sessions.json"),
        ];
        let data_dir = ctx.data_dir.as_ref().clone();
        let entries = tokio::task::spawn_blocking(move || {
            crate::session_ids::normalize_stores(&data_dir);
            let archived =
                app::load_archived_sessions(&FileArchivedSessionsStore::new(archived_path))?;
            app::sessions_to_restore(
                &FileRestorableRunningSessionsStore::new(path),
                &settings,
                &archived,
            )
        })
        .await
        .unwrap_or_else(|_| Err(background_failed()));
        for watch in &watches {
            watch.report(&ctx).await;
        }
        let entries = match entries {
            Ok(entries) => entries,
            Err(e) => {
                eprintln!("前回の実行中セッションの控えを読めませんでした: {e}");
                return;
            }
        };
        if entries.is_empty() {
            return;
        }
        println!("前回の実行中セッション {} 件を再開します", entries.len());

        for entry in entries {
            if *ctx.shutdown.borrow() {
                return;
            }
            let name = entry
                .name
                .clone()
                .unwrap_or_else(|| entry.session_id.clone());
            let planned = match app::plan_restore(&entry) {
                Ok(planned) => planned,
                Err(e) => {
                    warn_restore_skipped(&ctx, &name, &e.to_string()).await;
                    continue;
                }
            };
            // 会話ファイルが消えていたら、起こす前に飛ばす。
            let checked = {
                let source = FileSystemRepository::new(root.clone());
                let planned = planned.clone();
                tokio::task::spawn_blocking(move || {
                    app::ensure_restorable_conversation(&source, &planned)
                })
                .await
                .unwrap_or_else(|_| Err(background_failed()))
            };
            if let Err(e) = checked {
                warn_restore_skipped(&ctx, &name, &e.to_string()).await;
                continue;
            }

            // 台帳を作り直して worktree の ID が振り直されていても、覚えていたフォルダで台帳から引き直す。
            // 引き直せなかったものは、控えから外す(起動のたびに同じ警告をくり返さない)。
            let (ledger, settings) = {
                let guard = ctx.state.lock().await;
                (guard.git_ledger.clone(), guard.settings.clone())
            };
            let worktree = match resolve_restore_worktree(&ledger, &settings, &planned) {
                Ok(worktree) => worktree,
                Err(reason) => {
                    warn_restore_skipped(&ctx, &name, &reason).await;
                    let forgotten = planned.session_id.clone();
                    with_restorable_store(
                        &ctx,
                        "実行中セッションの控えからの削除",
                        move |store| app::forget_running_session(store, &forgotten),
                    )
                    .await;
                    continue;
                }
            };
            let request = StartRunningSessionDto::Resume {
                project: planned.project,
                session_id: planned.session_id,
                mode: planned.mode.into(),
                name: planned.name,
                model: planned.model.map(Into::into),
                worktree: worktree.map(WorktreeSpecDto::from),
                // 復元では origin/main の最新化をしない(勝手にブランチを動かさない)。
                sync_origin_main: Some(false),
            };
            match start_running_session(&ctx, Some(planned.profile_id), request).await {
                Ok(dto) => wait_until_settled(&ctx, &dto.target.into()).await,
                Err(e) => warn_restore_skipped(&ctx, &name, &e.to_string()).await,
            }
        }
    });
}

/// 控えの worktree を、台帳から引く。ID で引ければそのまま。引けないときは、覚えていたフォルダで引き直す
/// (台帳に無いフォルダでは起動しない)。リポジトリ本体・リポジトリ外・worktree の指定が無いものは、そのまま。
pub fn resolve_restore_worktree(
    ledger: &GitLedger,
    settings: &Settings,
    planned: &app::PlannedRestore,
) -> Result<Option<app::WorktreeSpec>, String> {
    let Some(app::WorktreeSpec::Existing { worktree_id }) = &planned.worktree else {
        return Ok(planned.worktree.clone());
    };
    let repository = app::resolve_profile(settings, Some(&planned.profile_id))
        .map_err(|e| e.to_string())?
        .repository_path
        .clone()
        .ok_or_else(|| "プロファイルにリポジトリが設定されていません".to_string())?;
    let index = app::WorktreeIndex::from_ledger(ledger, &repository);
    if index.path_of(worktree_id).is_some() {
        return Ok(planned.worktree.clone());
    }
    let Some(path) = &planned.worktree_path else {
        return Err("覚えていた worktree が台帳に見つかりません".to_string());
    };
    let found = index.id_of(std::path::Path::new(path));
    if found == domain::MAIN_WORKTREE_ID {
        Ok(Some(app::WorktreeSpec::Main))
    } else if found == domain::OUTSIDE_WORKTREE_ID {
        Err("覚えていた worktree のフォルダが台帳に見つかりません".to_string())
    } else {
        Ok(Some(app::WorktreeSpec::Existing { worktree_id: found }))
    }
}

/// 起動した 1 件が「起動中」を抜けるまで待つ(次の控えを起こす前に。上限つき)。
async fn wait_until_settled(ctx: &AppContext, target: &RunningSessionRef) {
    const POLL_INTERVAL: Duration = Duration::from_millis(200);
    const MAX_WAIT: Duration = Duration::from_secs(30);
    let started = std::time::Instant::now();
    loop {
        let settled = {
            let guard = ctx.state.lock().await;
            match find_slot(&guard, target) {
                Some(slot) => slot.session.process_state != ProcessState::Starting,
                None => true,
            }
        };
        if settled || started.elapsed() >= MAX_WAIT || *ctx.shutdown.borrow() {
            return;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

async fn warn_restore_skipped(ctx: &AppContext, name: &str, reason: &str) {
    warn(ctx, format!("「{name}」を再開できませんでした: {reason}")).await;
}

// ---------------------------------------------------------------------------
// 終了時の停止
// ---------------------------------------------------------------------------

/// 起動したままの子プロセスを**全部**、並行して止める(残さない)。[`STOP_ALL_BUDGET`] で打ち切る
/// (間に合わなかった分は、ジョブオブジェクトが止める)。控えには手を付けない(次の起動で再開するため)。
pub async fn stop_all_running_sessions(ctx: &AppContext) {
    let processes: Vec<Arc<dyn app::RunningProcess>> = {
        let guard = ctx.state.lock().await;
        guard
            .running_sessions
            .iter()
            .filter(|slot| slot.session.process_state != ProcessState::Exited)
            .map(|slot| slot.process.clone())
            .collect()
    };
    if processes.is_empty() {
        return;
    }
    println!("実行中セッション {} 件を止めます", processes.len());
    let mut set = tokio::task::JoinSet::new();
    for process in processes {
        set.spawn_blocking(move || process.stop());
    }
    let wait = async { while set.join_next().await.is_some() {} };
    if tokio::time::timeout(STOP_ALL_BUDGET, wait).await.is_err() {
        eprintln!("実行中セッションを止めきれませんでした(残りはジョブオブジェクトが止めます)");
    }
}

/// `session_id` に一致する、終了していない実行中セッションを**全部**止める(プロファイルをまたいで探す)。
pub async fn stop_running_sessions_for(ctx: &AppContext, session_id: &str) {
    let targets: Vec<(RunningSessionByApp, Arc<dyn app::RunningProcess>)> = {
        let guard = ctx.state.lock().await;
        guard
            .running_sessions
            .iter()
            .filter(|slot| {
                crate::session_ids::canonical(&slot.session.base.session_id)
                    == crate::session_ids::canonical(session_id)
                    && slot.session.process_state != ProcessState::Exited
            })
            .map(|slot| (slot.session.clone(), slot.process.clone()))
            .collect()
    };
    for (mut snapshot, process) in targets {
        let target = RunningSessionRef::of(&snapshot);
        let stopped = tokio::task::spawn_blocking(move || {
            app::stop_running_session(&mut snapshot, process.as_ref(), now_ms());
            snapshot
        })
        .await;
        let Ok(snapshot) = stopped else {
            eprintln!("アーカイブ前の停止に失敗しました(バックグラウンド処理の失敗)");
            continue;
        };
        let payload = {
            let mut guard = ctx.state.lock().await;
            find_slot_mut(&mut guard, &target).map(|slot| {
                slot.session = snapshot;
                changed_event(&slot.session, None)
            })
        };
        if let Some(payload) = payload {
            ctx.events.emit(RUNNING_SESSION_CHANGED_EVENT, &payload);
        }
    }
}
