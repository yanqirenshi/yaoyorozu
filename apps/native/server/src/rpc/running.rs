//! 実行中セッションの command(14 本)。写し元: `tauri/src/running_session.rs` の `#[tauri::command]`。
//! 薄い層(引数の変換 → ユースケース(`app`)呼び出し → DTO 化)だけを持ち、起動・イベントループ・
//! 自動再開などの中身は `running.rs` にある。
//!
//! - 状態のロックの中でファイル I/O・子プロセスへの書き込み・イベントの配信をしない(native.md §2)。
//!   状態を先に動かし、ロックを外してから書き込む(`app::begin_*` の説明)。
//! - クライアントからパスは受け取らない(起動先は登録済みプロファイルと `git worktree list` から引く)。

use crate::dto::{
    ClaudeUsageSnapshotDto, PermissionBehaviorDto, PermissionSuggestionDto, RunningSessionDto,
    RunningSessionRefDto, RunningSessionSummaryDto, RunningSessionSwitchDto,
    StartRunningSessionDto,
};
use crate::error::ApiError;
use crate::progress::MAX_SUBSCRIPTIONS_PER_CONNECTION;
use crate::rpc::{blocking, parse_args};
use crate::running::{
    changed_event, find_slot, find_slot_mut, now_ms, try_with_archived_store,
    with_restorable_store, RUNNING_SESSION_CHANGED_EVENT,
};
use crate::state::Subscription;
use crate::AppContext;
use app::{AppError, PermissionDecision, RunningSessionRef};
use axum::body::Bytes;
use axum::extract::State;
use axum::Json;
use domain::{PermissionSuggestion, ProcessState};
use serde::Deserialize;

fn not_running() -> ApiError {
    AppError::NotFound(
        "実行中のセッションが見つかりません(すでに忘れられたか、まだ開始していません)".to_string(),
    )
    .into()
}

fn background_failed() -> AppError {
    AppError::Io("バックグラウンド処理に失敗しました".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    profile_id: Option<String>,
    request: StartRunningSessionDto,
}

pub async fn start_running_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<RunningSessionDto>, ApiError> {
    let args: StartArgs = parse_args(&body)?;
    let dto =
        crate::running::start_running_session(&ctx, args.profile_id, args.request).await?;
    Ok(Json(dto))
}

/// サーバが起動している実行中セッションの一覧(終了済みで残っているものを含む。起動が古い順)。
pub async fn list_running_sessions(
    State(ctx): State<AppContext>,
) -> Result<Json<Vec<RunningSessionSummaryDto>>, ApiError> {
    let guard = ctx.state.lock().await;
    let mut summaries: Vec<app::RunningSessionSummary> = guard
        .running_sessions
        .iter()
        .map(|slot| app::summarize(&slot.session))
        .collect();
    summaries.sort_by_key(|s| s.target.started_at);
    Ok(Json(summaries.into_iter().map(Into::into).collect()))
}

/// Claude.ai の利用状況の、サーバが最後に取得した値。持っている値を返すだけ(新たに取得を要求しない)。
pub async fn get_claude_usage(
    State(ctx): State<AppContext>,
) -> Result<Json<ClaudeUsageSnapshotDto>, ApiError> {
    let guard = ctx.state.lock().await;
    Ok(Json(guard.claude_usage.clone().into()))
}

#[derive(Deserialize)]
pub struct TargetArgs {
    target: RunningSessionRefDto,
}

pub async fn get_running_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<Option<RunningSessionDto>>, ApiError> {
    let args: TargetArgs = parse_args(&body)?;
    let target: RunningSessionRef = args.target.into();
    let guard = ctx.state.lock().await;
    Ok(Json(find_slot(&guard, &target).map(|slot| {
        RunningSessionDto::from_session(
            slot.project.as_deref(),
            slot.session.clone(),
            slot.available_models.clone(),
            slot.progress_seq,
            slot.turn_events.snapshot(),
        )
    })))
}

/// 実行中セッションの途中経過を、**この接続**(`/ws` の WebSocket。接続の ID はサーバの中だけで使う)へ流し始める。
/// 購読 ID を返す。購読が無い間の出来事は捨てる(状態・答え待ちは `get_running_session` で取れる)。
pub async fn subscribe_progress(
    ctx: &AppContext,
    conn_id: &str,
    target: RunningSessionRef,
) -> Result<u64, ApiError> {
    // 接続の表は状態とは別のロック。先に確かめてから、状態を触る。
    if !ctx.running.connections.is_open(conn_id) {
        return Err(ApiError::new(
            "not_found",
            "接続が見つかりません(つなぎ直したあとは、新しい接続で購読し直してください)",
        ));
    }
    let mut guard = ctx.state.lock().await;
    let held = guard
        .running_sessions
        .iter()
        .flat_map(|slot| slot.subscribers.iter())
        .filter(|s| s.conn_id == conn_id)
        .count();
    if held >= MAX_SUBSCRIPTIONS_PER_CONNECTION {
        return Err(ApiError::new(
            "invalid_input",
            "この接続の購読が多すぎます。使っていない購読をやめてください",
        ));
    }
    let id = guard.next_subscription_id;
    let slot = find_slot_mut(&mut guard, &target).ok_or_else(not_running)?;
    // 終了したセッションは、もう途中経過が出ない(購読を残さない)。
    if slot.session.process_state == ProcessState::Exited {
        return Err(not_running());
    }
    slot.subscribers.push(Subscription {
        id,
        conn_id: conn_id.to_string(),
    });
    guard.next_subscription_id += 1;
    drop(guard);
    // 登録のあいだに接続が閉じていたら(閉じる側の掃除と行き違い)、残さない。
    if !ctx.running.connections.is_open(conn_id) {
        ctx.state
            .lock()
            .await
            .drop_connection_subscriptions(&[conn_id.to_string()]);
        return Err(ApiError::new("not_found", "接続が閉じられました"));
    }
    Ok(id)
}

/// 途中経過の購読をやめる。**その接続の購読だけ**(ほかの接続の購読は外せない)。無い ID は何もしない。
pub async fn unsubscribe_progress(ctx: &AppContext, conn_id: &str, subscription_id: u64) {
    let mut guard = ctx.state.lock().await;
    for slot in &mut guard.running_sessions {
        slot.subscribers
            .retain(|s| !(s.id == subscription_id && s.conn_id == conn_id));
    }
}

/// `/ws` へつなぐための**使い捨ての券**と、つなぐ先のポートを返す。ほかの rpc と同じ守り(トークン・Host。中継では Origin も)を受ける。
/// 券は 30 秒・1 回だけ有効で、つないだあとの最初のメッセージで送る(URL には入れない)。
pub async fn issue_ws_ticket(
    State(ctx): State<AppContext>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if ctx.running.allowed_origins.is_empty() {
        return Err(ApiError::new(
            "not_found",
            "WebSocket が使えません(サーバに画面のポートが渡されていません)",
        ));
    }
    match ctx.running.tickets.issue() {
        Ok(ticket) => Ok(Json(
            serde_json::json!({ "ticket": ticket, "port": ctx.port }),
        )),
        Err(crate::ws::IssueError::TooMany) => Err(ApiError::new(
            "invalid_input",
            "使われていない券が多すぎます。しばらくしてからやり直してください",
        )),
    }
}

#[derive(Deserialize)]
pub struct SendArgs {
    target: RunningSessionRefDto,
    text: String,
    images: Vec<String>,
}

/// 実行中セッションへ user メッセージ(本文と画像)を送る。本文の大きさは、この command だけ
/// 画像の上限(5 枚 × 5MB)に合わせて広げている(`rpc::routes`)。
pub async fn send_to_running_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SendArgs = parse_args(&body)?;
    let target: RunningSessionRef = args.target.into();
    // 状態を先に動かす(ロックの中。書き込みはロックの外)。
    let (process, validated, payload) = {
        let mut guard = ctx.state.lock().await;
        let slot = find_slot_mut(&mut guard, &target).ok_or_else(not_running)?;
        let validated = app::begin_send_to_running_session(
            &mut slot.session,
            &args.text,
            &args.images,
            now_ms(),
        )?;
        (
            slot.process.clone(),
            validated,
            changed_event(&slot.session, None),
        )
    };
    ctx.events.emit(RUNNING_SESSION_CHANGED_EVENT, &payload);

    let text = args.text;
    blocking(move || app::write_user_message(process.as_ref(), &text, &validated)).await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondPermissionArgs {
    target: RunningSessionRefDto,
    request_id: String,
    behavior: PermissionBehaviorDto,
    updated_input: Option<serde_json::Value>,
    updated_permissions: Option<Vec<PermissionSuggestionDto>>,
    message: Option<String>,
}

/// 権限の問い合わせに答える。許可(`allow`)は `updatedInput`・`updatedPermissions`(問い合わせの
/// `suggestions` から選んだもの)を、拒否(`deny`)は `message` を添えられる。
pub async fn respond_permission(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: RespondPermissionArgs = parse_args(&body)?;
    let target: RunningSessionRef = args.target.into();
    let decision = match args.behavior {
        PermissionBehaviorDto::Allow => PermissionDecision::Allow {
            updated_input: args.updated_input,
            updated_permissions: args.updated_permissions.map(|list| {
                serde_json::Value::Array(
                    list.into_iter()
                        .map(|dto| PermissionSuggestion::from(dto).to_update_value())
                        .collect(),
                )
            }),
        },
        PermissionBehaviorDto::Deny => PermissionDecision::Deny {
            message: args.message,
        },
    };

    let request_id = args.request_id;
    let (process, response, payload) = {
        let mut guard = ctx.state.lock().await;
        let slot = find_slot_mut(&mut guard, &target).ok_or_else(not_running)?;
        let response =
            app::begin_respond_permission(&mut slot.session, &request_id, decision, now_ms())?;
        (
            slot.process.clone(),
            response,
            changed_event(&slot.session, None),
        )
    };
    ctx.events.emit(RUNNING_SESSION_CHANGED_EVENT, &payload);

    blocking(move || app::write_permission_response(process.as_ref(), &response)).await?;
    Ok(Json(()))
}

/// 生成中(権限待ちを含む)の中断を要求する。プロセスは生きたまま、次の入力を送れる。
pub async fn interrupt_running_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: TargetArgs = parse_args(&body)?;
    let target: RunningSessionRef = args.target.into();
    let (snapshot, process) = {
        let guard = ctx.state.lock().await;
        let slot = find_slot(&guard, &target).ok_or_else(not_running)?;
        (slot.session.clone(), slot.process.clone())
    };
    blocking(move || app::interrupt_running_session(&snapshot, process.as_ref())).await?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct SwitchArgs {
    target: RunningSessionRefDto,
    switch: RunningSessionSwitchDto,
}

/// 起動中に、モデル・権限モードを切り替える。結果(現在のモデル・権限モード)は CLI が受け入れたとき
/// (応答)に反映され、`running-session:changed` で知らせる。権限モードは列挙(`RunningPermissionModeDto`)
/// だけ、モデル名は英数字と `-_.:[]` だけを受け付ける(`app::begin_switch_running_session`)。
pub async fn switch_running_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SwitchArgs = parse_args(&body)?;
    let target: RunningSessionRef = args.target.into();
    let switch: app::RunningSessionSwitch = args.switch.into();
    let process = {
        let guard = ctx.state.lock().await;
        let slot = find_slot(&guard, &target).ok_or_else(not_running)?;
        app::begin_switch_running_session(&slot.session, &switch)?;
        slot.process.clone()
    };
    blocking(move || app::write_switch(process.as_ref(), &switch)).await?;
    Ok(Json(()))
}

/// 実行中セッションを止める(標準入力を閉じて終了を待つ。約 1 秒)。終了済みなら何もしない。
/// 対象が見つからなければ `not_found`。利用者が止めたものは、次のサーバの起動で再開しない。
pub async fn stop_running_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: TargetArgs = parse_args(&body)?;
    let target: RunningSessionRef = args.target.into();
    let (mut snapshot, process) = {
        let guard = ctx.state.lock().await;
        let slot = find_slot(&guard, &target).ok_or_else(not_running)?;
        (slot.session.clone(), slot.process.clone())
    };
    // 利用者が止めたものは、次の起動で再開しない。すでに終了していても控えからは外す。
    let stopped_session_id = snapshot.base.session_id.clone();
    with_restorable_store(
        &ctx,
        "実行中セッションの控えからの削除",
        move |store| app::forget_running_session(store, &stopped_session_id),
    )
    .await;
    if snapshot.process_state == ProcessState::Exited {
        return Ok(Json(()));
    }
    // 停止は最大で数秒かかる(応答が無ければ強制終了)。ロックの外・ブロッキングスレッドで行う。
    let snapshot = tokio::task::spawn_blocking(move || {
        app::stop_running_session(&mut snapshot, process.as_ref(), now_ms());
        snapshot
    })
    .await
    .map_err(|_| background_failed())?;

    // 読み取りスレッドの `Exited` も同じ反映をするが、画面が停止直後に状態を取り直せるよう
    // ここでも終了に揃える(冪等)。
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
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMarkArgs {
    project: String,
    session_id: String,
}

/// `project` が妥当な名前に見えるときだけ `session:changed` を配る(通知のヒントに過ぎない)。
fn notify_session_changed(ctx: &AppContext, project: &str) {
    if !domain::is_valid_project_dir_name(project) {
        return;
    }
    ctx.events.emit(
        "session:changed",
        &crate::dto::SessionChangedEventDto {
            project: project.to_string(),
            agent: crate::dto::AgentKindDto::ClaudeCode,
        },
    );
}

/// 会話をアーカイブする。会話ファイルは消さず、印(`archived-sessions.json`)を付けるだけ。サーバが
/// 持つ実行中プロセス(この `sessionId` のもの。プロファイルをまたいで探す)があれば、印を付ける前に止める。
/// プロセスの停止は、印の保存に失敗しても取り消さない。印の保存の失敗は、握りつぶさず返す。
pub async fn archive_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SessionMarkArgs = parse_args(&body)?;
    if !domain::is_valid_session_id(&args.session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()).into());
    }
    // 会話 ID は小文字にそろえて、比べる・印に書く。
    let session_id = crate::session_ids::canonical(&args.session_id);
    // 印を先に付け、起動している最中なら終わるまで待って止め、再開の控えからも外す(`archive_session_settled`)。
    crate::running::archive_session_settled(&ctx, &session_id).await?;
    notify_session_changed(&ctx, &args.project);
    Ok(Json(()))
}

/// 会話のアーカイブを解除する。
pub async fn unarchive_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: SessionMarkArgs = parse_args(&body)?;
    if !domain::is_valid_session_id(&args.session_id) {
        return Err(AppError::InvalidInput("不正なセッションIDです".to_string()).into());
    }
    let session_id = crate::session_ids::canonical(&args.session_id);
    try_with_archived_store(&ctx, move |store| {
        app::unarchive_session(store, &session_id)
    })
    .await?;
    notify_session_changed(&ctx, &args.project);
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameArgs {
    project: String,
    session_id: String,
    title: String,
}

/// セッションの表示名(タイトル)を変える。会話ファイルへ `custom-title` 行を追記する。**実行中の
/// プロセスの宛先名(起動時の `--name`)は、これでは変わらない**(次に起動し直すまで古い名前のまま)。
pub async fn rename_session(
    State(ctx): State<AppContext>,
    body: Bytes,
) -> Result<Json<()>, ApiError> {
    let args: RenameArgs = parse_args(&body)?;
    let root = crate::rpc::viewer::effective_projects_dir(&ctx).await?;
    let notify_project = args.project.clone();
    blocking(move || {
        let source = infra::FileSystemRepository::new(root);
        app::rename_session(
            &source,
            &args.project,
            &crate::session_ids::canonical(&args.session_id),
            &args.title,
        )
    })
    .await?;
    notify_session_changed(&ctx, &notify_project);
    Ok(Json(()))
}
